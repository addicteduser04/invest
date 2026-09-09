import { Pool, type PoolClient, type QueryResult } from 'pg';
import type {
  AmbiguousIssuer,
  DiscoveredDocument,
  DocumentUpsertCounts,
  IssuerRef,
  NewIssuerDraft,
  SecurityRef,
  SyncCounters,
  SyncFailure,
  SyncScope,
  SyncStatus,
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
  listExistingIssuers(): Promise<IssuerRef[]>;
  createIssuer(draft: NewIssuerDraft): Promise<string>;
  backfillIssuerAmmcId(
    issuerId: string,
    ammcIssuerId: string,
    ammcIssuerName: string,
  ): Promise<void>;
  createRun(input: { scope: SyncScope; createdBy: string }): Promise<string>;
  finalizeRun(
    runId: string,
    input: { status: SyncStatus; counters: SyncCounters; failures: SyncFailure[] },
  ): Promise<void>;
  upsertDocuments(documents: DiscoveredDocument[]): Promise<DocumentUpsertCounts>;
  upsertAmbiguousIssuers(ambiguous: AmbiguousIssuer[]): Promise<void>;
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
    const result = await this.pool.query<{ id: string; ticker: string; issuer_id: string }>(
      `select id, ticker, issuer_id from market.securities
       where listing_status in ('active','suspended') and not is_synthetic`,
    );
    return result.rows.map((row) => ({ id: row.id, ticker: row.ticker, issuerId: row.issuer_id }));
  }

  async listExistingIssuers(): Promise<IssuerRef[]> {
    const result = await this.pool.query<{
      id: string;
      name: string;
      normalized_name: string;
      ammc_issuer_id: string | null;
      has_listed_security: boolean;
    }>(
      `select i.id, i.name, i.normalized_name, i.ammc_issuer_id,
         exists(select 1 from market.securities s where s.issuer_id=i.id and not s.is_synthetic) as has_listed_security
       from market.issuers i
       where not i.is_synthetic`,
    );
    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      normalizedName: row.normalized_name,
      ammcIssuerId: row.ammc_issuer_id,
      hasListedSecurity: row.has_listed_security,
    }));
  }

  async createIssuer(draft: NewIssuerDraft): Promise<string> {
    return this.withTransaction(async (client) => {
      const slugResult = await client.query<{ slugify: string }>(
        `select private.slugify($1) as slugify`,
        [draft.name],
      );
      let slug = slugResult.rows[0]!.slugify;
      let suffix = 1;
      for (;;) {
        const existing = await client.query('select 1 from market.issuers where slug=$1', [slug]);
        if (existing.rowCount === 0) break;
        suffix += 1;
        slug = `${slugResult.rows[0]!.slugify}-${suffix}`;
      }
      const inserted = await client.query<{ id: string }>(
        `insert into market.issuers(
           name,normalized_name,slug,issuer_type,equity_listing_status,country_code,country_name,
           ammc_issuer_id,ammc_issuer_name
         ) values($1,$2,$3,$4,$5,$6,$7,$8,$9)
         returning id`,
        [
          draft.name,
          draft.normalizedName,
          slug,
          draft.issuerType,
          draft.equityListingStatus,
          draft.countryCode,
          draft.countryName,
          draft.ammcIssuerId,
          draft.ammcIssuerName,
        ],
      );
      return inserted.rows[0]!.id;
    });
  }

  async backfillIssuerAmmcId(issuerId: string, ammcIssuerId: string, ammcIssuerName: string) {
    await this.pool.query(
      `update market.issuers set ammc_issuer_id=$2,ammc_issuer_name=$3,updated_at=now() where id=$1`,
      [issuerId, ammcIssuerId, ammcIssuerName],
    );
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
    input: { status: SyncStatus; counters: SyncCounters; failures: SyncFailure[] },
  ) {
    const c = input.counters;
    await this.pool.query(
      `update market.document_sync_runs set
         status=$2,finished_at=now(),
         issuers_discovered=$3,issuers_existing=$4,issuers_created=$5,
         issuers_linked_to_security=$6,issuers_unlisted=$7,issuers_ambiguous=$8,
         issuers_with_reports=$9,issuers_without_reports=$10,
         documents_discovered=$11,documents_inserted=$12,documents_updated=$13,documents_unchanged=$14,
         failures=$15
       where id=$1`,
      [
        runId,
        input.status,
        c.issuersDiscovered,
        c.issuersExisting,
        c.issuersCreated,
        c.issuersLinkedToSecurity,
        c.issuersUnlisted,
        c.issuersAmbiguous,
        c.issuersWithReports,
        c.issuersWithoutReports,
        c.documentsDiscovered,
        c.documentsInserted,
        c.documentsUpdated,
        c.documentsUnchanged,
        JSON.stringify(input.failures),
      ],
    );
  }

  async upsertDocuments(documents: DiscoveredDocument[]): Promise<DocumentUpsertCounts> {
    if (!documents.length) return { inserted: 0, updated: 0, unchanged: 0 };
    return this.withTransaction((client) => upsertDocumentRows(client, documents));
  }

  async upsertAmbiguousIssuers(ambiguous: AmbiguousIssuer[]) {
    if (!ambiguous.length) return;
    await this.withTransaction(async (client) => {
      for (const issuer of ambiguous) {
        await client.query(
          `insert into market.ambiguous_document_issuers(
             source_provider_id,source_issuer_id,source_issuer_name,candidate_issuer_id
           ) values($1,$2,$3,$4)
           on conflict(source_provider_id,source_issuer_id) do update set
             source_issuer_name=excluded.source_issuer_name,
             candidate_issuer_id=excluded.candidate_issuer_id,
             last_seen_at=now()`,
          [
            AMMC_PROVIDER_ID,
            issuer.sourceIssuerId,
            issuer.sourceIssuerName,
            issuer.candidateIssuerId,
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
  const result = await client.query<{ kind: 'reclaimed' | 'inserted' | 'updated' }>(
    `with incoming as (
       select
         (r->>'issuerId')::uuid as issuer_id,
         r->>'documentType' as document_type,
         (r->>'fiscalYear')::integer as fiscal_year,
         r->>'title' as title,
         r->>'sourceRecordUrl' as source_record_url,
         r->>'sourceUrl' as source_url,
         nullif(r->>'publicationDate','')::date as publication_date,
         nullif(r->>'language','') as language,
         nullif(r->>'fileName','') as file_name,
         nullif(r->>'fileSizeBytes','')::bigint as file_size_bytes,
         r->>'status' as status
       from jsonb_array_elements($1::jsonb) as r
     ),
     -- Rows persisted before the filing-identity fix (see
     -- 202609070006_document_filing_identity.sql) have source_record_url still null; a legacy
     -- row's (issuer_id,source_url,fiscal_year) was already unique before that migration (it
     -- was derived from source_url alone being unique), so it deterministically identifies at
     -- most one incoming row here -- reclaim it in place instead of inserting a duplicate.
     reclaimed as (
       update market.company_documents as d set
         source_record_url=i.source_record_url,
         document_type=i.document_type,
         title=i.title,
         publication_date=i.publication_date,
         language=i.language,
         file_name=i.file_name,
         file_size_bytes=i.file_size_bytes,
         status=i.status,
         updated_at=now()
       from incoming i
       where d.source_provider_id=$2
         and d.source_record_url is null
         and d.source_url=i.source_url
         and d.issuer_id=i.issuer_id
         and d.fiscal_year=i.fiscal_year
       returning i.source_record_url,i.source_url
     ),
     applied as (
       insert into market.company_documents as d(
         issuer_id,document_type,fiscal_year,title,source_provider_id,source_record_url,source_url,
         publication_date,language,file_name,file_size_bytes,status
       )
       select
         i.issuer_id,i.document_type,i.fiscal_year,i.title,$2,i.source_record_url,i.source_url,
         i.publication_date,i.language,i.file_name,i.file_size_bytes,i.status
       from incoming i
       where not exists(
         select 1 from reclaimed r
         where r.source_record_url=i.source_record_url and r.source_url=i.source_url
       )
       on conflict(source_provider_id,source_record_url,source_url) do update set
         issuer_id=excluded.issuer_id,
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
         d.issuer_id is distinct from excluded.issuer_id or
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
     select 'reclaimed' as kind from reclaimed
     union all
     select case when inserted then 'inserted' else 'updated' end as kind from applied`,
    [JSON.stringify(documents), AMMC_PROVIDER_ID],
  );
  const inserted = result.rows.filter((row) => row.kind === 'inserted').length;
  const updated = result.rows.filter((row) => row.kind !== 'inserted').length;
  const unchanged = documents.length - result.rows.length;
  return { inserted, updated, unchanged };
}
