import { describe, expect, it, vi } from 'vitest';
import type { BvcHistoricalCandidate, BvcIndexObservationCandidate } from '@bvc/market-data';
import { runDailyIngestion } from './pipeline';
import { STALE_RUN_AFTER_MINUTES } from './types';
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
  /** Failure injection: simulates the database becoming unreachable at a given call. */
  failActiveTickers: Error | null = null;
  failFinalize: Error | null = null;
  private runCounter = 0;

  constructor(public activeTickers: string[]) {}

  async ensureSystemActor() {
    return 'system-actor';
  }

  async createRun(input: CreateRunInput) {
    // Mirrors one_running_ingestion_run_per_date_provider_uq.
    const clash = [...this.runs.values()].some(
      (run) =>
        run.status === 'running' &&
        run.marketDate === input.marketDate &&
        run.providerId === input.providerId,
    );
    if (clash) {
      throw Object.assign(new Error('duplicate key value violates unique constraint'), {
        code: '23505',
      });
    }
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
    if (this.failFinalize) throw this.failFinalize;
    const run = this.runs.get(runId)!;
    if (run.status !== 'running') return false;
    run.status = input.status;
    run.finishedAt = new Date().toISOString();
    run.metrics = input.metrics;
    run.instrumentFailures = input.instrumentFailures;
    return true;
  }

  async recoverStaleRuns(staleAfterMinutes: number) {
    const cutoff = Date.now() - staleAfterMinutes * 60_000;
    const recovered: string[] = [];
    for (const run of this.runs.values()) {
      if (run.status === 'running' && Date.parse(run.startedAt) < cutoff) {
        this.markFailed(run, 'STALE_RUN_RECOVERED');
        recovered.push(run.id);
      }
    }
    return recovered;
  }

  async abandonRun(runId: string, errorCode: string) {
    const run = this.runs.get(runId);
    if (!run || run.status !== 'running') return false;
    this.markFailed(run, errorCode);
    return true;
  }

  private markFailed(run: StoredRun, errorCode: string) {
    run.status = 'failed';
    run.finishedAt = new Date().toISOString();
    run.metrics.errorSummary[errorCode] = (run.metrics.errorSummary[errorCode] ?? 0) + 1;
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
    if (this.failActiveTickers) throw this.failActiveTickers;
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

describe('run lifecycle', () => {
  const ohlcvAdapter = () =>
    makeAdapter({
      fetchDailyOhlcv: async ({ ticker, date }) => ({
        candidates: [candidate(ticker, date)],
        errors: [],
      }),
    });

  it('finalizes a successful run as succeeded with its published rows', async () => {
    const store = new FakeStore(['IAM', 'ATW']);
    const summary = await runDailyIngestion(baseOptions(), store, { adapter: ohlcvAdapter() });

    const run = store.runs.get(summary.runId!)!;
    expect(run.status).toBe('succeeded');
    expect(run.finishedAt).not.toBeNull();
    expect(run.metrics.securitiesSucceeded).toBe(2);
    expect(store.prices.size).toBe(2);
  });

  it('finalizes as failed (never leaves it running) when the upstream BVC site is down', async () => {
    const store = new FakeStore(['IAM', 'ATW']);
    const down = async () => {
      throw new Error('BVC_UNAVAILABLE: connect ETIMEDOUT');
    };
    const adapter = makeAdapter({
      fetchSecurityMaster: down,
      fetchIndexMaster: down,
      fetchIndexHistory: down,
      fetchDailyOhlcv: down,
    });

    const summary = await runDailyIngestion(baseOptions(), store, { adapter });

    expect(summary.status).toBe('failed');
    expect(store.runs.get(summary.runId!)!.status).toBe('failed');
    expect(summary.metrics.errorSummary['BVC_UNAVAILABLE']).toBeGreaterThan(0);
    expect(store.prices.size).toBe(0);
  }, 20_000);

  it('finalizes as failed with a PIPELINE failure when the database fails mid-run, then rethrows', async () => {
    const store = new FakeStore(['IAM']);
    store.failActiveTickers = new Error(
      'connect ECONNREFUSED postgresql://user:secret@db.example:5432/postgres',
    );

    await expect(
      runDailyIngestion(baseOptions(), store, { adapter: ohlcvAdapter() }),
    ).rejects.toThrow('ECONNREFUSED');

    const [run] = [...store.runs.values()];
    expect(run!.status).toBe('failed');
    expect(run!.finishedAt).not.toBeNull();
    expect(run!.instrumentFailures).toEqual([
      expect.objectContaining({
        ticker: 'PIPELINE',
        stage: 'pipeline',
        errorCode: 'PIPELINE_ERROR',
      }),
    ]);
    // Database connection strings never reach the persisted run record.
    expect(run!.instrumentFailures[0]!.message).not.toContain('secret');
  });

  it('leaves the run for stale recovery when even finalization fails, and the next run recovers it', async () => {
    const store = new FakeStore(['IAM']);
    store.failFinalize = new Error('connection terminated unexpectedly');

    await expect(
      runDailyIngestion(baseOptions(), store, { adapter: ohlcvAdapter() }),
    ).rejects.toThrow('connection terminated');
    const [orphan] = [...store.runs.values()];
    expect(orphan!.status).toBe('running');

    // Simulate the orphan having outlived every executor's hard deadline.
    orphan!.startedAt = new Date(Date.now() - (STALE_RUN_AFTER_MINUTES + 1) * 60_000).toISOString();
    store.failFinalize = null;
    const logs: string[] = [];
    const next = await runDailyIngestion(baseOptions(), store, {
      adapter: ohlcvAdapter(),
      log: (message) => logs.push(message),
    });

    expect(orphan!.status).toBe('failed');
    expect(orphan!.metrics.errorSummary['STALE_RUN_RECOVERED']).toBe(1);
    expect(next.status).toBe('succeeded');
    expect(
      logs.some((line) => line.includes(`Recovered 1 stale run(s) as failed: ${orphan!.id}`)),
    ).toBe(true);
  });

  it('never recovers a recent running run: a duplicate for the same date/provider is rejected instead', async () => {
    const store = new FakeStore(['IAM']);
    await store.createRun({
      providerId: 'bvc_public_testing',
      marketDate: '2026-08-28',
      triggerSource: 'manual',
      proposedBy: 'system-actor',
    });

    await expect(
      runDailyIngestion(baseOptions(), store, { adapter: ohlcvAdapter() }),
    ).rejects.toMatchObject({ code: '23505' });

    expect([...store.runs.values()].map((run) => run.status)).toEqual(['running']);
  });

  it('rejects the second of two concurrent requests for the same date and provider', async () => {
    const store = new FakeStore(['IAM']);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const adapter = makeAdapter({
      fetchDailyOhlcv: async ({ ticker, date }) => {
        await gate;
        return { candidates: [candidate(ticker, date)], errors: [] };
      },
    });

    const first = runDailyIngestion(baseOptions(), store, { adapter });
    await vi.waitFor(() => expect(store.runs.size).toBe(1));
    const second = runDailyIngestion(baseOptions(), store, { adapter });
    await expect(second).rejects.toMatchObject({ code: '23505' });
    release();

    expect((await first).status).toBe('succeeded');
    expect(store.runs.size).toBe(1);
  });

  it('does not overwrite a run that was already marked failed while it was executing', async () => {
    const store = new FakeStore(['IAM']);
    const logs: string[] = [];
    const adapter = makeAdapter({
      fetchDailyOhlcv: async ({ ticker, date }) => {
        await store.abandonRun('run-1', 'RUN_TIMEOUT');
        return { candidates: [candidate(ticker, date)], errors: [] };
      },
    });

    await runDailyIngestion(baseOptions(), store, { adapter, log: (line) => logs.push(line) });

    expect(store.runs.get('run-1')!.status).toBe('failed');
    expect(store.runs.get('run-1')!.metrics.errorSummary['RUN_TIMEOUT']).toBe(1);
    expect(logs.some((line) => line.includes('was no longer running at finalize time'))).toBe(true);
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

  it('retries a fully failed run once the provider recovers', async () => {
    const store = new FakeStore(['IAM', 'ATW']);
    const down = makeAdapter({
      fetchIndexHistory: async () => {
        throw new Error('BVC_HTTP_503');
      },
      fetchDailyOhlcv: async () => {
        throw new Error('BVC_HTTP_503');
      },
    });
    const failed = await runDailyIngestion(baseOptions({ tickers: ['IAM', 'ATW'] }), store, {
      adapter: down,
    });
    expect(failed.status).toBe('failed');

    const plan = buildRetryPlan((await store.getRun(failed.runId!))!);
    const retry = await runDailyIngestion(
      baseOptions({ tickers: plan.tickers, triggerSource: 'retry', parentRunId: failed.runId! }),
      store,
      {
        adapter: makeAdapter({
          fetchDailyOhlcv: async ({ ticker, date }) => ({
            candidates: [candidate(ticker, date)],
            errors: [],
          }),
        }),
      },
    );

    expect(plan.tickers.sort()).toEqual(['ATW', 'IAM']);
    expect(retry.status).toBe('succeeded');
    expect(store.runs.get(retry.runId!)!.parentRunId).toBe(failed.runId);
    expect(store.prices.size).toBe(2);
  }, 20_000);

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
