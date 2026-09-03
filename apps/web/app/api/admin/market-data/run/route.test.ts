import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeSupabase, type FakeSupabaseConfig } from '@/test/fake-supabase';

const state = vi.hoisted(() => ({
  config: { user: null, role: null } as FakeSupabaseConfig,
  runDailyIngestion: vi.fn(async (_options: Record<string, unknown>) => ({
    runId: 'run-1',
    providerId: 'bvc_public_testing',
    marketDate: '2026-08-28',
    status: 'succeeded',
    triggerSource: 'manual',
    dryRun: false,
    startedAt: '2026-08-28T18:00:00.000Z',
    finishedAt: '2026-08-28T18:01:00.000Z',
    metrics: {},
    instrumentFailures: [],
  })),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => createFakeSupabase(state.config),
}));

vi.mock('@bvc/market-ingestion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@bvc/market-ingestion')>();
  return {
    ...actual,
    PgIngestionStore: vi.fn().mockImplementation(() => ({ close: vi.fn() })),
    runDailyIngestion: (...args: unknown[]) =>
      state.runDailyIngestion(...(args as [Record<string, unknown>])),
  };
});

import { POST } from './route';

const USER = { id: '00000000-0000-4000-8000-000000000010' };

function req(body: unknown) {
  return new Request('http://localhost/api/admin/market-data/run', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describe('POST /api/admin/market-data/run', () => {
  beforeEach(() => {
    state.config = { user: null, role: null };
    state.runDailyIngestion.mockClear();
    process.env['MARKET_INGESTION_PROVIDER'] = 'bvc_public_testing';
    process.env['BVC_PUBLIC_TESTING_ENABLED'] = 'true';
    process.env['WORKER_DATABASE_URL'] = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
  });

  it('denies an unauthenticated caller', async () => {
    const response = await POST(req({ date: '2026-08-28' }));
    expect(response.status).toBe(401);
  });

  it('denies an investor', async () => {
    state.config = { user: USER, role: 'investor' };
    const response = await POST(req({ date: '2026-08-28' }));
    expect(response.status).toBe(403);
  });

  it('validates the date field', async () => {
    state.config = { user: USER, role: 'data_admin' };
    const response = await POST(req({ date: 'not-a-date' }));
    expect(response.status).toBe(400);
    expect(state.runDailyIngestion).not.toHaveBeenCalled();
  });

  it('validates tickers', async () => {
    state.config = { user: USER, role: 'data_admin' };
    const response = await POST(req({ date: '2026-08-28', tickers: ['??invalid??'] }));
    expect(response.status).toBe(400);
  });

  it('validates concurrency bounds', async () => {
    state.config = { user: USER, role: 'data_admin' };
    const response = await POST(req({ date: '2026-08-28', concurrency: 99 }));
    expect(response.status).toBe(400);
  });

  it('triggers a run for a data_admin with a valid body', async () => {
    state.config = { user: USER, role: 'data_admin' };
    const response = await POST(req({ date: '2026-08-28', tickers: ['IAM', 'ATW'], dryRun: true }));
    expect(response.status).toBe(200);
    expect(state.runDailyIngestion).toHaveBeenCalledTimes(1);
    const [options] = state.runDailyIngestion.mock.calls[0]!;
    expect(options).toMatchObject({
      providerId: 'bvc_public_testing',
      marketDate: '2026-08-28',
      tickers: ['IAM', 'ATW'],
      dryRun: true,
      triggerSource: 'manual',
    });
  });

  it('never lets the client choose the provider, and never leaks WORKER_DATABASE_URL', async () => {
    state.config = { user: USER, role: 'data_admin' };
    const response = await POST(req({ date: '2026-08-28', provider: 'licensed_api' }));
    const body = await response.json();
    const [options] = state.runDailyIngestion.mock.calls[0]!;
    expect(options).toMatchObject({ providerId: 'bvc_public_testing' }); // ignored the client-supplied value
    expect(JSON.stringify(body)).not.toMatch(/postgres(ql)?:\/\//);
  });

  it('refuses to run in production against bvc_public_testing', async () => {
    state.config = { user: USER, role: 'data_admin' };
    vi.stubEnv('NODE_ENV', 'production');
    const response = await POST(req({ date: '2026-08-28' }));
    vi.unstubAllEnvs();
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error).toMatch(/PRODUCTION_REFUSES_BVC_PUBLIC_TESTING/);
  });
});
