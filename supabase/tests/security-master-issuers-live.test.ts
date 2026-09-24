import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const enabled = process.env['LIVE_DATABASE_TESTS'] === '1';
const databaseUrl = process.env['TEST_DATABASE_URL'];
const live = enabled ? describe.sequential : describe.skip;

if (enabled && !/^postgresql:\/\/[^@]+@(?:127\.0\.0\.1|localhost):\d+\//.test(databaseUrl ?? '')) {
  throw new Error('Live database tests are restricted to a disposable local PostgreSQL instance');
}

type ImportResult = {
  updatedRows: number;
  securitiesInserted: number;
  securitiesUpdated: number;
  issuersCreated: number;
};

// Unique per run so the suite never collides with real or previously-seeded rows.
const run = randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase();
const ticker = (label: string) => `ZT${run}${label}`;
const issuerName = (label: string) => `Zeta Test ${run} ${label}`;

live('upsert_market_security_master issuer resolution', () => {
  const admin = randomUUID();
  let db: Client;

  async function applyRows(rows: Record<string, unknown>[]) {
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query('begin');
      await client.query('set local role authenticated');
      await client.query("select set_config('request.jwt.claim.sub', $1, true)", [admin]);
      const result = await client.query<{ result: ImportResult }>(
        'select public.upsert_market_security_master($1::jsonb) as result',
        [JSON.stringify(rows)],
      );
      await client.query('commit');
      return result.rows[0]!.result;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      await client.end();
    }
  }

  const bvcRow = (label: string, overrides: Record<string, unknown> = {}) => ({
    ticker: ticker(label),
    name: `ZETA ${label}`,
    sector: 'Banks',
    listingStatus: 'active',
    listedOn: null,
    isin: null,
    issuerName: issuerName(label),
    sourceId: `test-${run}-${label}`,
    ...overrides,
  });

  async function security(label: string) {
    const result = await db.query<{ id: string; name: string; issuer_id: string | null }>(
      'select id,name,issuer_id from market.securities where ticker=$1',
      [ticker(label)],
    );
    return result.rows;
  }

  async function issuersNamed(label: string) {
    const result = await db.query<{
      id: string;
      issuer_type: string;
      equity_listing_status: string;
      is_synthetic: boolean;
    }>(
      `select id,issuer_type,equity_listing_status,is_synthetic from market.issuers
       where private.normalize_company_name(name)=private.normalize_company_name($1)`,
      [issuerName(label)],
    );
    return result.rows;
  }

  beforeAll(async () => {
    db = new Client({ connectionString: databaseUrl });
    await db.connect();
    await db.query(
      `insert into auth.users(id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
       values($1::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $1::text || '@example.test', '', '{}', '{}', now(), now())`,
      [admin],
    );
    await db.query("insert into public.user_roles(user_id,role) values($1,'data_admin')", [admin]);
  });

  afterAll(async () => {
    await db.query('delete from market.securities where ticker like $1', [`ZT${run}%`]);
    await db.query('delete from market.issuers where name ilike $1', [`Zeta Test ${run}%`]);
    await db.end();
  });

  it('creates a listed issuer for a new security from the source issuer name', async () => {
    const result = await applyRows([bvcRow('NEW')]);
    expect(result).toMatchObject({
      securitiesInserted: 1,
      securitiesUpdated: 0,
      issuersCreated: 1,
    });
    const [row] = await security('NEW');
    const [issuer] = await issuersNamed('NEW');
    expect(row?.issuer_id).toBe(issuer?.id);
    expect(issuer).toMatchObject({
      issuer_type: 'listed_company',
      equity_listing_status: 'listed_bvc',
      is_synthetic: false,
    });
  });

  it('links a new security to an existing issuer and marks that issuer as BVC-listed', async () => {
    const existing = await db.query<{ id: string }>(
      `insert into market.issuers(name,normalized_name,slug,issuer_type,equity_listing_status)
       values($1,private.normalize_company_name($1),private.slugify($1),'unlisted_company','no_listed_bvc_equity')
       returning id`,
      [issuerName('EXIST')],
    );
    // Same company, different surface form: normalization strips case, accents and "S.A.".
    const result = await applyRows([
      bvcRow('EXIST', { issuerName: `${issuerName('EXIST').toUpperCase()} S.A.` }),
    ]);
    expect(result).toMatchObject({ securitiesInserted: 1, issuersCreated: 0 });
    const [row] = await security('EXIST');
    expect(row?.issuer_id).toBe(existing.rows[0]!.id);
    const issuers = await issuersNamed('EXIST');
    expect(issuers).toHaveLength(1);
    expect(issuers[0]).toMatchObject({
      issuer_type: 'listed_company',
      equity_listing_status: 'listed_bvc',
    });
  });

  it('re-imports an existing security in place without re-linking its issuer', async () => {
    const [before] = await security('NEW');
    const result = await applyRows([
      bvcRow('NEW', { name: 'ZETA NEW RENAMED', issuerName: issuerName('OTHER') }),
    ]);
    expect(result).toMatchObject({
      securitiesInserted: 0,
      securitiesUpdated: 1,
      issuersCreated: 0,
    });
    const [after] = await security('NEW');
    expect(after).toMatchObject({ id: before!.id, issuer_id: before!.issuer_id });
    expect(after?.name).toBe('ZETA NEW RENAMED');
    expect(await issuersNamed('OTHER')).toHaveLength(0);
  });

  it('creates one issuer when several new securities in a batch share it', async () => {
    const shared = issuerName('SHARED');
    const result = await applyRows([
      bvcRow('SH1', { issuerName: shared }),
      bvcRow('SH2', { issuerName: shared }),
    ]);
    expect(result).toMatchObject({ securitiesInserted: 2, issuersCreated: 1 });
    const issuers = await issuersNamed('SHARED');
    expect(issuers).toHaveLength(1);
    expect((await security('SH1'))[0]?.issuer_id).toBe(issuers[0]!.id);
    expect((await security('SH2'))[0]?.issuer_id).toBe(issuers[0]!.id);
  });

  it('is idempotent: a second identical import creates no securities or issuers', async () => {
    const batch = [bvcRow('IDEM1'), bvcRow('IDEM2')];
    const first = await applyRows(batch);
    expect(first).toMatchObject({ securitiesInserted: 2, issuersCreated: 2 });
    const firstLinks = [(await security('IDEM1'))[0], (await security('IDEM2'))[0]];
    const second = await applyRows(batch);
    expect(second).toMatchObject({
      securitiesInserted: 0,
      securitiesUpdated: 2,
      issuersCreated: 0,
    });
    expect([(await security('IDEM1'))[0], (await security('IDEM2'))[0]]).toEqual(firstLinks);
    expect(await security('IDEM1')).toHaveLength(1);
    expect(await issuersNamed('IDEM1')).toHaveLength(1);
    expect(await issuersNamed('IDEM2')).toHaveLength(1);
  });

  it('never leaves a security without an issuer', async () => {
    const result = await db.query<{ missing: string }>(
      'select count(*)::text as missing from market.securities where issuer_id is null',
    );
    expect(result.rows[0]!.missing).toBe('0');
  });

  it('rejects a new security with no issuer identity and rolls back the whole batch', async () => {
    await expect(
      applyRows([bvcRow('OKROW'), bvcRow('NOISSUER', { issuerName: null })]),
    ).rejects.toThrow(/ISSUER_IDENTITY_MISSING/);
    expect(await security('OKROW')).toHaveLength(0);
    expect(await issuersNamed('OKROW')).toHaveLength(0);
    expect(await security('NOISSUER')).toHaveLength(0);
  });

  it('refuses to guess when the issuer name matches more than one existing issuer', async () => {
    for (const suffix of ['a', 'b'])
      await db.query(
        `insert into market.issuers(name,normalized_name,slug,issuer_type,equity_listing_status)
         values($1,private.normalize_company_name($1),private.slugify($1)||'-'||$2,'other','unknown')`,
        [issuerName('AMBIG'), suffix],
      );
    await expect(applyRows([bvcRow('AMBIG')])).rejects.toThrow(/AMBIGUOUS_ISSUER/);
    expect(await security('AMBIG')).toHaveLength(0);
    expect(await issuersNamed('AMBIG')).toHaveLength(2);
  });
});
