import { createHash, randomUUID } from 'node:crypto';
import { Pool, type PoolClient, type QueryResult } from 'pg';
import type {
  BvcIndexCandidate,
  BvcIndexObservationCandidate,
  SecurityMasterCandidate,
} from '@bvc/market-data';
import type {
  Counts,
  InstrumentFailure,
  NormalizedPriceRow,
  ProviderId,
  RunMetrics,
  RunStatus,
  TriggerSource,
} from './types';

// Distinct from scripts/data-bootstrap.ts's BOOTSTRAP_ACTOR_ID so local bootstrap runs and
// automated daily-ingestion runs remain separately auditable in public.profiles.
const SYSTEM_ACTOR_ID = '00000000-0000-4000-8000-000000000002';

interface Queryable {
  query<T extends object = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<T>>;
}

export interface StoredRun {
  id: string;
  providerId: ProviderId;
  marketDate: string;
  status: RunStatus;
  triggerSource: TriggerSource;
  startedAt: string;
  finishedAt: string | null;
  metrics: RunMetrics;
  instrumentFailures: InstrumentFailure[];
  parentRunId: string | null;
}

export interface CreateRunInput {
  providerId: ProviderId;
  marketDate: string;
  triggerSource: TriggerSource;
  proposedBy: string;
  parentRunId?: string;
}

export interface FinalizeRunInput {
  status: Exclude<RunStatus, 'running'>;
  metrics: RunMetrics;
  instrumentFailures: InstrumentFailure[];
}

export interface IngestionStore {
  ensureSystemActor(): Promise<string>;
  createRun(input: CreateRunInput): Promise<string>;
  finalizeRun(runId: string, input: FinalizeRunInput): Promise<void>;
  getRun(runId: string): Promise<StoredRun | null>;
  findLatestIncompleteRun(marketDate?: string): Promise<StoredRun | null>;
  getActiveSecurityTickers(): Promise<string[]>;
  upsertSecurityMaster(rows: SecurityMasterCandidate[], providerId: ProviderId): Promise<Counts>;
  upsertIndexMaster(rows: BvcIndexCandidate[], providerId: ProviderId): Promise<Counts>;
  upsertIndexObservations(
    rows: BvcIndexObservationCandidate[],
    providerId: ProviderId,
  ): Promise<Counts>;
  upsertDailyPrices(
    rows: NormalizedPriceRow[],
    runId: string,
  ): Promise<Counts & { skipped: number }>;
  close(): Promise<void>;
}

