import { randomUUID } from 'node:crypto';
import { Client, type QueryResultRow } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const enabled = process.env['LIVE_DATABASE_TESTS'] === '1';
const databaseUrl = process.env['TEST_DATABASE_URL'];
const live = enabled ? describe : describe.skip;

if (enabled && !databaseUrl)
  throw new Error('TEST_DATABASE_URL is required for live database tests');
if (enabled && !/^postgresql:\/\/[^@]+@(?:127\.0\.0\.1|localhost):\d+\//.test(databaseUrl!)) {
  throw new Error('Live database tests are restricted to a disposable local PostgreSQL instance');
}

const ids = { investor: randomUUID(), admin: randomUUID(), otherAdmin: randomUUID() };

async function connect() {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  return client;
}

async function asUser<T extends QueryResultRow = QueryResultRow>(
  userId: string | null,
  sql: string,
  parameters: unknown[] = [],
) {
  const client = await connect();
  try {
    await client.query('begin');
    await client.query(`set local role ${userId ? 'authenticated' : 'anon'}`);
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId ?? '']);
    const result = await client.query<T>(sql, parameters);
    await client.query('commit');
    return result;
  } finally {
    await client.end();
  }
}

live.sequential('live company_documents schema, matching aliases, and RLS', () => {
  let adminClient: Client;
  let securityId: string;
  let otherSecurityId: string;

  beforeAll(async () => {
    adminClient = await connect();
    await adminClient.query(
      `insert into auth.users(id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
       select id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', id::text || '@example.test', '', '{}', '{}', now(), now()
       from (values ($1::uuid),($2::uuid),($3::uuid)) u(id)`,
      [ids.investor, ids.admin, ids.otherAdmin],
    );
    await adminClient.query(
      "insert into public.user_roles(user_id,role) values($1,'data_admin'),($2,'data_admin')",
      [ids.admin, ids.otherAdmin],
    );
    const securities = await adminClient.query<{ id: string; ticker: string }>(
      "select id, ticker from market.securities where ticker in ('SYN-IAM','SYN-ATW')",
    );
    securityId = securities.rows.find((r) => r.ticker === 'SYN-IAM')!.id;
    otherSecurityId = securities.rows.find((r) => r.ticker === 'SYN-ATW')!.id;
  });

  afterAll(async () => {
    await adminClient.query('delete from market.company_documents where security_id = any($1)', [
      [securityId, otherSecurityId],
    ]);
    await adminClient.query(
      'delete from market.company_document_aliases where security_id = any($1)',
      [[securityId, otherSecurityId]],
    );
    await adminClient.query(
      "delete from market.unmatched_document_issuers where source_issuer_id like 'test-%'",
    );
    await adminClient.query('delete from public.user_roles where user_id = any($1)', [
      [ids.investor, ids.admin, ids.otherAdmin],
    ]);
    await adminClient.query('delete from public.profiles where id = any($1)', [
      [ids.investor, ids.admin, ids.otherAdmin],
    ]);
    await adminClient.query('delete from auth.users where id = any($1)', [
      [ids.investor, ids.admin, ids.otherAdmin],
    ]);
    await adminClient.end();
  });

  it('rejects an investor calling upsert_company_document_manual', async () => {
    await expect(
      asUser(
        ids.investor,
        'select public.upsert_company_document_manual($1,$2,$3,$4,$5,$6,$7,$8)',
        [
          null,
          securityId,
          'annual_report',
          2024,
          'Investor attempt',
          'https://example.test/report.pdf',
          null,
          null,
        ],
      ),
    ).rejects.toThrow(/FORBIDDEN/);
  });

  it('rejects a signed-out request -- anon has no execute grant at all on the admin RPCs', async () => {
    await expect(
      asUser(null, 'select public.upsert_company_document_manual($1,$2,$3,$4,$5,$6,$7,$8)', [
        null,
        securityId,
        'annual_report',
        2024,
        'Anonymous attempt',
        'https://example.test/report.pdf',
        null,
        null,
      ]),
    ).rejects.toThrow(/permission denied/i);
  });

  it('lets a data_admin add a manual report, and public/investor can read it back through the safe view', async () => {
    const insert = await asUser<{ upsert_company_document_manual: string }>(
      ids.admin,
      'select public.upsert_company_document_manual($1,$2,$3,$4,$5,$6,$7,$8)',
      [
        null,
        securityId,
        'annual_report',
        2024,
        'Manual annual report 2024',
        'https://example.test/manual-2024.pdf',
        '2025-03-01',
        'fr',
      ],
    );
    const documentId = insert.rows[0]!.upsert_company_document_manual;
    expect(documentId).toBeTruthy();

    const asAnon = await asUser(
      null,
      'select * from public.security_company_documents where id=$1',
      [documentId],
    );
    expect(asAnon.rows).toHaveLength(1);
    expect(asAnon.rows[0]!['source_provider_id']).toBe('admin_manual');
    expect(asAnon.rows[0]!['title']).toBe('Manual annual report 2024');

    const asInvestor = await asUser(
      ids.investor,
      'select * from public.security_company_documents where id=$1',
      [documentId],
    );
    expect(asInvestor.rows).toHaveLength(1);
  });

  it('the public view never exposes an unpublished document', async () => {
    await adminClient.query(
      `insert into market.company_documents(security_id,document_type,fiscal_year,title,source_provider_id,source_url,status)
       values($1,'annual_report',2020,'Unavailable test doc','admin_manual','https://example.test/unavailable.pdf','unavailable')`,
      [securityId],
    );
    const result = await asUser(
      null,
      "select * from public.security_company_documents where source_url='https://example.test/unavailable.pdf'",
    );
    expect(result.rows).toHaveLength(0);
  });

  it('enforces (source_provider_id, source_url) uniqueness -- the idempotency key', async () => {
    await adminClient.query(
      `insert into market.company_documents(security_id,document_type,fiscal_year,title,source_provider_id,source_url)
       values($1,'annual_report',2022,'First','admin_manual','https://example.test/dup.pdf')`,
      [securityId],
    );
    await expect(
      adminClient.query(
        `insert into market.company_documents(security_id,document_type,fiscal_year,title,source_provider_id,source_url)
         values($1,'annual_report',2022,'Second, same URL','admin_manual','https://example.test/dup.pdf')`,
        [otherSecurityId],
      ),
    ).rejects.toThrow(/duplicate key|unique/i);
  });

  it('requires a real security_id -- the foreign key rejects an unknown one', async () => {
    await expect(
      adminClient.query(
        `insert into market.company_documents(security_id,document_type,fiscal_year,title,source_provider_id,source_url)
         values($1,'annual_report',2022,'Orphan','admin_manual','https://example.test/orphan.pdf')`,
        [randomUUID()],
      ),
    ).rejects.toThrow(/foreign key/i);
  });

  it('lets a data_admin maintain an issuer alias, readable only by data_admin', async () => {
    const upsert = await asUser<{ upsert_company_document_alias: string }>(
      ids.admin,
      'select public.upsert_company_document_alias($1,$2,$3,$4)',
      [securityId, 'ammc_public_documents', 'test-2798', 'MAROC TELECOM'],
    );
    expect(upsert.rows[0]!.upsert_company_document_alias).toBeTruthy();

    const asAdmin = await asUser(ids.admin, 'select * from public.list_company_document_aliases()');
    expect(asAdmin.rows.some((r) => r['source_issuer_id'] === 'test-2798')).toBe(true);

    // A read-model RPC gated by a WHERE clause (not an exception) returns an empty result for
    // a non-admin caller rather than throwing -- still zero data exposed, just a different
    // shape than the exception-raising write RPCs.
    const asInvestor = await asUser(
      ids.investor,
      'select * from public.list_company_document_aliases()',
    );
    expect(asInvestor.rows).toHaveLength(0);
  });

  it('re-upserting the same alias for a security updates it in place rather than duplicating', async () => {
    await asUser(ids.admin, 'select public.upsert_company_document_alias($1,$2,$3,$4)', [
      securityId,
      'ammc_public_documents',
      'test-2798',
      'MAROC TELECOM',
    ]);
    await asUser(ids.admin, 'select public.upsert_company_document_alias($1,$2,$3,$4)', [
      securityId,
      'ammc_public_documents',
      'test-2798-corrected',
      'MAROC TELECOM SA',
    ]);
    const rows = await adminClient.query(
      'select source_issuer_id from market.company_document_aliases where security_id=$1',
      [securityId],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]!['source_issuer_id']).toBe('test-2798-corrected');
  });

  it('surfaces an unmatched issuer for admin review and lets a data_admin resolve it', async () => {
    await adminClient.query(
      `insert into market.unmatched_document_issuers(source_provider_id,source_issuer_id,source_issuer_name)
       values('ammc_public_documents','test-9999','SOME UNRELATED ISSUER')`,
    );
    const openList = await asUser(
      ids.admin,
      "select * from public.list_unmatched_document_issuers('open')",
    );
    const row = openList.rows.find((r) => r['source_issuer_id'] === 'test-9999');
    expect(row).toBeTruthy();

    await asUser(ids.admin, 'select public.resolve_unmatched_document_issuer($1,$2)', [
      row!['id'],
      'ignored',
    ]);
    const afterResolve = await asUser(
      ids.admin,
      "select * from public.list_unmatched_document_issuers('open')",
    );
    expect(afterResolve.rows.some((r) => r['source_issuer_id'] === 'test-9999')).toBe(false);
  });

  it('coverage stats are only readable by data_admin, not by an investor', async () => {
    const asAdmin = await asUser(ids.admin, 'select public.company_documents_coverage_stats()');
    expect(asAdmin.rows).toHaveLength(1);
    await expect(
      asUser(ids.investor, 'select public.company_documents_coverage_stats()'),
    ).rejects.toThrow(/FORBIDDEN/);
  });
});
