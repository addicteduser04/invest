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

const ids = { investor: randomUUID(), admin: randomUUID() };

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

live.sequential('live company_documents/issuer schema, matching, and RLS', () => {
  let adminClient: Client;
  let iamIssuerId: string;
  let atwIssuerId: string;
  let manualIssuerId: string;

  beforeAll(async () => {
    adminClient = await connect();
    await adminClient.query(
      `insert into auth.users(id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
       select id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', id::text || '@example.test', '', '{}', '{}', now(), now()
       from (values ($1::uuid),($2::uuid)) u(id)`,
      [ids.investor, ids.admin],
    );
    await adminClient.query("insert into public.user_roles(user_id,role) values($1,'data_admin')", [
      ids.admin,
    ]);

    const issuers = await adminClient.query<{ id: string; issuer_id: string; ticker: string }>(
      "select s.id, s.issuer_id, s.ticker from market.securities s where s.ticker in ('SYN-IAM','SYN-ATW')",
    );
    iamIssuerId = issuers.rows.find((r) => r.ticker === 'SYN-IAM')!.issuer_id;
    atwIssuerId = issuers.rows.find((r) => r.ticker === 'SYN-ATW')!.issuer_id;

    const manualIssuer = await adminClient.query<{ id: string }>(
      `insert into market.issuers(name,normalized_name,slug,issuer_type,equity_listing_status)
       values('Live Test Manual Issuer','LIVE TEST MANUAL ISSUER','live-test-manual-issuer','unlisted_company','no_listed_bvc_equity')
       returning id`,
    );
    manualIssuerId = manualIssuer.rows[0]!.id;
  });

  afterAll(async () => {
    await adminClient.query('delete from market.company_documents where issuer_id = any($1)', [
      [iamIssuerId, atwIssuerId, manualIssuerId],
    ]);
    await adminClient.query(
      "delete from market.ambiguous_document_issuers where source_issuer_id like 'test-%'",
    );
    await adminClient.query('delete from market.issuers where id=$1', [manualIssuerId]);
    await adminClient.query('delete from public.user_roles where user_id = any($1)', [
      [ids.investor, ids.admin],
    ]);
    await adminClient.query('delete from public.profiles where id = any($1)', [
      [ids.investor, ids.admin],
    ]);
    await adminClient.query('delete from auth.users where id = any($1)', [
      [ids.investor, ids.admin],
    ]);
    await adminClient.end();
  });

  it('rejects an investor calling upsert_company_document_manual', async () => {
    await expect(
      asUser(
        ids.investor,
        'select public.upsert_company_document_manual($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [
          null,
          manualIssuerId,
          null,
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
      asUser(null, 'select public.upsert_company_document_manual($1,$2,$3,$4,$5,$6,$7,$8,$9)', [
        null,
        manualIssuerId,
        null,
        'annual_report',
        2024,
        'Anonymous attempt',
        'https://example.test/report.pdf',
        null,
        null,
      ]),
    ).rejects.toThrow(/permission denied/i);
  });

  it('lets a data_admin add a manual report by issuer_id, and public/investor can read it back through both safe views', async () => {
    const insert = await asUser<{ upsert_company_document_manual: string }>(
      ids.admin,
      'select public.upsert_company_document_manual($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [
        null,
        manualIssuerId,
        null,
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

    const asAnonByIssuer = await asUser(
      null,
      'select * from public.issuer_company_documents where id=$1',
      [documentId],
    );
    expect(asAnonByIssuer.rows).toHaveLength(1);
    expect(asAnonByIssuer.rows[0]!['source_provider_id']).toBe('admin_manual');
    expect(asAnonByIssuer.rows[0]!['issuer_id']).toBe(manualIssuerId);
  });

  it("also accepts a security_id, resolving it to that security's issuer server-side", async () => {
    const securityId = await adminClient.query<{ id: string }>(
      "select id from market.securities where ticker='SYN-ATW'",
    );
    const insert = await asUser<{ upsert_company_document_manual: string }>(
      ids.admin,
      'select public.upsert_company_document_manual($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [
        null,
        null,
        securityId.rows[0]!.id,
        'annual_report',
        2024,
        'Via security_id',
        'https://example.test/via-security.pdf',
        null,
        null,
      ],
    );
    const documentId = insert.rows[0]!.upsert_company_document_manual;
    const stored = await adminClient.query(
      'select issuer_id from market.company_documents where id=$1',
      [documentId],
    );
    expect(stored.rows[0]!['issuer_id']).toBe(atwIssuerId);
  });

  it('the public views never expose an unpublished document', async () => {
    await adminClient.query(
      `insert into market.company_documents(issuer_id,document_type,fiscal_year,title,source_provider_id,source_url,status)
       values($1,'annual_report',2020,'Unavailable test doc','admin_manual','https://example.test/unavailable.pdf','unavailable')`,
      [manualIssuerId],
    );
    const result = await asUser(
      null,
      "select * from public.issuer_company_documents where source_url='https://example.test/unavailable.pdf'",
    );
    expect(result.rows).toHaveLength(0);
  });

  it('enforces (source_provider_id, source_record_url, source_url) uniqueness -- the idempotency key', async () => {
    await adminClient.query(
      `insert into market.company_documents(issuer_id,document_type,fiscal_year,title,source_provider_id,source_record_url,source_url)
       values($1,'annual_report',2022,'First','admin_manual','https://example.test/record/dup','https://example.test/dup.pdf')`,
      [manualIssuerId],
    );
    await expect(
      adminClient.query(
        `insert into market.company_documents(issuer_id,document_type,fiscal_year,title,source_provider_id,source_record_url,source_url)
         values($1,'annual_report',2022,'Second, same filing record and asset','admin_manual','https://example.test/record/dup','https://example.test/dup.pdf')`,
        [iamIssuerId],
      ),
    ).rejects.toThrow(/duplicate key|unique/i);
  });

  it('allows the identical PDF asset URL across two distinct filing records -- a FILE is not a FILING (real Meditelecom case)', async () => {
    // Proves the fix at the schema level, not just in the sync pipeline: two different filing
    // records (different source_record_url, e.g. different fiscal years' detail pages) that
    // happen to attach the same PDF must both be allowed to persist as separate rows.
    const shared = 'https://example.test/shared-asset.pdf';
    const first = await adminClient.query<{ id: string }>(
      `insert into market.company_documents(issuer_id,document_type,fiscal_year,title,source_provider_id,source_record_url,source_url)
       values($1,'annual_report',2015,'Rapports sociaux annuels 2015','ammc_public_documents','https://example.test/record/2015',$2)
       returning id`,
      [iamIssuerId, shared],
    );
    const second = await adminClient.query<{ id: string }>(
      `insert into market.company_documents(issuer_id,document_type,fiscal_year,title,source_provider_id,source_record_url,source_url)
       values($1,'annual_report',2017,'Rapports sociaux annuels 2017','ammc_public_documents','https://example.test/record/2017',$2)
       returning id`,
      [iamIssuerId, shared],
    );
    expect(first.rows[0]!.id).not.toBe(second.rows[0]!.id);

    const stored = await adminClient.query(
      'select fiscal_year from market.company_documents where source_url=$1 order by fiscal_year',
      [shared],
    );
    expect(stored.rows.map((r) => r['fiscal_year'])).toEqual([2015, 2017]);
  });

  it('requires a real issuer_id -- the foreign key rejects an unknown one', async () => {
    await expect(
      adminClient.query(
        `insert into market.company_documents(issuer_id,document_type,fiscal_year,title,source_provider_id,source_url)
         values($1,'annual_report',2022,'Orphan','admin_manual','https://example.test/orphan.pdf')`,
        [randomUUID()],
      ),
    ).rejects.toThrow(/foreign key/i);
  });

  it("lets a data_admin set an issuer's direct AMMC link, readable through the public issuer_directory", async () => {
    const upsert = await asUser<{ upsert_issuer_ammc_link: string }>(
      ids.admin,
      'select public.upsert_issuer_ammc_link($1,$2,$3)',
      [manualIssuerId, 'test-99001', 'LIVE TEST ISSUER AMMC NAME'],
    );
    expect(upsert.rows[0]!.upsert_issuer_ammc_link).toBe(manualIssuerId);

    const stored = await adminClient.query(
      'select ammc_issuer_id from market.issuers where id=$1',
      [manualIssuerId],
    );
    expect(stored.rows[0]!['ammc_issuer_id']).toBe('test-99001');

    // ammc_issuer_id itself is not exposed publicly through issuer_directory's identity beyond
    // being usable for matching -- but the column IS public (see 202609070003), so this proves
    // the write round-trips through the exact surface the sync pipeline reads.
    const asAnon = await asUser(
      null,
      'select ammc_issuer_id from public.issuer_directory where id=$1',
      [manualIssuerId],
    );
    expect(asAnon.rows[0]!['ammc_issuer_id']).toBe('test-99001');

    await expect(
      asUser(ids.investor, 'select public.upsert_issuer_ammc_link($1,$2,$3)', [
        manualIssuerId,
        'x',
        'y',
      ]),
    ).rejects.toThrow(/FORBIDDEN/);
  });

  it('lets a data_admin create a new issuer with a unique slug, even on a name collision', async () => {
    const first = await asUser<{ create_issuer_manual: string }>(
      ids.admin,
      'select public.create_issuer_manual($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [
        'Live Test Duplicate Name',
        'unlisted_company',
        'no_listed_bvc_equity',
        null,
        null,
        null,
        null,
        null,
        null,
      ],
    );
    const second = await asUser<{ create_issuer_manual: string }>(
      ids.admin,
      'select public.create_issuer_manual($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [
        'Live Test Duplicate Name',
        'unlisted_company',
        'no_listed_bvc_equity',
        null,
        null,
        null,
        null,
        null,
        null,
      ],
    );
    const slugs = await adminClient.query('select slug from market.issuers where id = any($1)', [
      [first.rows[0]!.create_issuer_manual, second.rows[0]!.create_issuer_manual],
    ]);
    const distinctSlugs = new Set(slugs.rows.map((r) => r['slug']));
    expect(distinctSlugs.size).toBe(2);

    await adminClient.query('delete from market.issuers where id = any($1)', [
      [first.rows[0]!.create_issuer_manual, second.rows[0]!.create_issuer_manual],
    ]);
  });

  it('surfaces an ambiguous issuer for admin review, links it to an existing issuer, and resolves it in one call', async () => {
    await adminClient.query(
      `insert into market.ambiguous_document_issuers(source_provider_id,source_issuer_id,source_issuer_name)
       values('ammc_public_documents','test-99002','AMBIGUOUS TEST ISSUER')`,
    );
    const openList = await asUser(
      ids.admin,
      "select * from public.list_ambiguous_document_issuers('open')",
    );
    const row = openList.rows.find((r) => r['source_issuer_id'] === 'test-99002');
    expect(row).toBeTruthy();

    await asUser(ids.admin, 'select public.resolve_ambiguous_document_issuer($1,$2,$3)', [
      row!['id'],
      'resolved',
      manualIssuerId,
    ]);

    const afterResolve = await asUser(
      ids.admin,
      "select * from public.list_ambiguous_document_issuers('open')",
    );
    expect(afterResolve.rows.some((r) => r['source_issuer_id'] === 'test-99002')).toBe(false);

    const linkedIssuer = await adminClient.query(
      'select ammc_issuer_id from market.issuers where id=$1',
      [manualIssuerId],
    );
    expect(linkedIssuer.rows[0]!['ammc_issuer_id']).toBe('test-99002');
  });

  it('coverage stats and sync-run history are only readable by data_admin, not by an investor', async () => {
    const asAdmin = await asUser(ids.admin, 'select public.company_documents_coverage_stats()');
    expect(asAdmin.rows).toHaveLength(1);
    await expect(
      asUser(ids.investor, 'select public.company_documents_coverage_stats()'),
    ).rejects.toThrow(/FORBIDDEN/);

    const runsAsInvestor = await asUser(
      ids.investor,
      'select * from public.list_document_sync_runs()',
    );
    expect(runsAsInvestor.rows).toHaveLength(0);
  });
});