export class PgIngestionStore implements IngestionStore {
  private readonly pool: Pool;

  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl, max: 4 });
  }

  async close() {
    await this.pool.end();
  }

  async ensureSystemActor() {
    await this.withTransaction(async (client) => {
      await client.query(
        `insert into auth.users(id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
         values($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'market-ingestion@saifinvest.internal', '', '{}', '{"locale":"en","display_name":"Market Data Ingestion"}', now(), now())
         on conflict(id) do nothing`,
        [SYSTEM_ACTOR_ID],
      );
      await client.query(
        `insert into public.profiles(id, display_name, locale)
         values($1, 'Market Data Ingestion', 'en')
         on conflict(id) do update set display_name=excluded.display_name, updated_at=now()`,
        [SYSTEM_ACTOR_ID],
      );
      await client.query(
        `insert into public.user_roles(user_id, role) values($1, 'data_admin') on conflict do nothing`,
        [SYSTEM_ACTOR_ID],
      );
    });
    return SYSTEM_ACTOR_ID;
  }

  async createRun(input: CreateRunInput) {
    const runUuid = randomUUID();
    const sourceHash = hashKey(
      `${input.providerId}:${input.marketDate}:${input.triggerSource}:${runUuid}`,
    );
    const objectPath = `market-ingestion://${input.providerId}/${input.marketDate}/${runUuid}`;
    const result = await this.pool.query<{ id: string }>(
      `insert into market.ingestion_runs(
         provider_id, market_date, status, source_hash, original_object_path, mapping,
         validation_report, proposed_by, trigger_source, started_at, metrics, instrument_failures, parent_run_id
       ) values($1,$2,'running',$3,$4,'{}'::jsonb,'{}'::jsonb,$5,$6,now(),'{}'::jsonb,'[]'::jsonb,$7)
       returning id`,
      [
        input.providerId,
        input.marketDate,
        sourceHash,
        objectPath,
        input.proposedBy,
        input.triggerSource,
        input.parentRunId ?? null,
      ],
    );
    return result.rows[0]!.id;
  }

  async finalizeRun(runId: string, input: FinalizeRunInput) {
    await this.pool.query(
      `update market.ingestion_runs
       set status=$2, finished_at=now(), metrics=$3::jsonb, instrument_failures=$4::jsonb
       where id=$1`,
      [
        runId,
        input.status,
        JSON.stringify(input.metrics),
        JSON.stringify(input.instrumentFailures),
      ],
    );
  }

  async getRun(runId: string) {
    const result = await this.pool.query(
      `select id, provider_id, market_date::text, status, trigger_source, started_at::text,
         finished_at::text, metrics, instrument_failures, parent_run_id
       from market.ingestion_runs where id=$1`,
      [runId],
    );
    return result.rows[0] ? toStoredRun(result.rows[0]) : null;
  }

  async findLatestIncompleteRun(marketDate?: string) {
    const result = await this.pool.query(
      `select id, provider_id, market_date::text, status, trigger_source, started_at::text,
         finished_at::text, metrics, instrument_failures, parent_run_id
       from market.ingestion_runs
       where status in ('partial','failed')
         and ($1::date is null or market_date=$1::date)
       order by started_at desc
       limit 1`,
      [marketDate ?? null],
    );
    return result.rows[0] ? toStoredRun(result.rows[0]) : null;
  }

  async getActiveSecurityTickers() {
    const result = await this.pool.query<{ ticker: string }>(
      `select ticker from market.securities
       where listing_status='active' and is_synthetic=false
       order by ticker`,
    );
    return result.rows.map((row) => row.ticker);
  }

  async upsertSecurityMaster(rows: SecurityMasterCandidate[], providerId: ProviderId) {
    return this.withTransaction((client) => upsertSecurityMasterRows(client, rows, providerId));
  }

  async upsertIndexMaster(rows: BvcIndexCandidate[], providerId: ProviderId) {
    return this.withTransaction((client) => upsertIndexMasterRows(client, rows, providerId));
  }

  async upsertIndexObservations(rows: BvcIndexObservationCandidate[], providerId: ProviderId) {
    return this.withTransaction((client) => upsertIndexObservationRows(client, rows, providerId));
  }

  async upsertDailyPrices(rows: NormalizedPriceRow[], runId: string) {
    return this.withTransaction((client) => upsertPriceRows(client, rows, runId));
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

function toStoredRun(row: Record<string, unknown>): StoredRun {
  return {
    id: row['id'] as string,
    providerId: row['provider_id'] as ProviderId,
    marketDate: row['market_date'] as string,
    status: row['status'] as RunStatus,
    triggerSource: row['trigger_source'] as TriggerSource,
    startedAt: row['started_at'] as string,
    finishedAt: (row['finished_at'] as string | null) ?? null,
    metrics: row['metrics'] as RunMetrics,
    instrumentFailures: row['instrument_failures'] as InstrumentFailure[],
    parentRunId: (row['parent_run_id'] as string | null) ?? null,
  };
}

async function upsertSecurityMasterRows(
  client: Queryable,
  rows: SecurityMasterCandidate[],
  providerId: ProviderId,
) {
  const counts: Counts = { inserted: 0, updated: 0 };
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
             share_count=coalesce($10::numeric, share_count), source_provider_id=$11,
             source_identifier=coalesce($12, source_identifier), source_fetched_at=now(), updated_at=now()
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
          providerId,
          row.sourceId ?? null,
        ],
      );
      counts.updated += 1;
    } else {
      await client.query(
        `insert into market.securities(
           name, ticker, sector, listing_status, listed_on, is_synthetic, isin, issuer_name,
           instrument_type, market_segment, share_count, source_provider_id, source_identifier, source_fetched_at
         ) values($1,$2,$3,$4,$5,false,$6,$7,$8,$9,$10,$11,$12,now())`,
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
          providerId,
          row.sourceId ?? null,
        ],
      );
      counts.inserted += 1;
    }
  }
  return counts;
}

