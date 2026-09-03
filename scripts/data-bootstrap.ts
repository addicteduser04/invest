import { createHash } from 'node:crypto';
import { request as httpsRequest } from 'node:https';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Pool, type PoolClient, type QueryResult } from 'pg';
import {
  BVC_SUPPORTED_INDEX_CODES,
  fetchBvcHistoricalRangePreview,
  fetchBvcIndexHistoryPreview,
  fetchBvcIndexMasterPreview,
  fetchBvcLatestMarketPreview,
  fetchBvcSecurityMasterPreview,
  type BvcHistoricalCandidate,
  type BvcIndexCandidate,
  type BvcIndexObservationCandidate,
  type BvcLatestMarketPreview,
  type BvcSupportedIndexCode,
  type SecurityMasterCandidate,
} from '../packages/market-data/src/index';

const BOOTSTRAP_ACTOR_ID = '00000000-0000-4000-8000-000000000001';
const DAY_MS = 24 * 60 * 60 * 1000;
const STOCK_HISTORY_WINDOW_DAYS = 180;

export interface BootstrapOptions {
  tickers?: string[];
  years: number;
  dryRun: boolean;
  concurrency: number;
  now: Date;
}

export interface BootstrapSummary {
  securities: StepCounts;
  stockHistory: StepCounts;
  indices: StepCounts;
  indexHistory: StepCounts;
  latestValues: StepCounts;
  failures: string[];
  skips: string[];
  startedAt: number;
  elapsedMs: number;
}

export interface StepCounts {
  inserted: number;
  updated: number;
  skipped: number;
}

export interface BvcBootstrapStore {
  ensureBootstrapActor(): Promise<void>;
  getActiveBvcEquityTickers(): Promise<string[]>;
  upsertSecurityMaster(rows: SecurityMasterCandidate[]): Promise<StepCounts>;
  upsertIndexMaster(rows: BvcIndexCandidate[]): Promise<StepCounts>;
  upsertIndexHistory(rows: BvcIndexObservationCandidate[]): Promise<StepCounts>;
  upsertStockHistory(ticker: string, rows: BvcHistoricalCandidate[]): Promise<StepCounts>;
  upsertLatestSnapshots(
    preview: BvcLatestMarketPreview,
    allowedTickers: Set<string>,
    marketDate: string,
  ): Promise<StepCounts>;
  close(): Promise<void>;
}

export interface BvcBootstrapConnectors {
  fetchSecurityMaster(): Promise<{ candidates: SecurityMasterCandidate[]; errors: string[] }>;
  fetchIndexMaster(): Promise<{ candidates: BvcIndexCandidate[]; errors: string[] }>;
  fetchIndexHistory(input: {
    code: BvcSupportedIndexCode;
    startDate: string;
    endDate: string;
  }): Promise<{ candidates: BvcIndexObservationCandidate[]; errors: string[] }>;
  fetchStockHistory(input: {
    ticker: string;
    startDate: string;
    endDate: string;
  }): Promise<{ candidates: BvcHistoricalCandidate[]; errors: string[] }>;
  fetchLatestMarket(): Promise<BvcLatestMarketPreview>;
}

type Env = Record<string, string>;

const emptyCounts = (): StepCounts => ({ inserted: 0, updated: 0, skipped: 0 });

const addCounts = (target: StepCounts, source: StepCounts) => {
  target.inserted += source.inserted;
  target.updated += source.updated;
  target.skipped += source.skipped;
};

const isoDate = (date: Date) => date.toISOString().slice(0, 10);

export function parseBootstrapArgs(argv: string[], now = new Date()): BootstrapOptions {
  const options: BootstrapOptions = { years: 3, dryRun: false, concurrency: 1, now };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === '--') continue;
    const readValue = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
      index += 1;
      return value;
    };
    if (arg === '--ticker') options.tickers = [normalizeTicker(readValue())];
    else if (arg === '--tickers') options.tickers = parseTickers(readValue());
    else if (arg === '--years') options.years = parseYears(readValue());
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--concurrency') options.concurrency = parseConcurrency(readValue());
    else if (arg === '--help' || arg === '-h') throw new Error(helpText());
    else throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

