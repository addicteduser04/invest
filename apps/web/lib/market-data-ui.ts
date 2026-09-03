// Import the pure staleness module directly (not the package barrel), which also pulls in
// Node-only code (crypto, csv-parse) used by the BVC fetch layer — fine for server code, but
// this module is imported by client components, so it must stay bundler-safe.
import { isMarketDateStale } from '@bvc/market-data/staleness';

export interface RunMetrics {
  securitiesExpected: number;
  securitiesSucceeded: number;
  securitiesFailed: number;
  rowsReceived: number;
  rowsAccepted: number;
  rowsRejected: number;
  rowsPublished: number;
  indicesExpected: number;
  indicesSucceeded: number;
  indicesFailed: number;
  retryCount: number;
  errorSummary: Record<string, number>;
}

export interface InstrumentFailure {
  ticker: string;
  stage: 'security_master' | 'index_master' | 'index_history' | 'ohlcv';
  dateOrRange: string;
  errorCode: string;
  message: string;
  attempts: number;
  lastAttemptAt: string;
}

export type RunStatus = 'running' | 'succeeded' | 'partial' | 'failed';

export interface UiRun {
  id: string;
  providerId: string;
  marketDate: string | null;
  status: RunStatus;
  triggerSource: string;
  startedAt: string;
  finishedAt: string | null;
  metrics: RunMetrics;
  instrumentFailures: InstrumentFailure[];
  parentRunId: string | null;
}

const emptyMetrics: RunMetrics = {
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
};

/** Normalizes a run row from either the snake_case RPC shape or the camelCase pipeline
 * summary shape into one consistent UI shape. */
export function normalizeRun(row: Record<string, unknown>): UiRun {
  return {
    id: String(row['id']),
    providerId: String(row['provider_id'] ?? row['providerId'] ?? ''),
    marketDate: (row['market_date'] ?? row['marketDate'] ?? null) as string | null,
    status: (row['status'] as RunStatus) ?? 'failed',
    triggerSource: String(row['trigger_source'] ?? row['triggerSource'] ?? ''),
    startedAt: String(row['started_at'] ?? row['startedAt'] ?? ''),
    finishedAt: (row['finished_at'] ?? row['finishedAt'] ?? null) as string | null,
    metrics: (row['metrics'] as RunMetrics) ?? emptyMetrics,
    instrumentFailures: (row['instrument_failures'] ??
      row['instrumentFailures'] ??
      []) as InstrumentFailure[],
    parentRunId: (row['parent_run_id'] ?? row['parentRunId'] ?? null) as string | null,
  };
}

export type HealthStatus = 'healthy' | 'stale' | 'running' | 'partial' | 'failed' | 'no_data';

export interface OperationalSnapshot {
  latestEquityDate: string | null;
  latestIndexDate: string | null;
  lastRun: Record<string, unknown> | null;
  coverage: Array<{
    securityId: string;
    ticker: string;
    name: string;
    latestMarketDate: string | null;
    failedLastRun: boolean;
  }>;
  indices: Array<{
    code: string;
    name: string;
    latestMarketDate: string | null;
    latestCloseValue: string | null;
  }>;
}

export function computeHealthStatus(
  snapshot: OperationalSnapshot,
  now: Date = new Date(),
): HealthStatus {
  if (!snapshot.lastRun) return 'no_data';
  const lastRunStatus = snapshot.lastRun['status'] as RunStatus;
  if (lastRunStatus === 'running') return 'running';
  if (lastRunStatus === 'failed') return 'failed';
  if (lastRunStatus === 'partial') return 'partial';
  const equityStale = snapshot.latestEquityDate
    ? isMarketDateStale(snapshot.latestEquityDate, now)
    : true;
  const indexStale = snapshot.latestIndexDate
    ? isMarketDateStale(snapshot.latestIndexDate, now)
    : true;
  return equityStale || indexStale ? 'stale' : 'healthy';
}

export type CoverageStatus = 'current' | 'stale' | 'no_history' | 'failed_last_run';

export function computeCoverageStatus(
  entry: { latestMarketDate: string | null; failedLastRun: boolean },
  now: Date = new Date(),
): CoverageStatus {
  if (entry.failedLastRun) return 'failed_last_run';
  if (!entry.latestMarketDate) return 'no_history';
  return isMarketDateStale(entry.latestMarketDate, now) ? 'stale' : 'current';
}

export type FreshnessStatus = 'current' | 'stale' | 'no_data';

export function computeFreshness(
  latestMarketDate: string | null,
  now: Date = new Date(),
): FreshnessStatus {
  if (!latestMarketDate) return 'no_data';
  return isMarketDateStale(latestMarketDate, now) ? 'stale' : 'current';
}

export function formatDuration(startedAt: string, finishedAt: string | null): string {
  if (!finishedAt) return '—';
  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}
