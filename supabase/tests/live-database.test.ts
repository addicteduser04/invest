import { createHash, randomUUID } from 'node:crypto';
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
  importPortfolio: randomUUID(),
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

async function asDatabaseRole<T extends QueryResultRow>(role: 'service_role', sql: string) {
  const client = await connect();
  try {
    await client.query('begin');
    await client.query(`set local role ${role}`);
    const result = await client.query<T>(sql);
    await client.query('commit');
    return result;
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
      "insert into public.portfolios(id,owner_id,name) values($1,$2,'A'),($3,$4,'B'),($5,$2,'Imports')",
      [ids.portfolioA, ids.userA, ids.portfolioB, ids.userB, ids.importPortfolio],
    );
    const result = await adminClient.query<{ id: string }>(
      "select id from market.securities where ticker='SYN-IAM'",
    );
    securityId = result.rows[0]!.id;
  });

  afterAll(async () => {
    if (!adminClient) return;
    await adminClient.query('delete from public.transaction_import_attempts where owner_id=$1', [
      ids.userA,
    ]);
    await adminClient.query(
      'delete from private.transaction_import_blobs where import_id in (select id from public.transaction_imports where owner_id=$1)',
      [ids.userA],
    );
    await adminClient.query('delete from public.transaction_imports where owner_id=$1', [
      ids.userA,
    ]);
    await adminClient.query(
      'delete from private.cash_ledger_entries where portfolio_id=any($1::uuid[])',
      [[ids.portfolioA, ids.portfolioB, ids.importPortfolio]],
    );
    await adminClient.query('delete from private.outbox where aggregate_id=any($1::uuid[])', [
      [ids.portfolioA, ids.portfolioB, ids.importPortfolio],
    ]);
    await adminClient.query('delete from public.transactions where portfolio_id=any($1::uuid[])', [
      [ids.portfolioA, ids.portfolioB, ids.importPortfolio],
    ]);
    await adminClient.query('delete from public.portfolios where id=any($1::uuid[])', [
      [ids.portfolioA, ids.portfolioB, ids.importPortfolio],
    ]);
    await adminClient.query('delete from auth.users where id=any($1::uuid[])', [
      [ids.userA, ids.userB, ids.admin],
    ]);
    await adminClient.end();
  });

  async function createImport(
    rows: Record<string, unknown>[],
    content = `csv-${randomUUID()}`,
    totals?: { valid: number; invalid: number },
  ) {
    const hash = createHash('sha256').update(content).digest('hex');
    return asUser<{ id: string }>(
      ids.userA,
      `select public.create_transaction_import($1,'transactions.csv',$2,$3,'text/csv',$4,'{}',1,$5,$6) id`,
      [
        ids.importPortfolio,
        hash,
        Buffer.byteLength(content),
        content,
        JSON.stringify(totals ?? { valid: rows.length, invalid: 0, total: rows.length }),
        JSON.stringify(rows),
      ],
    );
  }

  it('persists preview audit without financial or outbox effects and isolates private data', async () => {
    const before = await adminClient.query<{ transactions: string; outbox: string }>(
      `select (select count(*) from public.transactions where portfolio_id=$1)::text transactions,(select count(*) from private.outbox where aggregate_id=$1)::text outbox`,
      [ids.importPortfolio],
    );
    const created = await createImport([
      {
        row: 2,
        date: '2026-08-01',
        type: 'deposit',
        amount: '100.000001',
        fees: '0',
        taxes: '0',
        externalReference: randomUUID(),
      },
    ]);
    expect(created.rows[0]!.id).toBeTruthy();
    const after = await adminClient.query<{ transactions: string; outbox: string }>(
      `select (select count(*) from public.transactions where portfolio_id=$1)::text transactions,(select count(*) from private.outbox where aggregate_id=$1)::text outbox`,
      [ids.importPortfolio],
    );
    expect(after.rows[0]).toEqual(before.rows[0]);
    await expect(
      asUser(ids.userA, 'select * from private.transaction_import_blobs'),
    ).rejects.toThrow(/permission denied/);
    expect(
      (
        await asUser(ids.userB, 'select id from public.transaction_imports where id=$1', [
          created.rows[0]!.id,
        ])
      ).rowCount,
    ).toBe(0);
    await expect(
      asUser(ids.userB, 'select public.confirm_transaction_import($1)', [created.rows[0]!.id]),
    ).rejects.toThrow(/FORBIDDEN_PORTFOLIO/);
  });

  it('atomically confirms a deterministic mixed batch containing all seven transaction types', async () => {
    const refs = Array.from({ length: 7 }, () => randomUUID());
    const rows = [
      {
        row: 2,
        date: '2026-08-02',
        type: 'deposit',
        amount: '1000',
        fees: '0',
        taxes: '0',
        externalReference: refs[0],
      },
      {
        row: 3,
        date: '2026-08-02',
        type: 'withdrawal',
        amount: '10',
        fees: '0',
        taxes: '0',
        externalReference: refs[1],
      },
      {
        row: 4,
        date: '2026-08-02',
        type: 'buy',
        securityId,
        quantity: '2',
        unitPrice: '50',
        fees: '0',
        taxes: '0',
        externalReference: refs[2],
      },
      {
        row: 5,
        date: '2026-08-02',
        type: 'sell',
        securityId,
        quantity: '1',
        unitPrice: '60',
        fees: '0',
        taxes: '0',
        externalReference: refs[3],
      },
      {
        row: 6,
        date: '2026-08-02',
        type: 'dividend',
        amount: '20',
        fees: '0',
        taxes: '0',
        externalReference: refs[4],
      },
      {
        row: 7,
        date: '2026-08-02',
        type: 'fee',
        amount: '5',
        fees: '0',
        taxes: '0',
        externalReference: refs[5],
      },
      {
        row: 8,
        date: '2026-08-02',
        type: 'tax',
        amount: '2',
        fees: '0',
        taxes: '0',
        externalReference: refs[6],
      },
    ];
    const importId = (await createImport(rows)).rows[0]!.id;
    const confirmed = await asUser<{ result: { status: string; transactionIds: string[] } }>(
      ids.userA,
      'select public.confirm_transaction_import($1) result',
      [importId],
    );
    expect(confirmed.rows[0]!.result.status).toBe('confirmed');
    expect(confirmed.rows[0]!.result.transactionIds).toHaveLength(7);
    const effects = await adminClient.query<{ cash: string; holding: string; outbox: string }>(
      `select (select sum(amount)::text from private.cash_ledger_entries where portfolio_id=$1) cash,(select sum(case transaction_type when 'buy' then quantity when 'sell' then -quantity else 0 end)::text from public.transactions where portfolio_id=$1 and security_id=$2) holding,(select count(*)::text from private.outbox where aggregate_id=$1) outbox`,
      [ids.importPortfolio, securityId],
    );
    expect(effects.rows[0]).toEqual({ cash: '963.000000', holding: '1.00000000', outbox: '7' });
    const types = await adminClient.query<{ transaction_type: string }>(
      'select transaction_type from public.transactions where id=any($1::uuid[]) order by created_at,id',
      [confirmed.rows[0]!.result.transactionIds],
    );
    expect(types.rows.map((row) => row.transaction_type).sort()).toEqual([
      'buy',
      'deposit',
      'dividend',
      'fee',
      'sell',
      'tax',
      'withdrawal',
    ]);
  });

  it('rolls back a middle-row failure and persists only its sanitized owner audit', async () => {
    const before = await adminClient.query<{ transactions: string; outbox: string; cash: string }>(
      `select (select count(*) from public.transactions where portfolio_id=$1)::text transactions,(select count(*) from private.outbox where aggregate_id=$1)::text outbox,(select sum(amount)::text from private.cash_ledger_entries where portfolio_id=$1) cash`,
      [ids.importPortfolio],
    );
    const rows = [
      {
        row: 2,
        date: '2026-08-03',
        type: 'deposit',
        amount: '1',
        fees: '0',
        taxes: '0',
        externalReference: randomUUID(),
      },
      {
        row: 3,
        date: '2026-08-03',
        type: 'withdrawal',
        amount: '99999',
        fees: '0',
        taxes: '0',
        externalReference: randomUUID(),
      },
      {
        row: 4,
        date: '2026-08-03',
        type: 'deposit',
        amount: '1',
        fees: '0',
        taxes: '0',
        externalReference: randomUUID(),
      },
    ];
    const importId = (await createImport(rows)).rows[0]!.id;
    const result = await asUser<{
      result: { status: string; failureCode: string; failedRow: number };
    }>(ids.userA, 'select public.confirm_transaction_import($1) result', [importId]);
    expect(result.rows[0]!.result).toMatchObject({
      status: 'failed',
      failureCode: 'INSUFFICIENT_CASH',
      failedRow: 3,
    });
    const after = await adminClient.query<{ transactions: string; outbox: string; cash: string }>(
      `select (select count(*) from public.transactions where portfolio_id=$1)::text transactions,(select count(*) from private.outbox where aggregate_id=$1)::text outbox,(select sum(amount)::text from private.cash_ledger_entries where portfolio_id=$1) cash`,
      [ids.importPortfolio],
    );
    expect(after.rows[0]).toEqual(before.rows[0]);
    expect(
      (
        await asUser(
          ids.userA,
          'select failure_code from public.transaction_import_attempts where import_id=$1',
          [importId],
        )
      ).rows,
    ).toEqual([{ failure_code: 'INSUFFICIENT_CASH' }]);
    expect(
      (
        await asUser(
          ids.userB,
          'select failure_code from public.transaction_import_attempts where import_id=$1',
          [importId],
        )
      ).rowCount,
    ).toBe(0);
  });

  it('serializes repeated and concurrent confirmation without duplicating effects', async () => {
    const reference = randomUUID();
    const importId = (
      await createImport([
        {
          row: 2,
          date: '2026-08-04',
          type: 'deposit',
          amount: '10',
          fees: '0',
          taxes: '0',
          externalReference: reference,
        },
      ])
    ).rows[0]!.id;
    const [a, b] = await Promise.all([
      asUser<{ result: { status: string } }>(
        ids.userA,
        'select public.confirm_transaction_import($1) result',
        [importId],
      ),
      asUser<{ result: { status: string } }>(
        ids.userA,
        'select public.confirm_transaction_import($1) result',
        [importId],
      ),
    ]);
    expect(a.rows[0]!.result.status).toBe('confirmed');
    expect(b.rows[0]!.result.status).toBe('confirmed');
    expect(
      (
        await adminClient.query(
          'select id from public.transactions where portfolio_id=$1 and idempotency_key=$2',
          [ids.importPortfolio, reference],
        )
      ).rowCount,
    ).toBe(1);
  });

  it('serializes duplicate uploads and prevents cross-user or confirmed supersession', async () => {
    const content = `same-${randomUUID()}`;
    const rows = [
      {
        row: 2,
        date: '2026-08-05',
        type: 'deposit',
        amount: '1',
        fees: '0',
        taxes: '0',
        externalReference: randomUUID(),
      },
    ];
    const uploads = await Promise.allSettled([
      createImport(rows, content),
      createImport(rows, content),
    ]);
    expect(uploads.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(uploads.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const importId = uploads.find(
      (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof createImport>>> =>
        result.status === 'fulfilled',
    )!.value.rows[0]!.id;
    await expect(
      asUser(ids.userB, 'select public.supersede_transaction_import($1)', [importId]),
    ).rejects.toThrow(/FORBIDDEN_PORTFOLIO/);
    const replacementContent = `corrected-${randomUUID()}`;
    const replacementHash = createHash('sha256').update(replacementContent).digest('hex');
    const replacement = await asUser<{ id: string }>(
      ids.userA,
      `select public.replace_transaction_import($1,$2,'corrected.csv',$3,$4,'text/csv',$5,'{}',1,$6,$7) id`,
      [
        importId,
        ids.importPortfolio,
        replacementHash,
        Buffer.byteLength(replacementContent),
        replacementContent,
        JSON.stringify({ valid: 1, invalid: 0, total: 1 }),
        JSON.stringify(rows),
      ],
    );
    const replacementId = replacement.rows[0]!.id;
    expect(
      (
        await adminClient.query(
          'select supersedes_import_id from public.transaction_imports where id=$1',
          [replacementId],
        )
      ).rows[0],
    ).toEqual({ supersedes_import_id: importId });
    await asUser(ids.userA, 'select public.confirm_transaction_import($1)', [replacementId]);
    await expect(
      asUser(ids.userA, 'select public.supersede_transaction_import($1)', [replacementId]),
    ).rejects.toThrow(/CONFIRMED_IMPORT_IMMUTABLE/);
    await expect(
      asUser(null, 'select public.confirm_transaction_import($1)', [replacementId]),
    ).rejects.toThrow(/permission denied/);
  });

  it('isolates anonymous, owner, other user, administrator and service connections', async () => {
    await expect(asUser(null, 'select * from public.portfolios')).rejects.toThrow(
      /permission denied/,
    );
    expect(
      (await asUser(ids.userA, 'select id from public.portfolios')).rows
        .map((row) => row.id)
        .sort(),
    ).toEqual([ids.portfolioA, ids.importPortfolio].sort());
    expect((await asUser(ids.userB, 'select id from public.portfolios')).rows).toEqual([
      { id: ids.portfolioB },
    ]);
    expect((await asUser(ids.admin, 'select id from public.portfolios')).rowCount).toBe(0);
    expect(
      (await asDatabaseRole('service_role', 'select id from public.portfolios')).rowCount,
    ).toBe(3);
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