export function dateRangeForYears(years: number, now = new Date()) {
  const endDate = isoDate(now);
  const start = new Date(
    Date.UTC(now.getUTCFullYear() - years, now.getUTCMonth(), now.getUTCDate()),
  );
  return { startDate: isoDate(start), endDate };
}

export interface DateWindow {
  startDate: string;
  endDate: string;
}

export function stockHistoryWindows(startDate: string, endDate: string): DateWindow[] {
  const end = parseIsoDate(endDate);
  let cursor = parseIsoDate(startDate);
  if (cursor.getTime() > end.getTime()) throw new Error('startDate must be before endDate');

  const windows: DateWindow[] = [];
  while (cursor.getTime() <= end.getTime()) {
    const windowEnd = new Date(
      Math.min(cursor.getTime() + STOCK_HISTORY_WINDOW_DAYS * DAY_MS, end.getTime()),
    );
    windows.push({ startDate: isoDate(cursor), endDate: isoDate(windowEnd) });
    cursor = new Date(windowEnd.getTime() + DAY_MS);
  }
  return windows;
}

export function loadDotEnvLocal(path = resolve(process.cwd(), '.env.local')): Env {
  const env: Env = {};
  let text = '';
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return env;
  }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
    if (!match) continue;
    const [, key, raw = ''] = match;
    env[key] = raw.replace(/^['"]|['"]$/g, '');
  }
  return env;
}

export function assertLocalBootstrapEnvironment(env: Env) {
  const supabaseUrl = env['NEXT_PUBLIC_SUPABASE_URL'] ?? env['SUPABASE_URL'] ?? '';
  const databaseUrl = env['WORKER_DATABASE_URL'] ?? env['DATABASE_URL'] ?? '';
  if (env['BVC_PUBLIC_TESTING_ENABLED'] !== 'true')
    throw new Error('BVC_PUBLIC_TESTING_ENABLED=true is required for local BVC bootstrap');
  if (!isLocalHttpUrl(supabaseUrl))
    throw new Error('Refusing to bootstrap: Supabase URL must be localhost or 127.0.0.1');
  if (!isLocalPostgresUrl(databaseUrl))
    throw new Error('Refusing to bootstrap: database URL must target localhost or 127.0.0.1');
  if (!env['SUPABASE_SERVICE_ROLE_KEY'])
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required in root .env.local');
  return { supabaseUrl, databaseUrl };
}

export const defaultConnectors: BvcBootstrapConnectors = {
  fetchSecurityMaster: () => fetchBvcSecurityMasterPreview(bvcPublicTestingFetch),
  fetchIndexMaster: async () => {
    try {
      const preview = await fetchBvcIndexMasterPreview(bvcPublicTestingFetch);
      if (!preview.errors.length) return preview;
    } catch {
      // Fall through to the live-market page, which currently exposes the same supported
      // MASI-family index definitions more reliably than the market-data index page.
    }
    const latest = await fetchBvcLatestMarketPreview(bvcPublicTestingFetch);
    return { candidates: latest.indices, errors: latest.errors };
  },
  fetchIndexHistory: ({ code, startDate, endDate }) =>
    fetchBvcIndexHistoryPreview({ code, startDate, endDate }, bvcPublicTestingFetch),
  fetchStockHistory: ({ ticker, startDate, endDate }) =>
    fetchBvcHistoricalRangePreview(
      { instrument: ticker, startDate, endDate },
      bvcPublicTestingFetch,
    ),
  fetchLatestMarket: () => fetchBvcLatestMarketPreview(bvcPublicTestingFetch),
};

export class PgBvcBootstrapStore implements BvcBootstrapStore {
  private readonly pool: Pool;

  constructor(
    databaseUrl: string,
    private readonly dryRun = false,
  ) {
    this.pool = new Pool({ connectionString: databaseUrl, max: 2 });
  }

