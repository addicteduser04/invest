import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  marketDataRpc: null as unknown,
  dbError: false,
}));

// The health route awaits `.from().select()` directly, so `select` resolves immediately.
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: () => ({
      select: async () => (state.dbError ? { error: new Error('down') } : { error: null }),
    }),
    rpc: async (name: string) => {
      if (name === 'get_market_data_health_summary')
        return { data: state.marketDataRpc, error: null };
      return { data: null, error: null };
    },
  }),
}));

import { GET } from './route';

describe('GET /api/health', () => {
  it('reports degraded when the database is unreachable, without a marketData block', async () => {
    state.dbError = true;
    state.marketDataRpc = null;
    const response = await GET();
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.status).toBe('degraded');
    expect(body.marketData).toBeUndefined();
  });

  it('includes a minimal marketData block with no secrets when healthy', async () => {
    state.dbError = false;
    state.marketDataRpc = {
      latestEquityDate: '2026-08-28',
      latestIndexDate: '2026-08-28',
      lastRunStatus: 'succeeded',
      lastRunAt: '2026-08-28T18:01:00.000Z',
      failedInstruments: 0,
    };
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.marketData).toMatchObject({
      lastRunStatus: 'succeeded',
      latestEquityDate: '2026-08-28',
      failedInstruments: 0,
    });
    expect(body.marketData.stale).toEqual({
      equity: expect.any(Boolean),
      index: expect.any(Boolean),
    });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toMatch(/postgres(ql)?:\/\//);
    expect(serialized).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY|sb_secret_/);
  });

  it('treats no prior runs as a distinct state, not a crash', async () => {
    state.dbError = false;
    state.marketDataRpc = {
      latestEquityDate: null,
      latestIndexDate: null,
      lastRunStatus: null,
      lastRunAt: null,
      failedInstruments: null,
    };
    const response = await GET();
    const body = await response.json();
    expect(body.marketData.status).toBe('no_previous_runs');
  });
});