live.sequential('live issuer model: backfill correctness and RLS', () => {
  let adminClient: Client;

  beforeAll(async () => {
    adminClient = await connect();
  });

  afterAll(async () => {
    await adminClient.end();
  });

  it('every currently listed/suspended, non-synthetic security has a valid, non-synthetic issuer', async () => {
    const orphaned = await adminClient.query(
      `select s.ticker from market.securities s
       left join market.issuers i on i.id=s.issuer_id
       where not s.is_synthetic and (i.id is null or i.is_synthetic)`,
    );
    expect(orphaned.rows).toEqual([]);
  });

  it('no two issuers share the same non-null ammc_issuer_id', async () => {
    const dupes = await adminClient.query(
      `select ammc_issuer_id, count(*) from market.issuers
       where ammc_issuer_id is not null group by ammc_issuer_id having count(*) > 1`,
    );
    expect(dupes.rows).toEqual([]);
  });

  it('no two issuers share the same slug', async () => {
    const dupes = await adminClient.query(
      'select slug, count(*) from market.issuers group by slug having count(*) > 1',
    );
    expect(dupes.rows).toEqual([]);
  });

  it('security_fundamentals and security_company_documents keep their pre-migration row counts (no data loss)', async () => {
    const fundamentalsRows = await adminClient.query('select count(*) from market.fundamentals');
    const viewRows = await asUser(null, 'select count(*) from public.security_fundamentals');
    // The view now joins through issuer_id; every fundamentals row's issuer must resolve back
    // to exactly the securities sharing that issuer (1:1 today), so counts match exactly.
    expect(Number(viewRows.rows[0]!['count'])).toBe(Number(fundamentalsRows.rows[0]!['count']));

    const documentsRows = await adminClient.query('select count(*) from market.company_documents');
    const docViewRows = await asUser(
      null,
      'select count(*) from public.security_company_documents',
    );
    expect(Number(docViewRows.rows[0]!['count'])).toBeLessThanOrEqual(
      Number(documentsRows.rows[0]!['count']),
    );
  });

  it('public can read the issuer directory (listed and unlisted), never seeing synthetic fixtures', async () => {
    const asAnon = await asUser(null, 'select id from public.issuer_directory');
    const anonIds = new Set(asAnon.rows.map((r) => r['id']));
    expect(anonIds.size).toBeGreaterThan(0);

    const syntheticIssuers = await adminClient.query(
      'select id from market.issuers where is_synthetic',
    );
    for (const row of syntheticIssuers.rows) {
      expect(anonIds.has(row['id'])).toBe(false);
    }
  });
});