  async close() {
    await this.pool.end();
  }

  async ensureBootstrapActor() {
    if (this.dryRun) return;
    await this.withTransaction(async (client) => {
      await client.query(
        `insert into auth.users(id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
         values($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'local-bvc-bootstrap@saifinvest.test', '', '{}', '{"locale":"en","display_name":"Local BVC Bootstrap"}', now(), now())
         on conflict(id) do nothing`,
        [BOOTSTRAP_ACTOR_ID],
      );
      await client.query(
        `insert into public.profiles(id, display_name, locale)
         values($1, 'Local BVC Bootstrap', 'en')
         on conflict(id) do update set display_name=excluded.display_name, locale=excluded.locale, updated_at=now()`,
        [BOOTSTRAP_ACTOR_ID],
      );
      await client.query(
        `insert into public.user_roles(user_id, role)
         values($1, 'data_admin')
         on conflict do nothing`,
        [BOOTSTRAP_ACTOR_ID],
      );
    });
  }

  async getActiveBvcEquityTickers() {
    const result = await this.pool.query<{ ticker: string }>(
      `select ticker
       from market.securities
       where listing_status='active'
         and is_synthetic=false
         and source_provider_id='bvc_public_testing'
       order by ticker`,
    );
    return result.rows.map((row) => row.ticker);
  }

  async upsertSecurityMaster(rows: SecurityMasterCandidate[]) {
    if (this.dryRun) return { inserted: rows.length, updated: 0, skipped: 0 };
    return this.withTransaction((client) => upsertSecurityMasterRows(client, rows));
  }

  async upsertIndexMaster(rows: BvcIndexCandidate[]) {
    if (this.dryRun) return { inserted: rows.length, updated: 0, skipped: 0 };
    return this.withTransaction((client) => upsertIndexMasterRows(client, rows));
  }

  async upsertIndexHistory(rows: BvcIndexObservationCandidate[]) {
    if (this.dryRun) return { inserted: rows.length, updated: 0, skipped: 0 };
    return this.withTransaction((client) => upsertIndexHistoryRows(client, rows));
  }

  async upsertStockHistory(ticker: string, rows: BvcHistoricalCandidate[]) {
    if (this.dryRun) return { inserted: rows.length, updated: 0, skipped: 0 };
    return this.withTransaction(async (client) => {
      const runId = await ensureIngestionRun(
        client,
        hashKey(
          `stock:${ticker}:${rows[0]?.marketDate ?? 'empty'}:${rows.at(-1)?.marketDate ?? 'empty'}`,
        ),
        `local://bvc-bootstrap/stocks/${ticker}`,
        rows.at(-1)?.marketDate ?? null,
      );
      return upsertStockRows(client, rows, runId, 'published');
    });
  }

  async upsertLatestSnapshots(
    preview: BvcLatestMarketPreview,
    allowedTickers: Set<string>,
    marketDate: string,
  ) {
    const rows = preview.snapshots
      .filter((snapshot) => snapshot.price && allowedTickers.has(snapshot.ticker))
      .map<BvcHistoricalCandidate>((snapshot, index) => ({
        row: index + 2,
        ticker: snapshot.ticker,
        marketDate,
        close: snapshot.price!,
        ...(snapshot.volume ? { volume: snapshot.volume } : {}),
        companyName: snapshot.label,
        sourceTimestamp: preview.session.timestamp,
        tradedValue: null,
        transactionCount: null,
        marketCap: null,
      }));
    if (this.dryRun) return { inserted: rows.length, updated: 0, skipped: 0 };
    return this.withTransaction(async (client) => {
      const runId = await ensureIngestionRun(
        client,
        hashKey(`latest:${marketDate}:${preview.sourceHash}`),
        `local://bvc-bootstrap/latest/${marketDate}`,
        marketDate,
      );
      return upsertStockRows(client, rows, runId, 'provisional');
    });
  }

  private async withTransaction<T>(work: (client: PoolClient) => Promise<T>) {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const result = await work(client);
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }
}

