import { randomUUID } from 'node:crypto';
import { calculateLedger, type Transaction } from '@bvc/portfolio-engine';
import { Pool, type PoolClient } from 'pg';
import { z } from 'zod';

const environmentSchema = z.object({
  WORKER_DATABASE_URL: z.string().url(),
  INTERNAL_JOB_SIGNING_SECRET: z.string().min(32),
  MARKET_DATA_PROVIDER: z
    .enum(['synthetic', 'admin_csv', 'licensed_api', 'licensed_sftp'])
    .default('synthetic'),
});
export const readWorkerEnvironment = (environment: NodeJS.ProcessEnv) =>
  environmentSchema.parse(environment);

interface ClaimedRun {
  claimed_run_id: string;
  claimed_portfolio_id: string;
  claimed_boundary_sequence: string;
}

interface TransactionRow {
  id: string;
  transaction_type: Transaction['type'];
  settlement_date: string;
  security_id: string | null;
  quantity: string | null;
  unit_price: string | null;
  gross_amount: string | null;
  fees: string;
  taxes: string;
  reverses_transaction_id: string | null;
  recorded_at: string;
  effective_at: string;
  ledger_sequence: string;
}

const mapTransaction = (row: TransactionRow): Transaction => ({
  id: row.id,
  type: row.transaction_type,
  settlementDate: row.settlement_date,
  ...(row.security_id ? { securityId: row.security_id } : {}),
  ...(row.quantity ? { quantity: row.quantity } : {}),
  ...(row.unit_price ? { unitPrice: row.unit_price } : {}),
  ...(row.gross_amount ? { amount: row.gross_amount } : {}),
  fees: row.fees,
  taxes: row.taxes,
  ...(row.reverses_transaction_id ? { reversesTransactionId: row.reverses_transaction_id } : {}),
  recordedAt: row.recorded_at,
  effectiveAt: row.effective_at,
  ledgerSequence: row.ledger_sequence,
});

export async function processNextRecalculation(client: PoolClient, workerId: string) {
  const claim = await client.query<ClaimedRun>(
    'select * from private.claim_portfolio_recalculation($1)',
    [workerId],
  );
  const run = claim.rows[0];
  if (!run) return false;
  try {
    const result = await client.query<TransactionRow>(
      `select t.id,t.transaction_type,t.settlement_date::text,t.security_id,t.quantity::text,
        t.unit_price::text,t.gross_amount::text,t.fees::text,t.taxes::text,t.reverses_transaction_id,
        t.created_at::text recorded_at,t.ledger_sequence::text,
        (case when t.transaction_type='reversal' or rr.replacement_transaction_id=t.id
          then greatest(t.created_at,t.settlement_date::timestamptz)
          else t.settlement_date::timestamptz end)::text effective_at
       from public.transactions t
       left join private.transaction_reversal_requests rr
         on rr.reversal_transaction_id=t.id or rr.replacement_transaction_id=t.id
       where t.portfolio_id=$1 and t.ledger_sequence<=$2
       order by effective_at,t.ledger_sequence`,
      [run.claimed_portfolio_id, run.claimed_boundary_sequence],
    );
    const state = calculateLedger(result.rows.map(mapTransaction));
    await client.query('select private.commit_portfolio_recalculation($1,$2::jsonb,$3)', [
      run.claimed_run_id,
      JSON.stringify(state),
      'average-cost-v1',
    ]);
    return true;
  } catch (error) {
    await client.query('select private.fail_portfolio_recalculation($1,$2)', [
      run.claimed_run_id,
      error instanceof Error ? error.message : 'INTERNAL_FAILURE',
    ]);
    throw error;
  }
}

if (process.env['NODE_ENV'] !== 'test') {
  const configuration = readWorkerEnvironment(process.env);
  const pool = new Pool({ connectionString: configuration.WORKER_DATABASE_URL, max: 4 });
  const workerId = `portfolio-state-${randomUUID()}`;
  console.log(JSON.stringify({ level: 'info', event: 'worker.ready', workerId }));
  const poll = async () => {
    const client = await pool.connect();
    try {
      while (await processNextRecalculation(client, workerId)) {
        // Drain available work before returning to the polling interval.
      }
    } catch (error) {
      console.error(
        JSON.stringify({
          level: 'error',
          event: 'portfolio.recalculation.failed',
          message: error instanceof Error ? error.message : 'unknown',
        }),
      );
    } finally {
      client.release();
    }
  };
  void poll();
  setInterval(() => void poll(), 5_000).unref();
}
