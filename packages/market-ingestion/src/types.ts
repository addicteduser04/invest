export type ProviderId = 'bvc_public_testing' | 'licensed_api' | 'licensed_sftp';

export const PROVIDER_IDS: ProviderId[] = ['bvc_public_testing', 'licensed_api', 'licensed_sftp'];

export type TriggerSource = 'schedule' | 'manual' | 'retry' | 'cli';

export type RunStatus = 'running' | 'succeeded' | 'partial' | 'failed';

export type FailureStage = 'security_master' | 'index_master' | 'index_history' | 'ohlcv';

export interface InstrumentFailure {
  ticker: string;
  stage: FailureStage;
  dateOrRange: string;
  errorCode: string;
  message: string;
  attempts: number;
  lastAttemptAt: string;
}

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

export function emptyMetrics(): RunMetrics {
  return {
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
}

export interface RunOptions {
  providerId: ProviderId;
  marketDate: string;
  tickers?: string[];
  /** Only meaningful when parentRunId is set: which index codes to retry (from a prior run's failures). */
  retryIndexCodes?: string[];
  dryRun: boolean;
  concurrency: number;
  triggerSource: TriggerSource;
  parentRunId?: string;
}

export interface RunSummary {
  runId: string | null;
  providerId: ProviderId;
  marketDate: string;
  status: RunStatus;
  triggerSource: TriggerSource;
  dryRun: boolean;
  startedAt: string;
  finishedAt: string;
  metrics: RunMetrics;
  instrumentFailures: InstrumentFailure[];
}

export interface NormalizedPriceRow {
  ticker: string;
  marketDate: string;
  open?: string;
  high?: string;
  low?: string;
  close: string;
  volume?: string;
}

export interface Counts {
  inserted: number;
  updated: number;
}