export async function runBvcBootstrap(
  options: BootstrapOptions,
  store: BvcBootstrapStore,
  connectors: BvcBootstrapConnectors = defaultConnectors,
  log: (message: string) => void = console.log,
): Promise<BootstrapSummary> {
  const startedAt = Date.now();
  const summary: BootstrapSummary = {
    securities: emptyCounts(),
    stockHistory: emptyCounts(),
    indices: emptyCounts(),
    indexHistory: emptyCounts(),
    latestValues: emptyCounts(),
    failures: [],
    skips: [],
    startedAt,
    elapsedMs: 0,
  };
  const { startDate, endDate } = dateRangeForYears(options.years, options.now);
  const stockWindows = stockHistoryWindows(startDate, endDate).reverse();
  const requestedTickers = new Set(options.tickers ?? []);
  let securityMasterTickers: string[] = [];

  await store.ensureBootstrapActor();
  log(`BVC local bootstrap: ${startDate} to ${endDate}${options.dryRun ? ' (dry run)' : ''}`);

  await runStep('security master', summary.failures, log, async () => {
    const preview = await retryBvcFetch(() => connectors.fetchSecurityMaster());
    failOnPreviewErrors('security master', preview.errors);
    securityMasterTickers = preview.candidates
      .filter((candidate) => candidate.listingStatus === 'active')
      .map((candidate) => candidate.ticker)
      .sort();
    const counts = await store.upsertSecurityMaster(preview.candidates);
    addCounts(summary.securities, counts);
  });

  let tickers = options.dryRun ? securityMasterTickers : await store.getActiveBvcEquityTickers();
  if (requestedTickers.size) {
    const available = new Set(tickers);
    for (const ticker of requestedTickers) {
      if (!available.has(ticker))
        summary.skips.push(`${ticker}: not present as an active BVC equity`);
    }
    tickers = [...requestedTickers].filter((ticker) => available.has(ticker));
  }
  log(`Stocks selected: ${tickers.length}${tickers.length ? ` (${tickers.join(', ')})` : ''}`);

  await runStep('index master', summary.failures, log, async () => {
    const preview = await retryBvcFetch(() => connectors.fetchIndexMaster());
    failOnPreviewErrors('index master', preview.errors);
    const counts = await store.upsertIndexMaster(preview.candidates);
    addCounts(summary.indices, counts);
  });

  for (const code of BVC_SUPPORTED_INDEX_CODES) {
    await runSkippableStep(`${code} index history`, summary, log, async () => {
      const preview = await retryBvcFetch(() =>
        connectors.fetchIndexHistory({ code, startDate, endDate }),
      );
      failOnPreviewErrors(`${code} index history`, preview.errors);
      const counts = await store.upsertIndexHistory(preview.candidates);
      addCounts(summary.indexHistory, counts);
      log(`  ${code}: ${counts.inserted} inserted, ${counts.updated} updated`);
    });
  }

  await mapConcurrent(tickers, options.concurrency, async (ticker) => {
    await runStep(`${ticker} stock history`, summary.failures, log, async () => {
      const counts = await bootstrapStockHistoryChunks(
        ticker,
        stockWindows,
        store,
        connectors,
        log,
      );
      addCounts(summary.stockHistory, counts);
      log(`  ${ticker}: ${counts.inserted} inserted, ${counts.updated} updated`);
    });
  });

  await runStep('latest market values', summary.failures, log, async () => {
    const preview = await retryBvcFetch(() => connectors.fetchLatestMarket());
    failOnPreviewErrors('latest market values', preview.errors);
    const latestDate = marketDateFromBvcTimestamp(preview.session.timestamp, options.now);
    const counts = await store.upsertLatestSnapshots(preview, new Set(tickers), latestDate);
    addCounts(summary.latestValues, counts);
  });

  summary.elapsedMs = Date.now() - startedAt;
  return summary;
}