async function upsertIndexMasterRows(
  client: Queryable,
  rows: BvcIndexCandidate[],
  providerId: ProviderId,
) {
  const counts: Counts = { inserted: 0, updated: 0 };
  for (const row of rows) {
    const result = await client.query<{ inserted: boolean }>(
      `insert into market.indices(source_provider_id, source_code, name, family, currency, status)
       values($4,$1,$2,$3,null,'active')
       on conflict(source_provider_id, source_code) do update
         set name=excluded.name, family=excluded.family, updated_at=now()
       returning xmax = 0 as inserted`,
      [
        row.code,
        row.name.en ?? row.name.fr ?? row.code,
        row.family.en ?? row.family.fr ?? null,
        providerId,
      ],
    );
    if (result.rows[0]?.inserted) counts.inserted += 1;
    else counts.updated += 1;
  }
  return counts;
}

async function upsertIndexObservationRows(
  client: Queryable,
  rows: BvcIndexObservationCandidate[],
  providerId: ProviderId,
) {
  const counts: Counts = { inserted: 0, updated: 0 };
  for (const row of rows) {
    const indexResult = await client.query<{ id: string }>(
      `insert into market.indices(source_provider_id, source_code, name, status)
       values($1,$2,$2,'active')
       on conflict(source_provider_id, source_code) do update set updated_at=now()
       returning id`,
      [providerId, row.code],
    );
    const indexId = indexResult.rows[0]!.id;
    const updated = await client.query(
      `update market.index_observations
       set close_value=$3, high_value=$4, low_value=$5, change_percent=$6, change_ytd=$7,
           volume=$8, transaction_count=$9, source_timestamp=$10, published_at=now()
       where index_id=$1 and market_date=$2 and source_provider_id=$11
         and status in ('published','provisional')`,
      [
        indexId,
        row.marketDate,
        row.close,
        row.high,
        row.low,
        row.changePercent,
        row.changeYtd,
        row.volume,
        row.transactionCount,
        row.sourceTimestamp,
        providerId,
      ],
    );
    if (updated.rowCount) {
      counts.updated += updated.rowCount;
    } else {
      await client.query(
        `insert into market.index_observations(
           index_id, market_date, close_value, high_value, low_value, change_percent, change_ytd,
           volume, transaction_count, source_provider_id, source_timestamp, status, created_by, published_at
         ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'published',$12,now())`,
        [
          indexId,
          row.marketDate,
          row.close,
          row.high,
          row.low,
          row.changePercent,
          row.changeYtd,
          row.volume,
          row.transactionCount,
          providerId,
          row.sourceTimestamp,
          SYSTEM_ACTOR_ID,
        ],
      );
      counts.inserted += 1;
    }
  }
  return counts;
}

async function upsertPriceRows(client: Queryable, rows: NormalizedPriceRow[], runId: string) {
  const counts = { inserted: 0, updated: 0, skipped: 0 };
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
        runId,
      ],
    );
    if (updated.rowCount) {
      counts.updated += updated.rowCount;
    } else {
      await client.query(
        `insert into market.prices(
           security_id, market_date, open_price, high_price, low_price, close_price, volume,
           status, ingestion_run_id, published_at
         ) values($1,$2,$3,$4,$5,$6,$7,'published',$8,now())`,
        [
          securityId,
          row.marketDate,
          row.open ?? null,
          row.high ?? null,
          row.low ?? null,
          row.close,
          row.volume ?? null,
          runId,
        ],
      );
      counts.inserted += 1;
    }
  }
  return counts;
}

function hashKey(value: string) {
  return createHash('sha256').update(`saifinvest:market-ingestion:v1:${value}`).digest('hex');
}
