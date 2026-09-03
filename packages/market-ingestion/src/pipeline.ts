import { BVC_SUPPORTED_INDEX_CODES, type BvcSupportedIndexCode } from '@bvc/market-data';
import { createProviderAdapter, type ProviderAdapter } from './providers';
import type { IngestionStore } from './store';
import {
  emptyMetrics,
  type FailureStage,
  type InstrumentFailure,
  type NormalizedPriceRow,
  type RunMetrics,
  type RunOptions,
  type RunSummary,
} from './types';

const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 500;

export interface PipelineDeps {
  adapter?: ProviderAdapter;
  log?: (message: string) => void;
  /** Fires as soon as the durable run row exists (before any instrument fetching starts),
   * so a caller (e.g. an API route) can respond to a client with the run id immediately
   * and let the client poll progress, instead of blocking on the full run. Never fires
   * for a dry run, since no row is created. */
  onRunCreated?: (runId: string) => void;
}

export async function runDailyIngestion(
  options: RunOptions,
  store: IngestionStore,
  deps: PipelineDeps = {},
): Promise<RunSummary> {
  const log = deps.log ?? (() => {});
  const adapter = deps.adapter ?? createProviderAdapter(options.providerId);
  if (!adapter.configured) {
    throw new Error(
      `PROVIDER_NOT_CONFIGURED: cannot run ingestion for provider "${options.providerId}" (no adapter implementation).`,
    );
  }

  const startedAt = new Date().toISOString();
  const metrics = emptyMetrics();
  const failures: InstrumentFailure[] = [];
  const isRetry = Boolean(options.parentRunId);

  let runId: string | null = null;
  if (!options.dryRun) {
    const proposedBy = await store.ensureSystemActor();
    runId = await store.createRun({
      providerId: options.providerId,
      marketDate: options.marketDate,
      triggerSource: options.triggerSource,
      proposedBy,
      ...(options.parentRunId ? { parentRunId: options.parentRunId } : {}),
    });
    deps.onRunCreated?.(runId);
  }

  log(
    `Starting daily ingestion: ${options.marketDate} (${options.providerId})${options.dryRun ? ' [dry run]' : ''}${isRetry ? ' [retry]' : ''}`,
  );

  let tickers: string[];
  if (isRetry) {
    // A retry run only reprocesses the tickers the caller identified as previously failed —
    // it never re-touches security master or already-successful instruments.
    tickers = options.tickers ?? [];
    metrics.securitiesExpected = tickers.length;
  } else {
    tickers = await refreshSecurityMasterAndResolveTickers(
      adapter,
      store,
      options,
      metrics,
      failures,
      log,
    );
    metrics.securitiesExpected = options.tickers?.length ?? tickers.length;
  }

  if (isRetry) {
    const validCodes = new Set<string>(BVC_SUPPORTED_INDEX_CODES);
    const codes = (options.retryIndexCodes ?? []).filter((code): code is BvcSupportedIndexCode =>
      validCodes.has(code),
    );
    await retryIndexHistoryOnly(adapter, store, options, codes, metrics, failures, log);
  } else {
    await refreshIndices(adapter, store, options, metrics, failures, log);
  }

  await mapConcurrent(tickers, options.concurrency, async (ticker) => {
    await ingestTickerOhlcv(adapter, store, options, runId, ticker, metrics, failures, log);
  });

  const finishedAt = new Date().toISOString();
  const status =
    failures.length === 0
      ? 'succeeded'
      : metrics.securitiesSucceeded > 0 || metrics.indicesSucceeded > 0
        ? 'partial'
        : 'failed';

  if (runId) await store.finalizeRun(runId, { status, metrics, instrumentFailures: failures });
  log(
    `Finished daily ingestion: ${status} (${metrics.securitiesSucceeded}/${metrics.securitiesExpected} securities, ${failures.length} failures)`,
  );

  return {
    runId,
    providerId: options.providerId,
    marketDate: options.marketDate,
    status,
    triggerSource: options.triggerSource,
    dryRun: options.dryRun,
    startedAt,
    finishedAt,
    metrics,
    instrumentFailures: failures,
  };
}

