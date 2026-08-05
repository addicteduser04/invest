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

const ids = {
  userA: randomUUID(),
  userB: randomUUID(),
  admin: randomUUID(),
  portfolioA: randomUUID(),
  portfolioB: randomUUID(),
};

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
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    await client.end();
  }
}

async function record(
  userId: string,
  portfolioId: string,
  type: 'deposit' | 'withdrawal' | 'buy' | 'sell' | 'dividend' | 'fee' | 'tax',
  key: string,
  amount: string | null,
  securityId: string | null = null,
  quantity: string | null = null,
  price: string | null = null,
) {
  return asUser<{ id: string }>(
    userId,
    'select public.record_transaction($1,$2,current_date,$3,$4,$5,$6,$7,0,0) id',
    [portfolioId, type, key, amount, securityId, quantity, price],
  );
}

live.sequential('live PostgreSQL RLS and transaction matrix', () => {
  let adminClient: Client;
  let securityId: string;

  beforeAll(async () => {
    adminClient = await connect();
    await adminClient.query(
      `insert into auth.users(id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
       select id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', '{}', metadata, now(), now()
       from (values ($1::uuid,$1::text || '@example.test','{"locale":"fr"}'::jsonb),($2::uuid,$2::text || '@example.test','{"locale":"ar"}'::jsonb),($3::uuid,$3::text || '@example.test','{}'::jsonb)) u(id,email,metadata)`,
      [ids.userA, ids.userB, ids.admin],
    );
    await adminClient.query("insert into public.user_roles(user_id,role) values($1,'data_admin')", [
      ids.admin,
    ]);
    await adminClient.query(
      "insert into public.portfolios(id,owner_id,name) values($1,$2,'A'),($3,$4,'B')",
      [ids.portfolioA, ids.userA, ids.portfolioB, ids.userB],
    );
    const result = await adminClient.query<{ id: string }>(
      "select id from market.securities where ticker='SYN-IAM'",
    );
    securityId = result.rows[0]!.id;
  });

  afterAll(async () => {
    if (!adminClient) return;
    await adminClient.query(
      'delete from private.cash_ledger_entries where portfolio_id=any($1::uuid[])',
      [[ids.portfolioA, ids.portfolioB]],
    );
    await adminClient.query('delete from private.outbox where aggregate_id=any($1::uuid[])', [
      [ids.portfolioA, ids.portfolioB],
    ]);
    await adminClient.query('delete from public.transactions where portfolio_id=any($1::uuid[])', [
      [ids.portfolioA, ids.portfolioB],
    ]);
    await adminClient.query('delete from public.portfolios where id=any($1::uuid[])', [
      [ids.portfolioA, ids.portfolioB],
    ]);
    await adminClient.query('delete from auth.users where id=any($1::uuid[])', [
      [ids.userA, ids.userB, ids.admin],
    ]);
    await adminClient.end();
  });

  it('isolates anonymous, owner, other user, administrator and service connections', async () => {
    await expect(asUser(null, 'select * from public.portfolios')).rejects.toThrow(
      /permission denied/,
    );
    expect((await asUser(ids.userA, 'select id from public.portfolios')).rows).toEqual([
      { id: ids.portfolioA },
    ]);
    expect((await asUser(ids.userB, 'select id from public.portfolios')).rows).toEqual([
      { id: ids.portfolioB },
    ]);
    expect((await asUser(ids.admin, 'select id from public.portfolios')).rowCount).toBe(0);
    expect(
      (await adminClient.query('select id from public.portfolios where id=$1', [ids.portfolioA]))
        .rowCount,
    ).toBe(1);
    await expect(
      asUser(ids.userB, "update public.portfolios set name='forged' where id=$1 returning id", [
        ids.portfolioA,
      ]),
    ).resolves.toMatchObject({ rowCount: 0 });
    await expect(record(ids.userB, ids.portfolioA, 'deposit', randomUUID(), '1')).rejects.toThrow(
      /forbidden/,
    );
    await expect(asUser(ids.userA, 'select * from private.cash_ledger_entries')).rejects.toThrow(
      /permission denied/,
    );
  });

  it('applies one financial effect for concurrent reuse of an idempotency key', async () => {
    const key = randomUUID();
    const [first, second] = await Promise.all([
      record(ids.userA, ids.portfolioA, 'deposit', key, '100'),
      record(ids.userA, ids.portfolioA, 'deposit', key, '100'),
    ]);
    expect(first.rows[0]!.id).toBe(second.rows[0]!.id);
    const effects = await adminClient.query<{ count: string; amount: string }>(
      'select count(*) count,sum(amount)::text amount from private.cash_ledger_entries where portfolio_id=$1',
      [ids.portfolioA],
    );
    expect(effects.rows[0]).toEqual({ count: '1', amount: '100.000000' });
  });

  it('prevents concurrent purchases from spending the same cash', async () => {
    await adminClient.query(
      `create or replace function pg_temp.delay_buy() returns trigger language plpgsql as $$begin perform pg_sleep(0.5); return new; end$$`,
    );
    await adminClient.query(
      "create trigger live_test_delay before insert on public.transactions for each row when (new.transaction_type='buy') execute function pg_temp.delay_buy()",
    );
    const results = await Promise.allSettled([
      record(ids.userA, ids.portfolioA, 'buy', randomUUID(), null, securityId, '1', '80'),
      record(ids.userA, ids.portfolioA, 'buy', randomUUID(), null, securityId, '1', '80'),
    ]);
    await adminClient.query('drop trigger live_test_delay on public.transactions');
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const cash = await adminClient.query<{ cash: string }>(
      'select coalesce(sum(amount),0)::text cash from private.cash_ledger_entries where portfolio_id=$1',
      [ids.portfolioA],
    );
    expect(cash.rows[0]!.cash).toBe('20.000000');
  });

  it('routes every financial mutation through the command and enforces holdings', async () => {
    await expect(
      asUser(
        ids.userA,
        `insert into public.transactions(portfolio_id,transaction_type,trade_date,settlement_date,net_amount,idempotency_key,created_by)
         values($1,'deposit',current_date,current_date,1,$2,$3)`,
        [ids.portfolioA, randomUUID(), ids.userA],
      ),
    ).rejects.toThrow(/permission denied/);
    await record(ids.userA, ids.portfolioA, 'deposit', randomUUID(), '1000');
    await record(ids.userA, ids.portfolioA, 'buy', randomUUID(), null, securityId, '10', '50');
    await record(ids.userA, ids.portfolioA, 'sell', randomUUID(), null, securityId, '4', '60');
    await record(ids.userA, ids.portfolioA, 'dividend', randomUUID(), '20');
    await record(ids.userA, ids.portfolioA, 'fee', randomUUID(), '5');
    await record(ids.userA, ids.portfolioA, 'tax', randomUUID(), '2');
    await record(ids.userA, ids.portfolioA, 'withdrawal', randomUUID(), '10');
    await expect(
      record(ids.userA, ids.portfolioA, 'sell', randomUUID(), null, securityId, '8', '60'),
    ).rejects.toThrow(/insufficient quantity/);
    const result = await adminClient.query<{ cash: string; quantity: string }>(
      `select (select sum(amount)::text from private.cash_ledger_entries where portfolio_id=$1) cash,
              (select sum(case transaction_type when 'buy' then quantity when 'sell' then -quantity else 0 end)::text
                 from public.transactions where portfolio_id=$1 and security_id=$2) quantity`,
      [ids.portfolioA, securityId],
    );
    expect(result.rows[0]).toEqual({ cash: '763.000000', quantity: '7.00000000' });
  });
});
