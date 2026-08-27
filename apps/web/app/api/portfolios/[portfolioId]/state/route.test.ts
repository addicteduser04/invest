import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  user: null as null | { id: string },
  ownsPortfolio: true,
  rows: [] as Record<string, unknown>[],
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    from: (table: string) => ({
      select: () => ({
        eq: () =>
          table === 'portfolios'
            ? {
                maybeSingle: async () => ({
                  data: state.ownsPortfolio ? { id: 'portfolio' } : null,
                }),
              }
            : Promise.resolve({ data: state.rows, error: null }),
      }),
    }),
  }),
}));
import { GET } from './route';

const portfolioId = '00000000-0000-4000-8000-000000000001';
const params = Promise.resolve({ portfolioId });

describe('portfolio state API boundary', () => {
  beforeEach(() => {
    state.user = null;
    state.ownsPortfolio = true;
    state.rows = [];
  });

  it('rejects anonymous and cross-owner reads', async () => {
    expect((await GET(new Request('http://localhost/state'), { params })).status).toBe(401);
    state.user = { id: 'user' };
    state.ownsPortfolio = false;
    expect((await GET(new Request('http://localhost/state'), { params })).status).toBe(403);
  });

  it('returns exact decimal strings at a historical cutoff', async () => {
    state.user = { id: 'user' };
    state.rows = [
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
        created_at: '2026-01-01T00:00:00.000Z',
        effective_at: '2026-01-01T00:00:00.000Z',
        ledger_sequence: '1',
      },
    ];
    const response = await GET(
      new Request('http://localhost/state?as_of=2026-01-02T00:00:00.000Z'),
      { params },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      portfolioId,
      cash: '0.3',
      realizedGain: '0',
      transactionCount: 1,
      source: 'replay',
      ruleVersion: 'average-cost-v1',
    });
  });

  it('rejects malformed as_of values with localized errors', async () => {
    state.user = { id: 'user' };
    const response = await GET(new Request('http://localhost/state?as_of=nope&locale=ar'), {
      params,
    });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: 'INVALID_DATE' });
  });
});