async function refreshSecurityMasterAndResolveTickers(
  adapter: ProviderAdapter,
  store: IngestionStore,
  options: RunOptions,
  metrics: RunMetrics,
  failures: InstrumentFailure[],
  log: (message: string) => void,
): Promise<string[]> {
  try {
    const preview = await withRetry(() => adapter.fetchSecurityMaster(), MAX_ATTEMPTS);
    if (preview.errors.length) throw new Error(`VALIDATION: ${preview.errors.join('; ')}`);
    if (!options.dryRun) await store.upsertSecurityMaster(preview.candidates, options.providerId);
    log(`Security master refreshed: ${preview.candidates.length} rows`);
  } catch (error) {
    recordGlobalFailure(
      failures,
      metrics,
      'security_master',
      'SECURITY_MASTER',
      options.marketDate,
      error,
    );
    log(`Security master refresh failed: ${errorMessage(error)}`);
  }

  const active = await store.getActiveSecurityTickers();
  if (!options.tickers?.length) return active;

  const available = new Set(active);
  const resolved: string[] = [];
  for (const ticker of options.tickers) {
    if (available.has(ticker)) {
      resolved.push(ticker);
    } else {
      failures.push({
        ticker,
        stage: 'ohlcv',
        dateOrRange: options.marketDate,
        errorCode: 'UNKNOWN_TICKER',
        message: `${ticker} is not a known active security`,
        attempts: 0,
        lastAttemptAt: new Date().toISOString(),
      });
      metrics.securitiesFailed += 1;
    }
  }
  return resolved;
}

async function refreshIndices(
  adapter: ProviderAdapter,
  store: IngestionStore,
  options: RunOptions,
  metrics: RunMetrics,
  failures: InstrumentFailure[],
  log: (message: string) => void,
) {
  try {
    const preview = await withRetry(() => adapter.fetchIndexMaster(), MAX_ATTEMPTS);
    if (preview.errors.length) throw new Error(`VALIDATION: ${preview.errors.join('; ')}`);
    if (!options.dryRun) await store.upsertIndexMaster(preview.candidates, options.providerId);
  } catch (error) {
    recordGlobalFailure(
      failures,
      metrics,
      'index_master',
      'INDEX_MASTER',
      options.marketDate,
      error,
    );
    log(`Index master refresh failed: ${errorMessage(error)}`);
  }

  await retryIndexHistoryOnly(
    adapter,
    store,
    options,
    [...BVC_SUPPORTED_INDEX_CODES],
    metrics,
    failures,
    log,
  );
}

async function retryIndexHistoryOnly(
  adapter: ProviderAdapter,
  store: IngestionStore,
  options: RunOptions,
  codes: BvcSupportedIndexCode[],
  metrics: RunMetrics,
  failures: InstrumentFailure[],
  log: (message: string) => void,
) {
  metrics.indicesExpected += codes.length;
  for (const code of codes) {
    let attempts = 0;
    try {
      const preview = await withRetry(async () => {
        attempts += 1;
        return adapter.fetchIndexHistory({
          code,
          startDate: options.marketDate,
          endDate: options.marketDate,
        });
      }, MAX_ATTEMPTS);
      metrics.retryCount += Math.max(0, attempts - 1);
      if (preview.errors.length) throw new Error(`VALIDATION: ${preview.errors.join('; ')}`);
      metrics.rowsReceived += preview.candidates.length;
      if (!options.dryRun) {
        const counts = await store.upsertIndexObservations(preview.candidates, options.providerId);
        const written = counts.inserted + counts.updated;
        metrics.rowsAccepted += written;
        metrics.rowsPublished += written;
      } else {
        metrics.rowsAccepted += preview.candidates.length;
        metrics.rowsPublished += preview.candidates.length;
      }
      metrics.indicesSucceeded += 1;
      log(`${code} index history: ${preview.candidates.length} rows`);
    } catch (error) {
      metrics.retryCount += Math.max(0, attempts - 1);
      metrics.indicesFailed += 1;
      recordFailure(
        failures,
        metrics,
        code,
        'index_history',
        options.marketDate,
        error,
        Math.max(attempts, 1),
      );
      log(`${code} index history failed: ${errorMessage(error)}`);
    }
  }
}

