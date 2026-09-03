import { describe, expect, it, vi } from 'vitest';
import type { BvcHistoricalCandidate, BvcIndexObservationCandidate } from '@bvc/market-data';
import { runDailyIngestion } from './pipeline';
import { buildRetryPlan } from './retry';
import type {
  Counts,
  CreateRunInput,
  FinalizeRunInput,
  IngestionStore,
  NormalizedPriceRow,
  RunOptions,
  StoredRun,
} from './index';
import type { ProviderAdapter, FetchResult } from './providers';

function candidate(ticker: string, marketDate: string, close = '100'): BvcHistoricalCandidate {
  return {
    row: 1,
    ticker,
    marketDate,
    close,
    companyName: { fr: null, ar: null, en: null },
    sourceTimestamp: null,
    tradedValue: null,
    transactionCount: null,
    marketCap: null,
  };
}

class FakeStore implements IngestionStore {
  runs = new Map<string, StoredRun>();
  prices = new Map<string, NormalizedPriceRow & { runId: string }>();
  priceWriteCalls = 0;
  private runCounter = 0;

  constructor(public activeTickers: string[]) {}

  async ensureSystemActor() {
    return 'system-actor';
  }

  async createRun(input: CreateRunInput) {
    this.runCounter += 1;
    const id = `run-${this.runCounter}`;
    this.runs.set(id, {
      id,
      providerId: input.providerId,
      marketDate: input.marketDate,
      status: 'running',
      triggerSource: input.triggerSource,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      metrics: {
        securitiesExpected: 0,
        securitiesSucceeded: 0,
        securitiesFailed: 0,
        rowsReceived: 0,
        rowsAccepted: 0,
        rowsRejected: 0,
        rowsPublished: 0,
        indicesExpected: 0,
        indicesSucceeded: 0,
        indicesFailed: 0,
        retryCount: 0,
        errorSummary: {},
      },
      instrumentFailures: [],
      parentRunId: input.parentRunId ?? null,
    });
    return id;
  }

  async finalizeRun(runId: string, input: FinalizeRunInput) {
    const run = this.runs.get(runId)!;
    run.status = input.status;
    run.finishedAt = new Date().toISOString();
    run.metrics = input.metrics;
    run.instrumentFailures = input.instrumentFailures;
  }

  async getRun(runId: string) {
    return this.runs.get(runId) ?? null;
  }

  async findLatestIncompleteRun(marketDate?: string) {
    const candidates = [...this.runs.values()]
      .filter((run) => run.status === 'partial' || run.status === 'failed')
      .filter((run) => !marketDate || run.marketDate === marketDate)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    return candidates[0] ?? null;
  }

  async getActiveSecurityTickers() {
    return this.activeTickers;
  }

  async upsertSecurityMaster(): Promise<Counts> {
    return { inserted: 0, updated: 0 };
  }

  async upsertIndexMaster(): Promise<Counts> {
    return { inserted: 0, updated: 0 };
  }

  async upsertIndexObservations(rows: BvcIndexObservationCandidate[]): Promise<Counts> {
    return { inserted: rows.length, updated: 0 };
  }

  async upsertDailyPrices(rows: NormalizedPriceRow[], runId: string) {
    this.priceWriteCalls += 1;
    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    for (const row of rows) {
      if (!this.activeTickers.includes(row.ticker)) {
        skipped += 1;
        continue;
      }
      const key = `${row.ticker}:${row.marketDate}`;
      if (this.prices.has(key)) updated += 1;
      else inserted += 1;
      this.prices.set(key, { ...row, runId });
    }
    return { inserted, updated, skipped };
  }

  async close() {}
}

function makeAdapter(overrides: Partial<ProviderAdapter> = {}): ProviderAdapter {
  return {
    providerId: 'bvc_public_testing',
    configured: true,
    fetchSecurityMaster: async () => ({ candidates: [], errors: [] }),
    fetchIndexMaster: async () => ({ candidates: [], errors: [] }),
    fetchIndexHistory: async () => ({ candidates: [], errors: [] }),
    fetchDailyOhlcv: async () => ({ candidates: [], errors: [] }),
    ...overrides,
  };
}