export function printSummary(
  summary: BootstrapSummary,
  log: (message: string) => void = console.log,
) {
  log('');
  log('BVC local bootstrap summary');
  log(
    `  securities inserted/updated: ${summary.securities.inserted}/${summary.securities.updated}`,
  );
  log(
    `  stock-history rows inserted/updated: ${summary.stockHistory.inserted}/${summary.stockHistory.updated}`,
  );
  log(`  indices inserted/updated: ${summary.indices.inserted}/${summary.indices.updated}`);
  log(
    `  index-history rows inserted/updated: ${summary.indexHistory.inserted}/${summary.indexHistory.updated}`,
  );
  log(
    `  latest market values inserted/updated: ${summary.latestValues.inserted}/${summary.latestValues.updated}`,
  );
  log(`  failures/skips: ${summary.failures.length}/${summary.skips.length}`);
  for (const failure of summary.failures) log(`    failure: ${failure}`);
  for (const skip of summary.skips) log(`    skip: ${skip}`);
  log(`  elapsed time: ${(summary.elapsedMs / 1000).toFixed(1)}s`);
}

async function upsertSecurityMasterRows(client: Queryable, rows: SecurityMasterCandidate[]) {
  const counts = emptyCounts();
  for (const row of rows) {
    const existing = await client.query<{ id: string }>(
      `select id from market.securities
       where ticker=$1 and listing_status <> 'delisted'
       order by updated_at desc
       limit 1
       for update`,
      [row.ticker],
    );
    if (existing.rowCount) {
      await client.query(
        `update market.securities
         set name=$2, sector=$3, listing_status=$4, listed_on=coalesce($5::date, listed_on),
             is_synthetic=false, isin=coalesce($6, isin), issuer_name=coalesce($7, issuer_name),
             instrument_type=coalesce($8, instrument_type), market_segment=coalesce($9, market_segment),
             share_count=coalesce($10::numeric, share_count), source_provider_id='bvc_public_testing',
             source_identifier=coalesce($11, source_identifier), source_fetched_at=now(), updated_at=now()
         where id=$1`,
        [
          existing.rows[0]!.id,
          row.name,
          row.sector,
          row.listingStatus,
          row.listedOn,
          row.isin ?? null,
          row.issuerName ?? null,
          row.instrumentType ?? null,
          row.marketSegment ?? null,
          row.shareCount ?? null,
          row.sourceId ?? null,
        ],
      );
      counts.updated += 1;
    } else {
      await client.query(
        `insert into market.securities(
           name, ticker, sector, listing_status, listed_on, is_synthetic, isin, issuer_name,
           instrument_type, market_segment, share_count, source_provider_id, source_identifier, source_fetched_at
         ) values($1,$2,$3,$4,$5,false,$6,$7,$8,$9,$10,'bvc_public_testing',$11,now())`,
        [
          row.name,
          row.ticker,
          row.sector,
          row.listingStatus,
          row.listedOn,
          row.isin ?? null,
          row.issuerName ?? null,
          row.instrumentType ?? null,
          row.marketSegment ?? null,
          row.shareCount ?? null,
          row.sourceId ?? null,
        ],
      );
      counts.inserted += 1;
    }
  }
  return counts;
}

async function upsertIndexMasterRows(client: Queryable, rows: BvcIndexCandidate[]) {
  const counts = emptyCounts();
  for (const row of rows) {
    const result = await client.query<{ inserted: boolean }>(
      `insert into market.indices(source_provider_id, source_code, name, family, currency, status)
       values('bvc_public_testing',$1,$2,$3,null,'active')
       on conflict(source_provider_id, source_code) do update
         set name=excluded.name, family=excluded.family, updated_at=now()
       returning xmax = 0 as inserted`,
      [row.code, row.name.en ?? row.name.fr ?? row.code, row.family.en ?? row.family.fr ?? null],
    );
    if (result.rows[0]?.inserted) counts.inserted += 1;
    else counts.updated += 1;
  }
  return counts;
}

