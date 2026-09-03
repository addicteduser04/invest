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

describe('GET /api/admin/market-data', () => {
  beforeEach(() => {
    state.config = { user: null, role: null };
    delete process.env['MARKET_INGESTION_PROVIDER'];
  });

  it('denies an unauthenticated caller', async () => {
    const response = await GET();
    expect(response.status).toBe(401);
  });

  it('denies an authenticated investor (not data_admin)', async () => {
    state.config = { user: USER, role: 'investor' };
    const response = await GET();
    expect(response.status).toBe(403);
  });

  it('returns the snapshot, recent runs, and provider for a data_admin', async () => {
    state.config = {
      user: USER,
      role: 'data_admin',
      rpc: {
        get_market_data_operational_snapshot: { data: { latestEquityDate: '2026-08-28' } },
        list_market_ingestion_runs: { data: [{ id: 'run-1', status: 'succeeded' }] },
      },
    };
    process.env['MARKET_INGESTION_PROVIDER'] = 'bvc_public_testing';
    process.env['BVC_PUBLIC_TESTING_ENABLED'] = 'true';
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.snapshot.latestEquityDate).toBe('2026-08-28');
    expect(body.runs).toHaveLength(1);
    expect(body.provider.id).toBe('bvc_public_testing');
  });

  it('reports a provider resolution error without leaking secrets', async () => {
    state.config = {
      user: USER,
      role: 'data_admin',
      rpc: {
        get_market_data_operational_snapshot: { data: {} },
        list_market_ingestion_runs: { data: [] },
      },
    };
    // No MARKET_INGESTION_PROVIDER configured.
    const response = await GET();
    const body = await response.json();
    expect(body.provider.id).toBeNull();
    expect(body.provider.error).toMatch(/MARKET_INGESTION_PROVIDER/);
    expect(JSON.stringify(body)).not.toMatch(/postgres(ql)?:\/\//);
  });

  it('surfaces an RPC error as 422', async () => {
    state.config = {
      user: USER,
      role: 'data_admin',
      rpc: {
        get_market_data_operational_snapshot: { data: null, error: { message: 'boom' } },
      },
    };
    const response = await GET();
    expect(response.status).toBe(422);
  });
});