function baseOptions(overrides: Partial<RunOptions> = {}): RunOptions {
  return {
    providerId: 'bvc_public_testing',
    marketDate: '2026-08-28',
    dryRun: false,
    concurrency: 2,
    triggerSource: 'cli',
    ...overrides,
  };
}

describe('runDailyIngestion', () => {
  it('is idempotent: rerunning the same market date does not duplicate price rows', async () => {
    const store = new FakeStore(['IAM']);
    const adapter = makeAdapter({
      fetchDailyOhlcv: async ({ ticker, date }) => ({
        candidates: [candidate(ticker, date)],
        errors: [],
      }),
    });

    const first = await runDailyIngestion(baseOptions({ tickers: ['IAM'] }), store, { adapter });
    const second = await runDailyIngestion(baseOptions({ tickers: ['IAM'] }), store, { adapter });

    expect(first.status).toBe('succeeded');
    expect(second.status).toBe('succeeded');
    expect(store.prices.size).toBe(1); // no duplicate (security_id, market_date) row
    expect(store.prices.get('IAM:2026-08-28')?.runId).toBe(second.runId); // second run superseded the first
  });

  it('records a partial run when some tickers fail and others succeed, without losing the successes', async () => {
    const store = new FakeStore(['IAM', 'ATW']);
    const adapter = makeAdapter({
      fetchDailyOhlcv: async ({ ticker, date }) => {
        if (ticker === 'ATW') throw new Error('BVC_HTTP_500');
        return { candidates: [candidate(ticker, date)], errors: [] };
      },
    });

    const summary = await runDailyIngestion(baseOptions({ tickers: ['IAM', 'ATW'] }), store, {
      adapter,
    });

    expect(summary.status).toBe('partial');
    expect(summary.metrics.securitiesSucceeded).toBe(1);
    expect(summary.metrics.securitiesFailed).toBe(1);
    expect(store.prices.has('IAM:2026-08-28')).toBe(true);
    expect(store.prices.has('ATW:2026-08-28')).toBe(false);
    expect(summary.instrumentFailures).toHaveLength(1);
    expect(summary.instrumentFailures[0]).toMatchObject({ ticker: 'ATW', stage: 'ohlcv' });
  });

  it('fires onRunCreated with the run id before the run finishes (for callers that need to respond early)', async () => {
    const store = new FakeStore(['IAM']);
    const adapter = makeAdapter({
      fetchDailyOhlcv: async ({ ticker, date }) => ({
        candidates: [candidate(ticker, date)],
        errors: [],
      }),
    });
    let createdRunId: string | null = null;
    let runFinishedWhenCallbackFired = false;

    const summary = await runDailyIngestion(baseOptions({ tickers: ['IAM'] }), store, {
      adapter,
      onRunCreated: (runId) => {
        createdRunId = runId;
        runFinishedWhenCallbackFired = store.runs.get(runId)!.status !== 'running';
      },
    });

    expect(createdRunId).toBe(summary.runId);
    expect(runFinishedWhenCallbackFired).toBe(false);
  });

  it('never fires onRunCreated for a dry run, since no row is created', async () => {
    const store = new FakeStore(['IAM']);
    const adapter = makeAdapter({
      fetchDailyOhlcv: async ({ ticker, date }) => ({
        candidates: [candidate(ticker, date)],
        errors: [],
      }),
    });
    const onRunCreated = vi.fn();

    await runDailyIngestion(baseOptions({ tickers: ['IAM'], dryRun: true }), store, {
      adapter,
      onRunCreated,
    });

    expect(onRunCreated).not.toHaveBeenCalled();
  });

  it('marks the run failed only when every instrument fails', async () => {
    const store = new FakeStore(['IAM', 'ATW']);
    const adapter = makeAdapter({
      fetchIndexHistory: async () => {
        throw new Error('BVC_HTTP_500');
      },
      fetchDailyOhlcv: async () => {
        throw new Error('BVC_HTTP_500');
      },
    });

    const summary = await runDailyIngestion(baseOptions({ tickers: ['IAM', 'ATW'] }), store, {
      adapter,
    });

    expect(summary.status).toBe('failed');
    expect(summary.metrics.securitiesSucceeded).toBe(0);
    expect(summary.metrics.securitiesFailed).toBe(2);
  }, 10_000);

  it('retries a transient failure with backoff and still succeeds, counting the retry', async () => {
    const store = new FakeStore(['IAM']);
    let attempts = 0;
    const adapter = makeAdapter({
      fetchDailyOhlcv: async ({ ticker, date }) => {
        attempts += 1;
        if (attempts < 2) throw new Error('fetch failed');
        return { candidates: [candidate(ticker, date)], errors: [] };
      },
    });

    const summary = await runDailyIngestion(baseOptions({ tickers: ['IAM'] }), store, { adapter });

    expect(summary.status).toBe('succeeded');
    expect(attempts).toBe(2);
    expect(summary.metrics.retryCount).toBe(1);
  });

  it('gives up after a bounded number of attempts and records the failure, not retrying forever', async () => {
    const store = new FakeStore(['IAM']);
    let attempts = 0;
    const adapter = makeAdapter({
      fetchIndexHistory: async () => {
        throw new Error('BVC_HTTP_503');
      },
      fetchDailyOhlcv: async () => {
        attempts += 1;
        throw new Error('BVC_HTTP_503');
      },
    });

    const summary = await runDailyIngestion(baseOptions({ tickers: ['IAM'] }), store, { adapter });

    expect(summary.status).toBe('failed');
    expect(attempts).toBe(3); // bounded retry limit, not unbounded
    expect(summary.instrumentFailures.find((f) => f.ticker === 'IAM')?.attempts).toBe(3);
  }, 10_000);

  it('respects the configured concurrency cap', async () => {
    const store = new FakeStore(['A', 'B', 'C', 'D']);
    let inFlight = 0;
    let maxInFlight = 0;
    const adapter = makeAdapter({
      fetchDailyOhlcv: async ({ ticker, date }) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return { candidates: [candidate(ticker, date)], errors: [] };
      },
    });

    await runDailyIngestion(baseOptions({ tickers: ['A', 'B', 'C', 'D'], concurrency: 2 }), store, {
      adapter,
    });

    expect(maxInFlight).toBeLessThanOrEqual(2);
  });

  it('scopes a run to explicitly requested tickers and flags unknown ones', async () => {
    const store = new FakeStore(['IAM', 'ATW']);
    const adapter = makeAdapter({
      fetchDailyOhlcv: async ({ ticker, date }) => ({
        candidates: [candidate(ticker, date)],
        errors: [],
      }),
    });

    const summary = await runDailyIngestion(baseOptions({ tickers: ['IAM', 'ZZZ'] }), store, {
      adapter,
    });

    expect(store.prices.has('IAM:2026-08-28')).toBe(true);
    expect(
      summary.instrumentFailures.some(
        (f) => f.ticker === 'ZZZ' && f.errorCode === 'UNKNOWN_TICKER',
      ),
    ).toBe(true);
  });

  it('honors an explicit --date target', async () => {
    const store = new FakeStore(['IAM']);
    const seenDates: string[] = [];
    const adapter = makeAdapter({
      fetchDailyOhlcv: async ({ ticker, date }) => {
        seenDates.push(date);
        return { candidates: [candidate(ticker, date)], errors: [] };
      },
    });

    await runDailyIngestion(baseOptions({ tickers: ['IAM'], marketDate: '2026-08-15' }), store, {
      adapter,
    });

    expect(seenDates).toEqual(['2026-08-15']);
    expect(store.prices.has('IAM:2026-08-15')).toBe(true);
  });

  it('does not treat a weekend market date specially — the pipeline is date-agnostic', async () => {
    // 2026-08-29 is a Saturday; the pipeline itself does not reject or special-case it —
    // staleness/scheduling decisions live in packages/market-data's staleness module, not here.
    const store = new FakeStore(['IAM']);
    const adapter = makeAdapter({
      fetchDailyOhlcv: async ({ ticker, date }) => ({
        candidates: [candidate(ticker, date)],
        errors: [],
      }),
    });

    const summary = await runDailyIngestion(
      baseOptions({ tickers: ['IAM'], marketDate: '2026-08-29' }),
      store,
      {
        adapter,
      },
    );

    expect(summary.status).toBe('succeeded');
  });

  it('does not write anything in dry-run mode, but still reports accurate would-be counts', async () => {
    const store = new FakeStore(['IAM']);
    const adapter = makeAdapter({
      fetchDailyOhlcv: async ({ ticker, date }) => ({
        candidates: [candidate(ticker, date)],
        errors: [],
      }),
    });

    const summary = await runDailyIngestion(
      baseOptions({ tickers: ['IAM'], dryRun: true }),
      store,
      { adapter },
    );

    expect(summary.runId).toBeNull();
    expect(store.prices.size).toBe(0);
    expect(store.runs.size).toBe(0);
    expect(summary.metrics.rowsPublished).toBe(1);
  });

  it('leaves an unrelated instrument that a ticker fails without failing the whole security master step', async () => {
    const store = new FakeStore(['IAM', 'ATW']);
    const adapter = makeAdapter({
      fetchSecurityMaster: async () => {
        throw new Error('BVC_HTTP_500');
      },
      fetchDailyOhlcv: async ({ ticker, date }) => ({
        candidates: [candidate(ticker, date)],
        errors: [],
      }),
    });

    const summary = await runDailyIngestion(baseOptions({ tickers: ['IAM', 'ATW'] }), store, {
      adapter,
    });

    // Security master failure is recorded, but per-ticker OHLCV still proceeds using
    // the already-known active tickers.
    expect(summary.instrumentFailures.some((f) => f.stage === 'security_master')).toBe(true);
    expect(store.prices.has('IAM:2026-08-28')).toBe(true);
    expect(store.prices.has('ATW:2026-08-28')).toBe(true);
    expect(summary.status).toBe('partial');
  });
});