async function upsertIndexHistoryRows(client: Queryable, rows: BvcIndexObservationCandidate[]) {
  const counts = emptyCounts();
  for (const row of rows) {
    const index = await ensureIndex(client, row.code);
    const updated = await client.query(
      `update market.index_observations
       set close_value=$3, high_value=$4, low_value=$5, change_percent=$6, change_ytd=$7,
           volume=$8, transaction_count=$9, source_timestamp=$10, created_by=$11, published_at=now()
       where index_id=$1 and market_date=$2 and source_provider_id='bvc_public_testing'
         and status in ('published','provisional')`,
      [
        index,
        row.marketDate,
        row.close,
        row.high,
        row.low,
        row.changePercent,
        row.changeYtd,
        row.volume,
        row.transactionCount,
        row.sourceTimestamp,
        BOOTSTRAP_ACTOR_ID,
      ],
    );
    if (updated.rowCount) counts.updated += updated.rowCount;
    else {
      await client.query(
        `insert into market.index_observations(
           index_id, market_date, close_value, high_value, low_value, change_percent, change_ytd,
           volume, transaction_count, source_provider_id, source_timestamp, status, created_by, published_at
         ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,'bvc_public_testing',$10,'published',$11,now())`,
        [
          index,
          row.marketDate,
          row.close,
          row.high,
          row.low,
          row.changePercent,
          row.changeYtd,
          row.volume,
          row.transactionCount,
          row.sourceTimestamp,
          BOOTSTRAP_ACTOR_ID,
        ],
      );
      counts.inserted += 1;
    }
  }
  return counts;
}

async function upsertStockRows(
  client: Queryable,
  rows: BvcHistoricalCandidate[],
  ingestionRunId: string,
  status: 'published' | 'provisional',
) {
  const counts = emptyCounts();
  for (const row of rows) {
    const security = await client.query<{ id: string }>(
      `select id from market.securities
       where ticker=$1 and listing_status in ('active','suspended')
       order by updated_at desc
       limit 1`,
      [row.ticker],
    );
    const securityId = security.rows[0]?.id;
    if (!securityId) {
      counts.skipped += 1;
      continue;
    }
    const updated = await client.query(
      `update market.prices
       set open_price=$3, high_price=$4, low_price=$5, close_price=$6, volume=$7,
           ingestion_run_id=$8, published_at=now()
       where security_id=$1 and market_date=$2 and status in ('published','provisional')`,
      [
        securityId,
        row.marketDate,
        row.open ?? null,
        row.high ?? null,
        row.low ?? null,
        row.close,
        row.volume ?? null,
        ingestionRunId,
      ],
    );
    if (updated.rowCount) counts.updated += updated.rowCount;
    else {
      await client.query(
        `insert into market.prices(
           security_id, market_date, open_price, high_price, low_price, close_price, volume,
           status, ingestion_run_id, published_at
         ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,now())`,
        [
          securityId,
          row.marketDate,
          row.open ?? null,
          row.high ?? null,
          row.low ?? null,
          row.close,
          row.volume ?? null,
          status,
          ingestionRunId,
        ],
      );
      counts.inserted += 1;
    }
  }
  return counts;
}

async function ensureIndex(client: Queryable, code: string) {
  const result = await client.query<{ id: string }>(
    `insert into market.indices(source_provider_id, source_code, name, status)
     values('bvc_public_testing',$1,$1,'active')
     on conflict(source_provider_id, source_code) do update set updated_at=now()
     returning id`,
    [code],
  );
  return result.rows[0]!.id;
}

async function ensureIngestionRun(
  client: Queryable,
  sourceHash: string,
  objectPath: string,
  marketDate: string | null,
) {
  const result = await client.query<{ id: string }>(
    `insert into market.ingestion_runs(
       provider_id, market_date, status, source_hash, original_object_path, mapping,
       validation_report, proposed_by, reviewed_by, review_reason, reviewed_at, published_at
     ) values(
       'admin_csv', $2, 'published', $1, $3, '{"localBootstrap":true}'::jsonb,
       '{"source":"bvc_public_testing"}'::jsonb, $4, null, 'Local BVC bootstrap', now(), now()
     )
     on conflict(source_hash) do update
       set market_date=coalesce(excluded.market_date, market.ingestion_runs.market_date),
           status='published', published_at=now()
     returning id`,
    [sourceHash, marketDate, objectPath, BOOTSTRAP_ACTOR_ID],
  );
  return result.rows[0]!.id;
}

