export interface CliOptions {
  date?: string;
  tickers?: string[];
  dryRun: boolean;
  retryFailed: boolean;
  concurrency: number;
}

export const DEFAULT_CONCURRENCY = 2;
export const MAX_CONCURRENCY = 5;

export function parseCliArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    dryRun: false,
    retryFailed: false,
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
    else if (arg === '--concurrency') options.concurrency = parseConcurrency(readValue());
    else if (arg === '--help' || arg === '-h') throw new Error(helpText());
    else throw new Error(`Unknown option: ${arg}`);
  }
  return options;
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
    '  --concurrency 2          Concurrent instrument fetches (default 2, max 5)',
  ].join('\n');
}
