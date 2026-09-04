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
  reversalPortfolio: randomUUID(),
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
      "insert into public.portfolios(id,owner_id,name) values($1,$2,'A'),($3,$4,'B'),($5,$2,'Imports'),($6,$2,'Reversals')",
      [
        ids.portfolioA,
        ids.userA,
        ids.portfolioB,
        ids.userB,
        ids.importPortfolio,
        ids.reversalPortfolio,
      ],
    );
    const result = await adminClient.query<{ id: string }>(
      "select id from market.securities where ticker='SYN-IAM'",
    );
    securityId = result.rows[0]!.id;
  });

  afterAll(async () => {
    if (!adminClient) return;
    await adminClient.query(
      'delete from private.transaction_reversal_requests where portfolio_id=$1',
      [ids.reversalPortfolio],
    );
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
      [[ids.portfolioA, ids.portfolioB, ids.importPortfolio, ids.reversalPortfolio]],
    );
    await adminClient.query('delete from private.outbox where aggregate_id=any($1::uuid[])', [
      [ids.portfolioA, ids.portfolioB, ids.importPortfolio, ids.reversalPortfolio],
    ]);
    await adminClient.query('delete from public.transactions where portfolio_id=any($1::uuid[])', [
      [ids.portfolioA, ids.portfolioB, ids.importPortfolio, ids.reversalPortfolio],
    ]);
    await adminClient.query('delete from public.portfolios where id=any($1::uuid[])', [
      [ids.portfolioA, ids.portfolioB, ids.importPortfolio, ids.reversalPortfolio],
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

  it.each([
    [
      'first',
      2,
      [
        {
          row: 2,
          date: '2026-08-03',
          type: 'withdrawal',
          amount: '99999',
          fees: '0',
          taxes: '0',
          externalReference: randomUUID(),
        },
        {
          row: 3,
          date: '2026-08-03',
          type: 'deposit',
          amount: '1',
          fees: '0',
          taxes: '0',
          externalReference: randomUUID(),
        },
      ],
    ],
    [
      'final',
      4,
      [
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
          type: 'deposit',
          amount: '1',
          fees: '0',
          taxes: '0',
          externalReference: randomUUID(),
        },
        {
          row: 4,
          date: '2026-08-03',
          type: 'withdrawal',
          amount: '99999',
          fees: '0',
          taxes: '0',
          externalReference: randomUUID(),
        },
      ],
    ],
  ] as const)(
    'rolls back a %s-row failure while retaining only its audit',
    async (_position, failedRow, rows) => {
      const before = await adminClient.query<{
        transactions: string;
        outbox: string;
        cash: string;
      }>(
        `select (select count(*) from public.transactions where portfolio_id=$1)::text transactions,(select count(*) from private.outbox where aggregate_id=$1)::text outbox,(select coalesce(sum(amount),0)::text from private.cash_ledger_entries where portfolio_id=$1) cash`,
        [ids.importPortfolio],
      );
      const importId = (await createImport([...rows])).rows[0]!.id;
      const result = await asUser<{
        result: { status: string; failureCode: string; failedRow: number };
      }>(ids.userA, 'select public.confirm_transaction_import($1) result', [importId]);
      expect(result.rows[0]!.result).toMatchObject({
        status: 'failed',
        failureCode: 'INSUFFICIENT_CASH',
        failedRow,
      });
      const after = await adminClient.query<{ transactions: string; outbox: string; cash: string }>(
        `select (select count(*) from public.transactions where portfolio_id=$1)::text transactions,(select count(*) from private.outbox where aggregate_id=$1)::text outbox,(select coalesce(sum(amount),0)::text from private.cash_ledger_entries where portfolio_id=$1) cash`,
        [ids.importPortfolio],
      );
      expect(after.rows[0]).toEqual(before.rows[0]);
      expect(
        (
          await adminClient.query(
            'select status,imported_row_count,cardinality(transaction_ids) ids from public.transaction_imports where id=$1',
            [importId],
          )
        ).rows[0],
      ).toEqual({ status: 'failed', imported_row_count: null, ids: 0 });
      expect(
        (
          await asUser(
            ids.userA,
            'select failed_row,failure_code from public.transaction_import_attempts where import_id=$1',
            [importId],
          )
        ).rows,
      ).toEqual([{ failed_row: failedRow, failure_code: 'INSUFFICIENT_CASH' }]);
      expect(
        (
          await asUser(
            ids.userB,
            'select id from public.transaction_import_attempts where import_id=$1',
            [importId],
          )
        ).rowCount,
      ).toBe(0);
    },
  );

  it('prevents mapping mutation and binds confirmation to one immutable preview', async () => {
    const importId = (
      await createImport([
        {
          row: 2,
          date: '2026-08-06',
          type: 'deposit',
          amount: '3',
          fees: '0',
          taxes: '0',
          externalReference: randomUUID(),
        },
      ])
    ).rows[0]!.id;
    await expect(
      asUser(
        ids.userA,
        'update public.transaction_imports set mapping=\'{"type":"forged"}\' where id=$1 returning id',
        [importId],
      ),
    ).rejects.toThrow(/permission denied/);
    await asUser(ids.userA, 'select public.confirm_transaction_import($1)', [importId]);
    expect(
      (
        await adminClient.query(
          'select mapping,status from public.transaction_imports where id=$1',
          [importId],
        )
      ).rows[0],
    ).toEqual({ mapping: {}, status: 'confirmed' });
  });

  it('serializes preview replacement racing with confirmation', async () => {
    const content = `race-${randomUUID()}`;
    const rows = [
      {
        row: 2,
        date: '2026-08-07',
        type: 'deposit',
        amount: '4',
        fees: '0',
        taxes: '0',
        externalReference: randomUUID(),
      },
    ];
    const oldId = (await createImport(rows, content)).rows[0]!.id;
    const replacementContent = `replacement-${randomUUID()}`;
    const hash = createHash('sha256').update(replacementContent).digest('hex');
    const results = await Promise.allSettled([
      asUser(ids.userA, 'select public.confirm_transaction_import($1)', [oldId]),
      asUser(
        ids.userA,
        `select public.replace_transaction_import($1,$2,'replacement.csv',$3,$4,'text/csv',$5,'{}',1,$6,$7)`,
        [
          oldId,
          ids.importPortfolio,
          hash,
          Buffer.byteLength(replacementContent),
          replacementContent,
          JSON.stringify({ valid: 1, invalid: 0, total: 1 }),
          JSON.stringify(rows),
        ],
      ),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const state = await adminClient.query<{ status: string }>(
      'select status from public.transaction_imports where id=$1',
      [oldId],
    );
    expect(['confirmed', 'superseded']).toContain(state.rows[0]!.status);
    expect(
      (
        await adminClient.query(
          'select count(*)::integer count from public.transactions where portfolio_id=$1 and idempotency_key=$2',
          [ids.importPortfolio, rows[0]!.externalReference],
        )
      ).rows[0]!.count,
    ).toBeLessThanOrEqual(1);
  });

  it('allows only one of two concurrent supersession links', async () => {
    const oldId = (
      await createImport([
        {
          row: 2,
          date: '2026-08-08',
          type: 'deposit',
          amount: '1',
          fees: '0',
          taxes: '0',
          externalReference: randomUUID(),
        },
      ])
    ).rows[0]!.id;
    const replace = (suffix: string) => {
      const content = `replace-${suffix}-${randomUUID()}`;
      const hash = createHash('sha256').update(content).digest('hex');
      const rows = [
        {
          row: 2,
          date: '2026-08-08',
          type: 'deposit',
          amount: '1',
          fees: '0',
          taxes: '0',
          externalReference: randomUUID(),
        },
      ];
      return asUser(
        ids.userA,
        `select public.replace_transaction_import($1,$2,$3,$4,$5,'text/csv',$6,'{}',1,$7,$8)`,
        [
          oldId,
          ids.importPortfolio,
          `${suffix}.csv`,
          hash,
          Buffer.byteLength(content),
          content,
          JSON.stringify({ valid: 1, invalid: 0, total: 1 }),
          JSON.stringify(rows),
        ],
      );
    };
    const results = await Promise.allSettled([replace('a'), replace('b')]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(
      (
        await adminClient.query(
          'select count(*)::integer count from public.transaction_imports where supersedes_import_id=$1',
          [oldId],
        )
      ).rows[0]!.count,
    ).toBe(1);
  });

  it('serializes confirmation against cash-changing commands without negative cash', async () => {
    const importId = (
      await createImport([
        {
          row: 2,
          date: '2026-08-09',
          type: 'withdrawal',
          amount: '900',
          fees: '0',
          taxes: '0',
          externalReference: randomUUID(),
        },
      ])
    ).rows[0]!.id;
    await Promise.allSettled([
      asUser(ids.userA, 'select public.confirm_transaction_import($1)', [importId]),
      record(ids.userA, ids.importPortfolio, 'withdrawal', randomUUID(), '900'),
    ]);
    const cash = await adminClient.query<{ cash: string }>(
      'select coalesce(sum(amount),0)::text cash from private.cash_ledger_entries where portfolio_id=$1',
      [ids.importPortfolio],
    );
    expect(Number(cash.rows[0]!.cash)).toBeGreaterThanOrEqual(0);
    const status = await adminClient.query<{ status: string }>(
      'select status from public.transaction_imports where id=$1',
      [importId],
    );
    expect(['confirmed', 'failed']).toContain(status.rows[0]!.status);
  });

  it('serializes confirmation against holdings-changing commands without negative holdings', async () => {
    await record(ids.userA, ids.importPortfolio, 'buy', randomUUID(), null, securityId, '2', '1');
    const importId = (
      await createImport([
        {
          row: 2,
          date: '2026-08-10',
          type: 'sell',
          securityId,
          quantity: '2',
          unitPrice: '1',
          fees: '0',
          taxes: '0',
          externalReference: randomUUID(),
        },
      ])
    ).rows[0]!.id;
    await Promise.allSettled([
      asUser(ids.userA, 'select public.confirm_transaction_import($1)', [importId]),
      record(ids.userA, ids.importPortfolio, 'sell', randomUUID(), null, securityId, '2', '1'),
    ]);
    const holding = await adminClient.query<{ quantity: string }>(
      "select coalesce(sum(case transaction_type when 'buy' then quantity when 'sell' then -quantity else 0 end),0)::text quantity from public.transactions where portfolio_id=$1 and security_id=$2",
      [ids.importPortfolio, securityId],
    );
    expect(Number(holding.rows[0]!.quantity)).toBeGreaterThanOrEqual(0);
    const successful = await adminClient.query<{ transactions: string; outbox: string }>(
      `select count(*)::text transactions,(select count(*)::text from private.outbox where aggregate_id=$1 and payload->>'transactionId'=any(array_agg(t.id::text))) outbox from public.transactions t where portfolio_id=$1`,
      [ids.importPortfolio],
    );
    expect(Number(successful.rows[0]!.outbox)).toBeLessThanOrEqual(
      Number(successful.rows[0]!.transactions),
    );
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
    ).toEqual([ids.portfolioA, ids.importPortfolio, ids.reversalPortfolio].sort());
    expect((await asUser(ids.userB, 'select id from public.portfolios')).rows).toEqual([
      { id: ids.portfolioB },
    ]);
    expect((await asUser(ids.admin, 'select id from public.portfolios')).rowCount).toBe(0);
    expect(
      (await asDatabaseRole('service_role', 'select id from public.portfolios')).rowCount,
    ).toBe(4);
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

  async function reverse(
    userId: string | null,
    portfolioId: string,
    transactionId: string,
    key = randomUUID(),
    replacement: Record<string, unknown> | null = null,
  ) {
    return asUser<{
      result: {
        requestId: string;
        reversalTransactionId: string;
        replacementTransactionId: string | null;
        repeated: boolean;
      };
    }>(userId, 'select public.reverse_transaction($1,$2,$3,$4,$5) result', [
      portfolioId,
      transactionId,
      'Correction documentée',
      key,
      replacement,
    ]);
  }

  it.each([
    ['deposit', '100', null, null],
    ['withdrawal', '10', null, null],
    ['buy', null, '2', '20'],
    ['sell', null, '1', '25'],
    ['dividend', '8', null, null],
    ['fee', '2', null, null],
    ['tax', '1', null, null],
  ] as const)(
    'creates a server-derived immutable reversal for %s',
    async (type, amount, quantity, price) => {
      await record(ids.userA, ids.reversalPortfolio, 'deposit', randomUUID(), '1000');
      if (type === 'sell')
        await record(
          ids.userA,
          ids.reversalPortfolio,
          'buy',
          randomUUID(),
          null,
          securityId,
          '2',
          '20',
        );
      const original = await record(
        ids.userA,
        ids.reversalPortfolio,
        type,
        randomUUID(),
        amount,
        quantity ? securityId : null,
        quantity,
        price,
      );
      const originalId = original.rows[0]!.id;
      const before = await adminClient.query<{ effect: string }>(
        'select net_amount::text effect from public.transactions where id=$1',
        [originalId],
      );
      const result = await reverse(ids.userA, ids.reversalPortfolio, originalId);
      const persisted = await adminClient.query<{
        transaction_type: string;
        reverses_transaction_id: string;
        effect: string;
      }>(
        'select transaction_type,reverses_transaction_id,net_amount::text effect from public.transactions where id=$1',
        [result.rows[0]!.result.reversalTransactionId],
      );
      expect(persisted.rows[0]).toEqual({
        transaction_type: 'reversal',
        reverses_transaction_id: originalId,
        effect: (-Number(before.rows[0]!.effect)).toFixed(6),
      });
      await expect(reverse(ids.userA, ids.reversalPortfolio, originalId)).rejects.toThrow(
        /ALREADY_REVERSED/,
      );
      await expect(
        reverse(ids.userA, ids.reversalPortfolio, result.rows[0]!.result.reversalTransactionId),
      ).rejects.toThrow(/REVERSAL_OF_REVERSAL_PROHIBITED/);
    },
  );

  it('is idempotent and serializes concurrent reversal requests', async () => {
    const original = await record(
      ids.userA,
      ids.reversalPortfolio,
      'withdrawal',
      randomUUID(),
      '3',
    );
    const key = randomUUID();
    const [first, second] = await Promise.all([
      reverse(ids.userA, ids.reversalPortfolio, original.rows[0]!.id, key),
      reverse(ids.userA, ids.reversalPortfolio, original.rows[0]!.id, key),
    ]);
    expect(first.rows[0]!.result.reversalTransactionId).toBe(
      second.rows[0]!.result.reversalTransactionId,
    );
    const count = await adminClient.query<{ requests: string; reversals: string; outbox: string }>(
      `select
        (select count(*)::text from private.transaction_reversal_requests where original_transaction_id=$1) requests,
        (select count(*)::text from public.transactions where reverses_transaction_id=$1) reversals,
        (select count(*)::text from private.outbox where idempotency_key='reversal:'||$2) outbox`,
      [original.rows[0]!.id, key],
    );
    expect(count.rows[0]).toEqual({ requests: '1', reversals: '1', outbox: '1' });
  });

  it('atomically creates a valid replacement and rolls back an invalid replacement', async () => {
    const original = await record(ids.userA, ids.reversalPortfolio, 'fee', randomUUID(), '4');
    const result = await reverse(
      ids.userA,
      ids.reversalPortfolio,
      original.rows[0]!.id,
      randomUUID(),
      {
        type: 'fee',
        settlementDate: '2026-08-20',
        amount: '2',
      },
    );
    expect(result.rows[0]!.result.replacementTransactionId).toBeTruthy();

    const invalidOriginal = await record(
      ids.userA,
      ids.reversalPortfolio,
      'tax',
      randomUUID(),
      '1',
    );
    const before = await adminClient.query<{
      transactions: string;
      requests: string;
      outbox: string;
    }>(
      `select
        (select count(*)::text from public.transactions where portfolio_id=$1) transactions,
        (select count(*)::text from private.transaction_reversal_requests where portfolio_id=$1) requests,
        (select count(*)::text from private.outbox where aggregate_id=$1) outbox`,
      [ids.reversalPortfolio],
    );
    await expect(
      reverse(ids.userA, ids.reversalPortfolio, invalidOriginal.rows[0]!.id, randomUUID(), {
        type: 'withdrawal',
        settlementDate: '2026-08-20',
        amount: '999999',
      }),
    ).rejects.toThrow(/REVERSAL_INSUFFICIENT_CASH/);
    const after = await adminClient.query<{
      transactions: string;
      requests: string;
      outbox: string;
    }>(
      `select
        (select count(*)::text from public.transactions where portfolio_id=$1) transactions,
        (select count(*)::text from private.transaction_reversal_requests where portfolio_id=$1) requests,
        (select count(*)::text from private.outbox where aggregate_id=$1) outbox`,
      [ids.reversalPortfolio],
    );
    expect(after.rows[0]).toEqual(before.rows[0]);
  });

  it('rejects anonymous, cross-user, forged-portfolio and direct private-table access', async () => {
    const original = await record(ids.userA, ids.reversalPortfolio, 'deposit', randomUUID(), '5');
    await expect(reverse(null, ids.reversalPortfolio, original.rows[0]!.id)).rejects.toThrow(
      /permission denied/,
    );
    await expect(reverse(ids.userB, ids.reversalPortfolio, original.rows[0]!.id)).rejects.toThrow(
      /FORBIDDEN_PORTFOLIO/,
    );
    await expect(reverse(ids.userA, ids.portfolioB, original.rows[0]!.id)).rejects.toThrow(
      /FORBIDDEN_PORTFOLIO/,
    );
    await expect(
      asUser(ids.userA, 'select * from private.transaction_reversal_requests'),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(
        ids.userA,
        `insert into private.transaction_reversal_requests(
          portfolio_id,original_transaction_id,reversal_transaction_id,actor_id,reason,status,
          idempotency_reference,earliest_accounting_date,outbox_id,completed_at)
         values($1,$2,$2,$3,'forged reason','completed',$4,current_date,$2,now())`,
        [ids.reversalPortfolio, original.rows[0]!.id, ids.userA, randomUUID()],
      ),
    ).rejects.toThrow(/permission denied/);
  });

  describe.sequential('fundamentals import and read model', () => {
    // A dedicated admin identity, not ids.admin: market.fundamentals_import_runs is append-only
    // (private.prevent_mutation(), same guard as market.ingestion_runs) and created_by has no
    // cascade, so once it references an actor that actor's profile can never be deleted again --
    // scoping it to a throwaway identity keeps the outer suite's auth.users cleanup unaffected.
    const fundamentalsAdmin = randomUUID();

    beforeAll(async () => {
      await adminClient.query(
        `insert into auth.users(id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
         values($1::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $1::text || '@example.test', '', '{}', '{}', now(), now())`,
        [fundamentalsAdmin],
      );
      await adminClient.query("insert into public.user_roles(user_id,role) values($1,'data_admin')", [
        fundamentalsAdmin,
      ]);
    });

    afterAll(async () => {
      await adminClient.query('delete from market.fundamentals where security_id=$1', [securityId]);
    });

    function fundamentalsRow(overrides: Record<string, unknown> = {}) {
      return {
        securityId,
        periodType: 'annual',
        interimPeriod: null,
        fiscalYear: 2024,
        periodEndDate: '2024-12-31',
        publicationDate: '2025-02-15',
        currency: 'MAD',
        revenue: '1000',
        ebitda: '300',
        ebit: '250',
        netIncome: '150',
        eps: '1.5',
        cash: '400',
        totalDebt: '200',
        totalAssets: '2000',
        totalEquity: '900',
        operatingCashFlow: '350',
        capex: '80',
        sharesOutstanding: '1000000',
        dividendPerShare: '0.5',
        ...overrides,
      };
    }

    async function applyImport(rows: Record<string, unknown>[], userId = fundamentalsAdmin) {
      return asUser<{
        result: {
          insertedCount: number;
          updatedCount: number;
          noopCount: number;
          importRunId: string;
        };
      }>(userId, 'select public.apply_fundamentals_import($1,$2,$3,$4) result', [
        `hash-${randomUUID()}`,
        'sample.csv',
        JSON.stringify(rows),
        JSON.stringify({}),
      ]);
    }

    it('upserts idempotently and reports exact insert/update/no-op counts', async () => {
      const row = fundamentalsRow();
      const first = await applyImport([row]);
      expect(first.rows[0]!.result).toMatchObject({
        insertedCount: 1,
        updatedCount: 0,
        noopCount: 0,
      });

      const again = await applyImport([row]);
      expect(again.rows[0]!.result).toMatchObject({
        insertedCount: 0,
        updatedCount: 0,
        noopCount: 1,
      });

      const changed = await applyImport([fundamentalsRow({ revenue: '1100' })]);
      expect(changed.rows[0]!.result).toMatchObject({
        insertedCount: 0,
        updatedCount: 1,
        noopCount: 0,
      });

      const count = await adminClient.query<{ count: string }>(
        'select count(*)::text count from market.fundamentals where security_id=$1 and period_end_date=$2',
        [securityId, '2024-12-31'],
      );
      expect(count.rows[0]!.count).toBe('1');
    });

    it('rejects an unknown security via foreign key violation', async () => {
      await expect(
        applyImport([
          fundamentalsRow({
            securityId: randomUUID(),
            periodEndDate: '2020-01-01',
            publicationDate: '2020-06-01',
          }),
        ]),
      ).rejects.toThrow(/foreign key/i);
    });

    it('rejects an interim row missing interim_period and an annual row carrying one', async () => {
      await expect(
        applyImport([
          fundamentalsRow({
            periodType: 'interim',
            interimPeriod: null,
            periodEndDate: '2024-06-30',
            publicationDate: '2024-08-01',
          }),
        ]),
      ).rejects.toThrow(/violates check constraint/i);
      await expect(
        applyImport([
          fundamentalsRow({
            periodType: 'annual',
            interimPeriod: 'H1',
            periodEndDate: '2021-12-31',
            publicationDate: '2022-02-01',
          }),
        ]),
      ).rejects.toThrow(/violates check constraint/i);
    });

    it('rejects a publication_date earlier than period_end_date', async () => {
      await expect(
        applyImport([
          fundamentalsRow({ periodEndDate: '2022-12-31', publicationDate: '2022-01-01' }),
        ]),
      ).rejects.toThrow(/violates check constraint/i);
    });

    it('denies import to a non-admin investor and returns no rows from the admin-only period lookup', async () => {
      await expect(
        applyImport(
          [fundamentalsRow({ periodEndDate: '2019-12-31', publicationDate: '2020-02-01' })],
          ids.userA,
        ),
      ).rejects.toThrow(/FORBIDDEN/);
      const listResult = await asUser<{ security_id: string }>(
        ids.userA,
        'select * from public.list_fundamentals_periods($1::uuid[])',
        [[securityId]],
      );
      expect(listResult.rows).toEqual([]);
    });

    it('exposes fundamentals to anon/authenticated only through the public view, not the raw table', async () => {
      await applyImport([
        fundamentalsRow({ periodEndDate: '2030-12-31', publicationDate: '2031-01-01' }),
      ]);
      const anonView = await asUser<{ security_id: string }>(
        null,
        'select security_id from public.security_fundamentals where security_id=$1 and period_end_date=$2',
        [securityId, '2030-12-31'],
      );
      expect(anonView.rows.length).toBe(1);
      await expect(asUser(null, 'select 1 from market.fundamentals limit 1')).rejects.toThrow(
        /permission denied/,
      );
      await expect(asUser(ids.userA, 'select 1 from market.fundamentals limit 1')).rejects.toThrow(
        /permission denied/,
      );
    });
  });
});