async function runStep(
  label: string,
  failures: string[],
  log: (message: string) => void,
  step: () => Promise<void>,
) {
  log(`Starting ${label}...`);
  try {
    await step();
    log(`Finished ${label}.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push(`${label}: ${message}`);
    log(`Failed ${label}: ${message}`);
  }
}

async function runSkippableStep(
  label: string,
  summary: BootstrapSummary,
  log: (message: string) => void,
  step: () => Promise<void>,
) {
  log(`Starting ${label}...`);
  try {
    await step();
    log(`Finished ${label}.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isBvcPublicSourceUnavailable(message)) {
      summary.skips.push(`${label}: ${message}`);
      log(`Skipped ${label}: ${message}`);
      return;
    }
    summary.failures.push(`${label}: ${message}`);
    log(`Failed ${label}: ${message}`);
  }
}

async function mapConcurrent<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
) {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor]!;
      cursor += 1;
      await worker(item);
    }
  });
  await Promise.all(runners);
}

async function bootstrapStockHistoryChunks(
  ticker: string,
  windows: DateWindow[],
  store: BvcBootstrapStore,
  connectors: BvcBootstrapConnectors,
  log: (message: string) => void,
) {
  const total = emptyCounts();
  const seenMarketDates = new Set<string>();

  for (const window of windows) {
    const rangeLabel = `${ticker} ${window.startDate}..${window.endDate}`;
    let preview: { candidates: BvcHistoricalCandidate[]; errors: string[] };
    try {
      preview = await retryBvcFetch(() =>
        connectors.fetchStockHistory({
          ticker,
          startDate: window.startDate,
          endDate: window.endDate,
        }),
      );
      failOnPreviewErrors(`${rangeLabel} stock history`, preview.errors);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${rangeLabel}: ${message}`);
    }

    const rows = dedupeStockHistoryCandidates(preview.candidates, seenMarketDates);
    if (!rows.length) {
      log(`  ${rangeLabel}: 0 rows`);
      continue;
    }
    const counts = await store.upsertStockHistory(ticker, rows);
    addCounts(total, counts);
    log(`  ${rangeLabel}: ${counts.inserted} inserted, ${counts.updated} updated`);
  }

  return total;
}

function dedupeStockHistoryCandidates(
  rows: BvcHistoricalCandidate[],
  seenMarketDates = new Set<string>(),
) {
  return rows
    .slice()
    .sort((left, right) => left.marketDate.localeCompare(right.marketDate))
    .filter((row) => {
      if (seenMarketDates.has(row.marketDate)) return false;
      seenMarketDates.add(row.marketDate);
      return true;
    });
}

function failOnPreviewErrors(label: string, errors: string[]) {
  if (errors.length) throw new Error(`${label} returned validation errors: ${errors.join('; ')}`);
}

function isBvcPublicSourceUnavailable(message: string) {
  return (
    message.includes('BVC_INVALID_RESPONSE') ||
    message.includes('BVC_HTTP_403') ||
    message.includes('BVC_HTTP_429') ||
    message.includes('Request Rejected')
  );
}

async function retryBvcFetch<T>(work: () => Promise<T>, attempts = 5): Promise<T> {
  let lastError: unknown;
  const boundedAttempts = Math.max(1, attempts);
  for (let attempt = 1; attempt <= boundedAttempts; attempt += 1) {
    try {
      return await work();
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (!isBvcPublicSourceUnavailable(message) && !message.includes('fetch failed')) break;
      if (attempt < boundedAttempts) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_500 * attempt));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function marketDateFromBvcTimestamp(timestamp: number | null, fallback: Date) {
  if (!timestamp) return isoDate(fallback);
  const millis = timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp;
  return isoDate(new Date(millis));
}

function parseIsoDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error(`Invalid ISO date: ${value}`);
  const [, year, month, day] = match;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
}

function normalizeTicker(value: string) {
  const ticker = value.trim().toUpperCase();
  if (!/^[A-Z0-9._-]{1,20}$/.test(ticker)) throw new Error(`Invalid ticker: ${value}`);
  return ticker;
}

function parseTickers(value: string) {
  const tickers = value.split(',').map(normalizeTicker).filter(Boolean);
  if (!tickers.length) throw new Error('--tickers requires at least one ticker');
  return [...new Set(tickers)];
}

function parseYears(value: string) {
  const years = Number(value);
  if (!Number.isInteger(years) || years < 1 || years > 3)
    throw new Error('--years must be 1, 2, or 3');
  return years;
}

function parseConcurrency(value: string) {
  const concurrency = Number(value);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 2)
    throw new Error('--concurrency must be 1 or 2');
  return concurrency;
}

function isLocalHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return ['localhost', '127.0.0.1'].includes(url.hostname);
  } catch {
    return false;
  }
}

function isLocalPostgresUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol.startsWith('postgres') && ['localhost', '127.0.0.1'].includes(url.hostname);
  } catch {
    return false;
  }
}

function hashKey(value: string) {
  return createHash('sha256').update(`saifinvest:bvc-bootstrap:v1:${value}`).digest('hex');
}

async function bvcPublicTestingFetch(
  input: string | URL | Request,
  init: RequestInit = {},
): Promise<Response> {
  const url = new URL(
    typeof input === 'string' || input instanceof URL ? input.toString() : input.url,
  );
  if (url.hostname !== 'www.casablanca-bourse.com')
    throw new Error(`Refusing non-BVC bootstrap fetch: ${url.hostname}`);
  if (url.protocol !== 'https:') throw new Error(`Refusing non-HTTPS bootstrap fetch: ${url.href}`);

  const headers = new Headers(init.headers);
  if (!headers.has('user-agent'))
    headers.set(
      'user-agent',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36',
    );
  if (!headers.has('accept-language')) headers.set('accept-language', 'en-US,en;q=0.9,fr;q=0.8');
  if (!headers.has('x-requested-with')) headers.set('x-requested-with', 'XMLHttpRequest');
  return new Promise((resolveResponse, rejectResponse) => {
    const request = httpsRequest(
      url,
      {
        method: init.method ?? 'GET',
        headers: Object.fromEntries(headers.entries()),
        rejectUnauthorized: false,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => {
          resolveResponse(
            new Response(Buffer.concat(chunks), {
              status: response.statusCode ?? 0,
              statusText: response.statusMessage,
              headers: response.headers as HeadersInit,
            }),
          );
        });
      },
    );
    request.on('error', rejectResponse);
    if (init.signal) {
      if (init.signal.aborted) request.destroy(new Error('BVC_FETCH_ABORTED'));
      init.signal.addEventListener('abort', () => request.destroy(new Error('BVC_FETCH_ABORTED')), {
        once: true,
      });
    }
    request.end();
  });
}

function helpText() {
  return [
    'Usage: pnpm data:bootstrap -- [options]',
    '',
    'Options:',
    '  --ticker IAM             Bootstrap one active BVC equity',
    '  --tickers IAM,ATW,BCP    Bootstrap selected active BVC equities',
    '  --years 1                Bootstrap 1, 2, or 3 years of history',
    '  --dry-run                Fetch and validate without writing',
  ].join('\n');
}

interface Queryable {
  query<T extends object = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<T>>;
}

async function main() {
  const env = { ...loadDotEnvLocal(), ...process.env } as Env;
  const { databaseUrl } = assertLocalBootstrapEnvironment(env);
  const options = parseBootstrapArgs(process.argv.slice(2));
  const store = new PgBvcBootstrapStore(databaseUrl, options.dryRun);
  try {
    const summary = await runBvcBootstrap(options, store);
    printSummary(summary);
    if (summary.failures.length) process.exitCode = 1;
  } finally {
    await store.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
