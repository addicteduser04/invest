import { createHash, randomUUID } from 'node:crypto';
import { Pool, type PoolClient, type QueryResult } from 'pg';
import type {
  BvcIndexCandidate,
  BvcIndexObservationCandidate,
  SecurityMasterCandidate,
} from '@bvc/market-data';
import {
  emptyMetrics,
  type Counts,
  type InstrumentFailure,
  type NormalizedPriceRow,
  type ProviderId,
  type RunMetrics,
  type RunStatus,
  type TriggerSource,
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
  /** Moves a run out of 'running'. Returns false if it was no longer running (e.g. recovered). */
  finalizeRun(runId: string, input: FinalizeRunInput): Promise<boolean>;
  /** Marks every run stuck in 'running' longer than the threshold as failed; returns their ids. */
  recoverStaleRuns(staleAfterMinutes: number): Promise<string[]>;
  /** Best-effort failure of one still-running run (interrupt/timeout); false if not running. */
  abandonRun(runId: string, errorCode: string, message: string): Promise<boolean>;
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
    // Without a listener, an idle pooled connection dropped by the server (restart, failover,
    // network blip) is an unhandled 'error' event that kills the whole process mid-run. The pool
    // already discards that client and reconnects on next use; in-flight queries still reject
    // to their callers, so the pipeline records or finalizes the failure normally.
    this.pool.on('error', (error) => {
      console.warn(`[market-ingestion] idle database connection lost: ${error.message}`);
    });
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
    // Guarded on status so a terminal state is never overwritten (e.g. by a run that outlived its
    // executor's deadline and was already recovered as failed).
    const result = await this.pool.query(
      `update market.ingestion_runs
       set status=$2, finished_at=now(), metrics=$3::jsonb, instrument_failures=$4::jsonb
       where id=$1 and status='running'`,
      [
        runId,
        input.status,
        JSON.stringify(input.metrics),
        JSON.stringify(input.instrumentFailures),
      ],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async recoverStaleRuns(staleAfterMinutes: number) {
    return this.failRunningRuns(
      `status='running' and started_at < now() - make_interval(mins => $1::int)`,
      staleAfterMinutes,
      'STALE_RUN_RECOVERED',
      `Run did not finalize within ${staleAfterMinutes} minutes; its executor was interrupted or terminated.`,
    );
  }

  async abandonRun(runId: string, errorCode: string, message: string) {
    const ids = await this.failRunningRuns(
      `id=$1::uuid and status='running'`,
      runId,
      errorCode,
      message,
    );
    return ids.length > 0;
  }

  /**
   * Marks the matching 'running' runs failed in one statement, preserving everything already
   * recorded (existing metrics win over zero defaults; instrument_failures is untouched), and
   * writes one append-only audit event per run with its prior state.
   */
  private async failRunningRuns(
    filter: string,
    filterValue: unknown,
    errorCode: string,
    message: string,
  ) {
    const result = await this.pool.query<{ id: string }>(
      `with target as (
         select id, status, market_date, provider_id, started_at, finished_at, metrics
         from market.ingestion_runs
         where ${filter}
         for update skip locked
       ), updated as (
         update market.ingestion_runs r
         set status='failed', finished_at=now(),
             metrics = $4::jsonb || r.metrics || jsonb_build_object(
               'errorSummary', coalesce(r.metrics->'errorSummary', '{}'::jsonb)
                 || jsonb_build_object($2::text, coalesce((r.metrics->'errorSummary'->>$2)::int, 0) + 1),
               'failureReason', $3::text)
         from target t
         where r.id = t.id
         returning r.id
       ), audited as (
         insert into audit.events(actor_id, actor_type, action, entity_type, entity_id, reason, before_state, after_state)
         select null, 'system', 'market_ingestion_run.marked_failed', 'ingestion_run', t.id, $3::text,
           jsonb_build_object('status', t.status, 'marketDate', t.market_date, 'providerId', t.provider_id,
                              'startedAt', t.started_at, 'finishedAt', t.finished_at, 'metrics', t.metrics),
           jsonb_build_object('status', 'failed', 'errorCode', $2::text)
         from target t join updated u on u.id = t.id
       )
       select id from updated`,
      [filterValue, errorCode, message, JSON.stringify(emptyMetrics())],
    );
    return result.rows.map((row) => row.id);
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
           instrument_type, market_segment, share_count, source_provider_id, source_identifier, source_fetched_at,
           issuer_id
         ) values($1,$2,$3,$4,$5,false,$6,$7,$8,$9,$10,$11,$12,now(),
           private.resolve_listed_issuer($7,$3,$2))`,
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
