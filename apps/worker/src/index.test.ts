import { describe, expect, it, vi } from 'vitest';
import type { PoolClient, QueryResult } from 'pg';
import { processNextRecalculation } from './index';

const result = <T extends Record<string, unknown>>(rows: T[]) =>
  ({ rows, rowCount: rows.length }) as QueryResult<T>;

describe('portfolio recalculation worker', () => {
  it('claims, replays, and commits one exact state boundary', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce(
        result([
          {
            claimed_run_id: 'run',
            claimed_portfolio_id: '00000000-0000-4000-8000-000000000001',
            claimed_boundary_sequence: '1',
          },
        ]),
      )
      .mockResolvedValueOnce(
        result([
          {
            id: '00000000-0000-4000-8000-000000000010',
            transaction_type: 'deposit',
            settlement_date: '2026-01-01',
            security_id: null,
            quantity: null,
            unit_price: null,
            gross_amount: '0.3',
            fees: '0',
            taxes: '0',
            reverses_transaction_id: null,
            recorded_at: '2026-01-01T00:00:00Z',
            effective_at: '2026-01-01T00:00:00Z',
            ledger_sequence: '1',
          },
        ]),
      )
      .mockResolvedValueOnce(result([]));
    expect(await processNextRecalculation({ query } as unknown as PoolClient, 'worker')).toBe(true);
    const committed = JSON.parse(query.mock.calls[2]![1]![1] as string);
    expect(committed).toMatchObject({ cash: '0.3', realizedGain: '0', transactionCount: 1 });
  });

  it('does nothing when no job is claimable', async () => {
    const query = vi.fn().mockResolvedValue(result([]));
    expect(await processNextRecalculation({ query } as unknown as PoolClient, 'worker')).toBe(
      false,
    );
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('marks failed replay work retryable without committing a snapshot', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce(
        result([
          {
            claimed_run_id: 'run',
            claimed_portfolio_id: '00000000-0000-4000-8000-000000000001',
            claimed_boundary_sequence: '1',
          },
        ]),
      )
      .mockResolvedValueOnce(
        result([
          {
            id: 'bad',
            transaction_type: 'withdrawal',
            settlement_date: '2026-01-01',
            security_id: null,
            quantity: null,
            unit_price: null,
            gross_amount: '1',
            fees: '0',
            taxes: '0',
            reverses_transaction_id: null,
            recorded_at: '2026-01-01T00:00:00Z',
            effective_at: '2026-01-01T00:00:00Z',
            ledger_sequence: '1',
          },
        ]),
      )
      .mockResolvedValueOnce(result([]));
    await expect(
      processNextRecalculation({ query } as unknown as PoolClient, 'worker'),
    ).rejects.toThrow('Negative cash');
    expect(query.mock.calls[2]![0]).toContain('fail_portfolio_recalculation');
  });
});
