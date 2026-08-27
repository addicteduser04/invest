import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { processNextRecalculation } from '../../apps/worker/src/index';

const enabled = process.env['LIVE_DATABASE_TESTS'] === '1';
const databaseUrl = process.env['TEST_DATABASE_URL'];
const live = enabled ? describe : describe.skip;
if (enabled && !databaseUrl) throw new Error('TEST_DATABASE_URL is required');

const ids = { owner: randomUUID(), other: randomUUID(), portfolio: randomUUID() };

live.sequential('live deterministic portfolio state and snapshots', () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 5 });
  let admin: PoolClient;
  let securityId: string;

  const asUser = async (userId: string | null, sql: string, values: unknown[] = []) => {
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(`set local role ${userId ? 'authenticated' : 'anon'}`);
      await client.query("select set_config('request.jwt.claim.sub',$1,true)", [userId ?? '']);
      const result = await client.query(sql, values);
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  };

  const record = (
    type: string,
    date: string,
    amount: string | null,
    quantity: string | null = null,
    price: string | null = null,
    fees = '0',
    taxes = '0',
  ) =>
    asUser(ids.owner, 'select public.record_transaction($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [
      ids.portfolio,
      type,
      date,
      randomUUID(),
      amount,
      quantity ? securityId : null,
      quantity,
      price,
      fees,
      taxes,
    ]);

  beforeAll(async () => {
    admin = await pool.connect();
    await admin.query(
      `insert into auth.users(id,instance_id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
       values($1::uuid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',($1::uuid)::text||'@test','', '{}','{}',now(),now()),
             ($2::uuid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',($2::uuid)::text||'@test','', '{}','{}',now(),now())`,
      [ids.owner, ids.other],
    );
    await admin.query("insert into public.portfolios(id,owner_id,name) values($1,$2,'State')", [
      ids.portfolio,
      ids.owner,
    ]);
    const security = await admin.query<{ id: string }>(
      "select id from market.securities where ticker='SYN-IAM'",
    );
    securityId = security.rows[0]!.id;
    await record('deposit', '2026-01-01', '2000');
    await record('buy', '2026-01-02', null, '10', '50', '5', '5');
    await record('buy', '2026-01-03', null, '10', '70');
    await record('sell', '2026-01-04', null, '5', '80', '4', '1');
    await record('dividend', '2026-01-05', '30', null, null, '0', '3');
    await record('fee', '2026-01-05', '2');
    await record('tax', '2026-01-05', '1');
    await record('withdrawal', '2026-01-06', '9');
  });

  afterAll(async () => {
    if (admin) {
      await admin.query(
        'delete from analytics.portfolio_state_positions where snapshot_id in (select id from analytics.portfolio_state_snapshots where portfolio_id=$1)',
        [ids.portfolio],
      );
      await admin.query('delete from analytics.portfolio_state_snapshots where portfolio_id=$1', [
        ids.portfolio,
      ]);
      await admin.query('delete from private.portfolio_recalculation_runs where portfolio_id=$1', [
        ids.portfolio,
      ]);
      await admin.query('delete from private.outbox where aggregate_id=$1', [ids.portfolio]);
      await admin.query('delete from private.cash_ledger_entries where portfolio_id=$1', [
        ids.portfolio,
      ]);
      await admin.query('delete from public.transactions where portfolio_id=$1', [ids.portfolio]);
      await admin.query('delete from public.portfolios where id=$1', [ids.portfolio]);
      await admin.query('delete from auth.users where id=any($1::uuid[])', [
        [ids.owner, ids.other],
      ]);
      admin.release();
    }
    await pool.end();
  });

  it('rebuilds exact average-cost state and normalized positions', async () => {
    expect(await processNextRecalculation(admin, 'live-worker')).toBe(true);
    const snapshot = await admin.query(
      `select cash_balance::text,realized_gain::text,transaction_count,boundary_sequence,status
       from analytics.portfolio_state_snapshots where portfolio_id=$1 and status='current'`,
      [ids.portfolio],
    );
    expect(snapshot.rows[0]).toMatchObject({
      cash_balance: '1200.0000000000',
      realized_gain: '92.5000000000',
      transaction_count: 8,
      status: 'current',
    });
    const position = await admin.query(
      `select quantity::text,average_cost::text,cost_basis::text,realized_gain::text
       from analytics.portfolio_state_positions where snapshot_id=(select id from analytics.portfolio_state_snapshots where portfolio_id=$1 and status='current')`,
      [ids.portfolio],
    );
    expect(position.rows[0]).toEqual({
      quantity: '15.0000000000',
      average_cost: '60.5000000000',
      cost_basis: '907.5000000000',
      realized_gain: '92.5000000000',
    });
  });

  it('allows only the owner to read and denies all direct derived-state mutation', async () => {
    expect(
      (
        await asUser(
          ids.owner,
          'select count(*)::integer count from analytics.portfolio_state_snapshots where portfolio_id=$1',
          [ids.portfolio],
        )
      ).rows[0].count,
    ).toBe(1);
    expect(
      (
        await asUser(
          ids.other,
          'select count(*)::integer count from analytics.portfolio_state_snapshots where portfolio_id=$1',
          [ids.portfolio],
        )
      ).rows[0].count,
    ).toBe(0);
    await expect(
      asUser(
        ids.owner,
        `insert into analytics.portfolio_state_snapshots(portfolio_id,recalculation_run_id,as_of,earliest_rebuilt_date,boundary_sequence,transaction_count,cash_balance,realized_gain,rule_version,status) values($1,gen_random_uuid(),now(),current_date,0,0,0,0,'forged','current')`,
        [ids.portfolio],
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(asUser(null, 'select * from analytics.portfolio_state_snapshots')).rejects.toThrow(
      /permission denied/,
    );
  });

  it('rolls back an invalid generation without disturbing the prior current snapshot', async () => {
    await admin.query(
      'update private.outbox set processed_at=now() where aggregate_id=$1 and processed_at is null',
      [ids.portfolio],
    );
    await record('deposit', '2026-01-07', '1');
    const claim = await admin.query<{ claimed_run_id: string }>(
      'select claimed_run_id from private.claim_portfolio_recalculation($1)',
      ['rollback-worker'],
    );
    await expect(
      admin.query(
        "select private.commit_portfolio_recalculation($1,'{\"positions\":null}'::jsonb,'average-cost-v1')",
        [claim.rows[0]!.claimed_run_id],
      ),
    ).rejects.toThrow(/INVALID_PORTFOLIO_STATE/);
    const current = await admin.query(
      'select count(*)::integer count from analytics.portfolio_state_snapshots where portfolio_id=$1 and status=$2',
      [ids.portfolio, 'current'],
    );
    expect(current.rows[0].count).toBe(1);
    await admin.query('select private.fail_portfolio_recalculation($1,$2)', [
      claim.rows[0]!.claimed_run_id,
      'DELIBERATE_FAILURE',
    ]);
  });

  it('serializes duplicate claims and lets a newer boundary supersede stale state', async () => {
    await admin.query(
      'update private.outbox set processed_at=now(),locked_at=null,locked_by=null where aggregate_id=$1',
      [ids.portfolio],
    );
    await record('deposit', '2026-01-08', '1');
    const first = await pool.connect();
    const second = await pool.connect();
    try {
      const [a, b] = await Promise.all([
        first.query('select * from private.claim_portfolio_recalculation($1)', ['worker-a']),
        second.query('select * from private.claim_portfolio_recalculation($1)', ['worker-b']),
      ]);
      expect(a.rowCount! + b.rowCount!).toBe(1);
      const claimed = (a.rows[0] ?? b.rows[0]) as { claimed_run_id: string };
      await admin.query('select private.fail_portfolio_recalculation($1,$2)', [
        claimed.claimed_run_id,
        'CONCURRENCY_TEST',
      ]);
    } finally {
      first.release();
      second.release();
    }
  });
});