async function ingestTickerOhlcv(
  adapter: ProviderAdapter,
  store: IngestionStore,
  options: RunOptions,
  runId: string | null,
  ticker: string,
  metrics: RunMetrics,
  failures: InstrumentFailure[],
  log: (message: string) => void,
) {
  let attempts = 0;
  try {
    const preview = await withRetry(async () => {
      attempts += 1;
      return adapter.fetchDailyOhlcv({ ticker, date: options.marketDate });
    }, MAX_ATTEMPTS);
    metrics.retryCount += Math.max(0, attempts - 1);
    if (preview.errors.length) throw new Error(`VALIDATION: ${preview.errors.join('; ')}`);
    metrics.rowsReceived += preview.candidates.length;

    if (!preview.candidates.length) {
      // No session for this ticker on this date (e.g. trading suspended) — not a failure.
      metrics.securitiesSucceeded += 1;
      return;
    }

    const rows: NormalizedPriceRow[] = preview.candidates.map((candidate) => ({
      ticker: candidate.ticker,
      marketDate: candidate.marketDate,
      close: candidate.close,
      ...(candidate.open !== undefined ? { open: candidate.open } : {}),
      ...(candidate.high !== undefined ? { high: candidate.high } : {}),
      ...(candidate.low !== undefined ? { low: candidate.low } : {}),
      ...(candidate.volume !== undefined ? { volume: candidate.volume } : {}),
    }));

    if (!options.dryRun && runId) {
      const counts = await store.upsertDailyPrices(rows, runId);
      const written = counts.inserted + counts.updated;
      metrics.rowsAccepted += rows.length - counts.skipped;
      metrics.rowsRejected += counts.skipped;
      metrics.rowsPublished += written;
      if (counts.skipped > 0 && written === 0)
        throw new Error('UNKNOWN_SECURITY: ticker not resolvable to a security id');
    } else {
      metrics.rowsAccepted += rows.length;
      metrics.rowsPublished += rows.length;
    }
    metrics.securitiesSucceeded += 1;
  } catch (error) {
    metrics.retryCount += Math.max(0, attempts - 1);
    metrics.securitiesFailed += 1;
    recordFailure(
      failures,
      metrics,
      ticker,
      'ohlcv',
      options.marketDate,
      error,
      Math.max(attempts, 1),
    );
    log(`${ticker} OHLCV failed: ${errorMessage(error)}`);
  }
}

function recordGlobalFailure(
  failures: InstrumentFailure[],
  metrics: RunMetrics,
  stage: FailureStage,
  label: string,
  dateOrRange: string,
  error: unknown,
) {
  recordFailure(failures, metrics, label, stage, dateOrRange, error, 1);
}

function recordFailure(
  failures: InstrumentFailure[],
  metrics: RunMetrics,
  ticker: string,
  stage: FailureStage,
  dateOrRange: string,
  error: unknown,
  attempts: number,
) {
  const code = errorCode(error);
  metrics.errorSummary[code] = (metrics.errorSummary[code] ?? 0) + 1;
  failures.push({
    ticker,
    stage,
    dateOrRange,
    errorCode: code,
    message: sanitizeMessage(errorMessage(error)),
    attempts,
    lastAttemptAt: new Date().toISOString(),
  });
}

async function withRetry<T>(work: () => Promise<T>, attempts: number): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await work();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function mapConcurrent<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
) {
  if (!items.length) return;
  const bounded = Math.max(1, Math.min(concurrency, items.length));
  let cursor = 0;
  const runners = Array.from({ length: bounded }, async () => {
    while (cursor < items.length) {
      const item = items[cursor]!;
      cursor += 1;
      await worker(item);
    }
  });
  await Promise.all(runners);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function errorCode(error: unknown) {
  const message = errorMessage(error);
  const match =
    /^([A-Z][A-Z0-9_]{2,60}):/.exec(message) ?? /^([A-Z][A-Z0-9_]{2,60})$/.exec(message);
  return match?.[1] ?? 'PROVIDER_INVALID_RESPONSE';
}

function sanitizeMessage(message: string) {
  // Never persist stack traces or full URLs (which may carry query params) in a run record.
  return (message.split('\n')[0] ?? message)
    .replace(/https?:\/\/\S+/g, '[redacted-url]')
    .slice(0, 500);
}