describe('retry-failed', () => {
  it('retries only the previously-failed tickers and leaves successful ones untouched', async () => {
    const store = new FakeStore(['IAM', 'ATW']);
    let atwCallCount = 0;
    const failingAdapter = makeAdapter({
      fetchDailyOhlcv: async ({ ticker, date }) => {
        if (ticker === 'ATW') {
          atwCallCount += 1;
          throw new Error('BVC_HTTP_500');
        }
        return { candidates: [candidate(ticker, date)], errors: [] };
      },
    });

    const firstSummary = await runDailyIngestion(baseOptions({ tickers: ['IAM', 'ATW'] }), store, {
      adapter: failingAdapter,
    });
    expect(firstSummary.status).toBe('partial');
    const iamWriteCallsAfterFirstRun = store.priceWriteCalls;
    const atwCallsAfterFirstRun = atwCallCount;

    const parentRun = await store.getRun(firstSummary.runId!);
    const plan = buildRetryPlan(parentRun!);
    expect(plan.tickers).toEqual(['ATW']);

    const recoveringAdapter = makeAdapter({
      fetchDailyOhlcv: async ({ ticker, date }) => {
        if (ticker === 'ATW') atwCallCount += 1;
        return { candidates: [candidate(ticker, date)], errors: [] };
      },
    });

    const retrySummary = await runDailyIngestion(
      baseOptions({
        tickers: plan.tickers,
        triggerSource: 'retry',
        parentRunId: parentRun!.id,
      }),
      store,
      { adapter: recoveringAdapter },
    );

    expect(retrySummary.status).toBe('succeeded');
    expect(retrySummary.metrics.securitiesExpected).toBe(1); // only the failed ticker, not the full set
    expect(store.prices.has('ATW:2026-08-28')).toBe(true);
    // IAM's already-published price was never rewritten by the retry.
    expect(store.priceWriteCalls).toBe(iamWriteCallsAfterFirstRun + 1);
    expect(atwCallCount).toBeGreaterThan(atwCallsAfterFirstRun);
  });

  it('throws when the selected run has no retryable failures', () => {
    const cleanRun: StoredRun = {
      id: 'run-1',
      providerId: 'bvc_public_testing',
      marketDate: '2026-08-28',
      status: 'succeeded',
      triggerSource: 'cli',
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      metrics: {
        securitiesExpected: 1,
        securitiesSucceeded: 1,
        securitiesFailed: 0,
        rowsReceived: 1,
        rowsAccepted: 1,
        rowsRejected: 0,
        rowsPublished: 1,
        indicesExpected: 0,
        indicesSucceeded: 0,
        indicesFailed: 0,
        retryCount: 0,
        errorSummary: {},
      },
      instrumentFailures: [],
      parentRunId: null,
    };
    expect(() => buildRetryPlan(cleanRun)).toThrow(/NO_FAILED_INSTRUMENTS/);
  });
});
