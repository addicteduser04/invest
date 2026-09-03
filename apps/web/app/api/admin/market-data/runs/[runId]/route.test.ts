import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeSupabase, type FakeSupabaseConfig } from '@/test/fake-supabase';

const state = vi.hoisted(() => ({
  config: { user: null, role: null } as FakeSupabaseConfig,
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => createFakeSupabase(state.config),
}));

import { GET } from './route';

const USER = { id: '00000000-0000-4000-8000-000000000010' };
const params = Promise.resolve({ runId: 'run-1' });

describe('GET /api/admin/market-data/runs/[runId]', () => {
  beforeEach(() => {
    state.config = { user: null, role: null };
  });

  it('denies an unauthenticated caller', async () => {
    const response = await GET(new Request('http://localhost'), { params });
    expect(response.status).toBe(401);
  });

  it('denies an investor', async () => {
    state.config = { user: USER, role: 'investor' };
    const response = await GET(new Request('http://localhost'), { params });
    expect(response.status).toBe(403);
  });

  it('returns the run for a data_admin', async () => {
    state.config = {
      user: USER,
      role: 'data_admin',
      rpc: { get_market_ingestion_run: { data: [{ id: 'run-1', status: 'partial' }] } },
    };
    const response = await GET(new Request('http://localhost'), { params });
    expect(response.status).toBe(200);
    expect((await response.json()).run.id).toBe('run-1');
  });

  it('returns 404 when the run does not exist', async () => {
    state.config = {
      user: USER,
      role: 'data_admin',
      rpc: { get_market_ingestion_run: { data: [] } },
    };
    const response = await GET(new Request('http://localhost'), { params });
    expect(response.status).toBe(404);
  });
});
