import { Pool, type PoolClient, type QueryResult } from 'pg';
import type {
  AliasRow,
  DiscoveredDocument,
  DocumentUpsertCounts,
  SecurityRef,
  SyncFailure,
  SyncScope,
  SyncStatus,
  UnmatchedIssuer,
} from './types';

// Distinct from @bvc/market-ingestion's and scripts/data-bootstrap.ts's system actor ids, so
// each automated pipeline stays separately auditable in public.profiles.
const SYSTEM_ACTOR_ID = '00000000-0000-4000-8000-000000000003';
export const AMMC_PROVIDER_ID = 'ammc_public_documents';

interface Queryable {
  query<T extends object = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<T>>;
}

export interface ReportsStore {
  ensureSystemActor(): Promise<string>;
  listActiveSecurities(): Promise<SecurityRef[]>;
  listAliases(): Promise<AliasRow[]>;
  createRun(input: { scope: SyncScope; createdBy: string }): Promise<string>;
  finalizeRun(
    runId: string,
    input: {
      status: SyncStatus;
      discovered: number;
      counts: DocumentUpsertCounts;
      unmatchedIssuers: UnmatchedIssuer[];
      failures: SyncFailure[];
    },
  ): Promise<void>;
  upsertDocuments(documents: DiscoveredDocument[]): Promise<DocumentUpsertCounts>;
  upsertUnmatchedIssuers(unmatched: UnmatchedIssuer[]): Promise<void>;
  close(): Promise<void>;
}

export class PgReportsStore implements ReportsStore {
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
         values($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'annual-reports-sync@saifinvest.internal', '', '{}', '{"locale":"en","display_name":"Annual Reports Sync"}', now(), now())
         on conflict(id) do nothing`,
        [SYSTEM_ACTOR_ID],
      );
      await client.query(
        `insert into public.profiles(id, display_name, locale)
         values($1, 'Annual Reports Sync', 'en')
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

  async listActiveSecurities(): Promise<SecurityRef[]> {
    const result = await this.pool.query<{
      id: string;
      ticker: string;
      issuer_name: string | null;
    }>(
      `select id, ticker, issuer_name from market.securities
       where listing_status in ('active','suspended')`,
    );
    return result.rows.map((row) => ({
      id: row.id,
      ticker: row.ticker,
      issuerName: row.issuer_name,
    }));
  }

  async listAliases(): Promise<AliasRow[]> {
    const result = await this.pool.query<{
      security_id: string;
      source_issuer_id: string;
      source_issuer_name: string;
    }>(
      `select security_id, source_issuer_id, source_issuer_name
       from market.company_document_aliases
       where source_provider_id=$1`,
      [AMMC_PROVIDER_ID],
    );
    return result.rows.map((row) => ({
      securityId: row.security_id,
      sourceIssuerId: row.source_issuer_id,
      sourceIssuerName: row.source_issuer_name,
    }));
  }

  async createRun(input: { scope: SyncScope; createdBy: string }) {
    const result = await this.pool.query<{ id: string }>(
      `insert into market.document_sync_runs(source_provider_id,status,dry_run,scope,created_by)
       values($1,'running',$2,$3,$4) returning id`,
      [AMMC_PROVIDER_ID, input.scope.dryRun, JSON.stringify(input.scope), input.createdBy],
    );
    return result.rows[0]!.id;
  }

  async finalizeRun(
    runId: string,
    input: {
      status: SyncStatus;
      discovered: number;
      counts: DocumentUpsertCounts;
      unmatchedIssuers: UnmatchedIssuer[];
      failures: SyncFailure[];
    },
  ) {
    await this.pool.query(
      `update market.document_sync_runs set
         status=$2,finished_at=now(),documents_discovered=$3,
         documents_matched=$4,documents_inserted=$5,documents_updated=$6,documents_unchanged=$7,
         unmatched_issuers=$8,failures=$9
       where id=$1`,
      [
        runId,
        input.status,
        input.discovered,
        input.counts.inserted + input.counts.updated + input.counts.unchanged,
        input.counts.inserted,
        input.counts.updated,
        input.counts.unchanged,
        JSON.stringify(input.unmatchedIssuers),
        JSON.stringify(input.failures),
      ],
    );
  }

  async upsertDocuments(documents: DiscoveredDocument[]): Promise<DocumentUpsertCounts> {
    if (!documents.length) return { inserted: 0, updated: 0, unchanged: 0 };
    return this.withTransaction((client) => upsertDocumentRows(client, documents));
  }

  async upsertUnmatchedIssuers(unmatched: UnmatchedIssuer[]) {
    if (!unmatched.length) return;
    await this.withTransaction(async (client) => {
      for (const issuer of unmatched) {
        await client.query(
          `insert into market.unmatched_document_issuers(
             source_provider_id,source_issuer_id,source_issuer_name,candidate_security_id
           ) values($1,$2,$3,$4)
           on conflict(source_provider_id,source_issuer_id) do update set
             source_issuer_name=excluded.source_issuer_name,
             candidate_security_id=excluded.candidate_security_id,
             last_seen_at=now()`,
          [
            AMMC_PROVIDER_ID,
            issuer.sourceIssuerId,
            issuer.sourceIssuerName,
            issuer.candidateSecurityId,
          ],
        );
      }
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

async function upsertDocumentRows(
  client: Queryable,
  documents: DiscoveredDocument[],
): Promise<DocumentUpsertCounts> {
  const result = await client.query<{ inserted: boolean }>(
    `with incoming as (
       select
         (r->>'securityId')::uuid as security_id,
         r->>'documentType' as document_type,
         (r->>'fiscalYear')::integer as fiscal_year,
         r->>'title' as title,
         r->>'sourceUrl' as source_url,
         nullif(r->>'publicationDate','')::date as publication_date,
         nullif(r->>'language','') as language,
         nullif(r->>'fileName','') as file_name,
         nullif(r->>'fileSizeBytes','')::bigint as file_size_bytes,
         r->>'status' as status
       from jsonb_array_elements($1::jsonb) as r
     ),
     applied as (
       insert into market.company_documents as d(
         security_id,document_type,fiscal_year,title,source_provider_id,source_url,
         publication_date,language,file_name,file_size_bytes,status
       )
       select
         security_id,document_type,fiscal_year,title,$2,source_url,
         publication_date,language,file_name,file_size_bytes,status
       from incoming
       on conflict(source_provider_id,source_url) do update set
         security_id=excluded.security_id,
         document_type=excluded.document_type,
         fiscal_year=excluded.fiscal_year,
         title=excluded.title,
         publication_date=excluded.publication_date,
         language=excluded.language,
         file_name=excluded.file_name,
         file_size_bytes=excluded.file_size_bytes,
         status=excluded.status,
         updated_at=now()
       where
         d.security_id is distinct from excluded.security_id or
         d.document_type is distinct from excluded.document_type or
         d.fiscal_year is distinct from excluded.fiscal_year or
         d.title is distinct from excluded.title or
         d.publication_date is distinct from excluded.publication_date or
         d.language is distinct from excluded.language or
         d.file_name is distinct from excluded.file_name or
         d.file_size_bytes is distinct from excluded.file_size_bytes or
         d.status is distinct from excluded.status
       returning(xmax=0) as inserted
     )
     select inserted from applied`,
    [JSON.stringify(documents), AMMC_PROVIDER_ID],
  );
  const inserted = result.rows.filter((row) => row.inserted).length;
  const updated = result.rows.length - inserted;
  const unchanged = documents.length - result.rows.length;
  return { inserted, updated, unchanged };
}
