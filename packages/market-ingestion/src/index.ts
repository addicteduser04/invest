export * from './types';
export { resolveIngestionProvider, type ProviderResolution, type EnvLike } from './provider-policy';
export { createProviderAdapter, type ProviderAdapter, type FetchResult } from './providers';
export {
  PgIngestionStore,
  type IngestionStore,
  type StoredRun,
  type CreateRunInput,
  type FinalizeRunInput,
} from './store';
export { runDailyIngestion, type PipelineDeps } from './pipeline';
export { buildRetryPlan, type RetryPlan } from './retry';
export {
  parseCliArgs,
  parseIsoDate,
  parseTickers,
  parseConcurrency,
  normalizeTicker,
  DEFAULT_CONCURRENCY,
  MAX_CONCURRENCY,
  type CliOptions,
} from './cli-args';

/** Today's market date in Africa/Casablanca, as an ISO date — the default --date target. */
export function todayInCasablanca(now: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Casablanca' });
  return formatter.format(now); // en-CA formats as YYYY-MM-DD
}
