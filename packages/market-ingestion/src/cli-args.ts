import type { TriggerSource } from './types';

export interface CliOptions {
  date?: string;
  tickers?: string[];
  dryRun: boolean;
  retryFailed: boolean;
  /** Retry this specific partial/failed run (what the admin UI's retry action dispatches). */
  retryRunId?: string;
  /** Only recover stale 'running' runs, then exit without ingesting. */
  recoverStale: boolean;
  /** Who initiated a non-retry run; retries are always recorded as 'retry'. */
  triggerSource: Exclude<TriggerSource, 'retry'>;
  concurrency: number;
}

export const DEFAULT_CONCURRENCY = 2;
export const MAX_CONCURRENCY = 5;

export function parseCliArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    dryRun: false,
    retryFailed: false,
    recoverStale: false,
    triggerSource: 'cli',
    concurrency: DEFAULT_CONCURRENCY,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === '--') continue;
    const readValue = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
      index += 1;
      return value;
    };
    if (arg === '--date') options.date = parseIsoDate(readValue());
    else if (arg === '--ticker') options.tickers = [normalizeTicker(readValue())];
    else if (arg === '--tickers') options.tickers = parseTickers(readValue());
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--retry-failed') options.retryFailed = true;
    else if (arg === '--retry-run') options.retryRunId = parseRunId(readValue());
    else if (arg === '--recover-stale') options.recoverStale = true;
    else if (arg === '--trigger-source') options.triggerSource = parseTriggerSource(readValue());
    else if (arg === '--concurrency') options.concurrency = parseConcurrency(readValue());
    else if (arg === '--help' || arg === '-h') throw new Error(helpText());
    else throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

export function parseRunId(value: string) {
  const id = value.trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id))
    throw new Error(`Invalid run id: ${value}`);
  return id;
}

function parseTriggerSource(value: string): CliOptions['triggerSource'] {
  if (value === 'schedule' || value === 'manual' || value === 'cli') return value;
  throw new Error(`--trigger-source must be one of schedule, manual, cli`);
}

export function parseIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new Error(`Invalid date: ${value} (expected YYYY-MM-DD)`);
  return value;
}

export function normalizeTicker(value: string) {
  const ticker = value.trim().toUpperCase();
  if (!/^[A-Z0-9._-]{1,20}$/.test(ticker)) throw new Error(`Invalid ticker: ${value}`);
  return ticker;
}

export function parseTickers(value: string) {
  const tickers = value.split(',').map(normalizeTicker).filter(Boolean);
  if (!tickers.length) throw new Error('--tickers requires at least one ticker');
  return [...new Set(tickers)];
}

export function parseConcurrency(value: string) {
  const concurrency = Number(value);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > MAX_CONCURRENCY)
    throw new Error(`--concurrency must be between 1 and ${MAX_CONCURRENCY}`);
  return concurrency;
}

function helpText() {
  return [
    'Usage: pnpm market:daily -- [options]',
    '',
    'Options:',
    '  --date 2026-09-01        Target market date (default: today, Africa/Casablanca)',
    '  --ticker IAM             Ingest one active security',
    '  --tickers IAM,ATW,BCP    Ingest selected active securities',
    '  --dry-run                Fetch and validate without writing',
    '  --retry-failed           Retry the most recent partial/failed run (scoped by --date/--ticker(s) if given)',
    '  --retry-run <run-id>     Retry the failed instruments of one specific partial/failed run',
    '  --recover-stale          Only mark stale running runs as failed, then exit',
    '  --trigger-source manual  Record the run as schedule, manual or cli (default cli)',
    '  --concurrency 2          Concurrent instrument fetches (default 2, max 5)',
  ].join('\n');
}
