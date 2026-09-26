import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeSupabase, type FakeSupabaseConfig } from '@/test/fake-supabase';

const state = vi.hoisted(() => ({
  config: { user: null, role: null } as FakeSupabaseConfig,
  runDailyIngestion: vi.fn(),
  fetch: vi.fn<typeof fetch>(async () => new Response(null, { status: 204 })),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => createFakeSupabase(state.config),
}));

// requireDataAdmin's rate limit goes over a direct pg connection (apps/web/lib/rate-limit.ts),
// not through the fake Supabase client -- stubbed so these tests never make a real network call.
vi.mock('pg', () => ({
  Pool: vi.fn().mockImplementation(() => ({
    query: async () => ({ rows: [{ check_rate_limit: { allowed: true, count: 1, limit: 1 } }] }),
  })),
}));

// The route must never execute ingestion in-process; this spy proves it.
vi.mock('@bvc/market-ingestion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@bvc/market-ingestion')>();
  return { ...actual, runDailyIngestion: state.runDailyIngestion };
});

import { POST } from './route';

const USER = { id: '00000000-0000-4000-8000-000000000010' };

function req(body: unknown) {
  return new Request('http://localhost/api/admin/market-data/run', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

function dispatchedBody() {
  const [url, init] = state.fetch.mock.calls[0]!;
  return { url, init: init!, body: JSON.parse(String(init!.body)) };
}

describe('POST /api/admin/market-data/run', () => {
  beforeEach(() => {
    state.config = { user: null, role: null };
    state.runDailyIngestion.mockClear();
    state.fetch.mockClear();
    state.fetch.mockImplementation(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', state.fetch);
    process.env['MARKET_INGESTION_PROVIDER'] = 'bvc_public_testing';
    process.env['BVC_PUBLIC_TESTING_ENABLED'] = 'true';
    process.env['WORKER_DATABASE_URL'] = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
    process.env['MARKET_INGESTION_DISPATCH_TOKEN'] = 'test-token';
    process.env['MARKET_INGESTION_DISPATCH_REPOSITORY'] = 'owner/invest';
    process.env['MARKET_INGESTION_DISPATCH_ENVIRONMENT'] = 'staging';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('denies an unauthenticated caller', async () => {
    const response = await POST(req({ date: '2026-08-28' }));
    expect(response.status).toBe(401);
    expect(state.fetch).not.toHaveBeenCalled();
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
    expect(state.fetch).not.toHaveBeenCalled();
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

  it('dispatches the run to the GitHub Actions executor and never runs it in-process', async () => {
    state.config = { user: USER, role: 'data_admin' };
    const response = await POST(
      req({ date: '2026-08-28', tickers: ['iam', 'ATW'], concurrency: 3 }),
    );

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      dispatched: true,
      marketDate: '2026-08-28',
      dryRun: false,
    });
    expect(state.runDailyIngestion).not.toHaveBeenCalled();
    expect(state.fetch).toHaveBeenCalledTimes(1);
    const { url, init, body } = dispatchedBody();
    expect(url).toBe(
      'https://api.github.com/repos/owner/invest/actions/workflows/market-ingestion.yml/dispatches',
    );
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer test-token');
    expect(body).toEqual({
      ref: 'main',
      inputs: {
        environment: 'staging',
        date: '2026-08-28',
        tickers: 'IAM,ATW',
        dry_run: 'false',
        concurrency: '3',
        retry_run_id: '',
        trigger_source: 'manual',
      },
    });
  });

  it('refuses with EXECUTOR_NOT_CONFIGURED instead of creating a run nobody will execute', async () => {
    state.config = { user: USER, role: 'data_admin' };
    delete process.env['MARKET_INGESTION_DISPATCH_TOKEN'];
    const response = await POST(req({ date: '2026-08-28' }));
    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe('EXECUTOR_NOT_CONFIGURED');
    expect(state.fetch).not.toHaveBeenCalled();
    expect(state.runDailyIngestion).not.toHaveBeenCalled();
  });

  it('reports DISPATCH_FAILED when GitHub rejects the dispatch, without leaking the token', async () => {
    state.config = { user: USER, role: 'data_admin' };
    state.fetch.mockImplementation(async () => new Response('Bad credentials', { status: 401 }));
    const response = await POST(req({ date: '2026-08-28' }));
    expect(response.status).toBe(502);
    const text = await response.text();
    expect(text).toContain('DISPATCH_FAILED');
    expect(text).not.toContain('test-token');
  });

  it('rejects a duplicate request while a run for the same date is already running', async () => {
    state.config = {
      user: USER,
      role: 'data_admin',
      rpc: {
        list_market_ingestion_runs: {
          data: [{ id: 'run-1', status: 'running', market_date: '2026-08-28' }],
          error: null,
        },
      },
    };
    const response = await POST(req({ date: '2026-08-28' }));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe('ALREADY_RUNNING');
    expect(state.fetch).not.toHaveBeenCalled();
  });

  it('never lets the client choose the provider', async () => {
    state.config = { user: USER, role: 'data_admin' };
    const response = await POST(req({ date: '2026-08-28', provider: 'licensed_api' }));
    expect(response.status).toBe(202);
    expect(JSON.stringify(dispatchedBody().body)).not.toContain('licensed_api');
  });

  it('refuses to dispatch in production against bvc_public_testing', async () => {
    state.config = { user: USER, role: 'data_admin' };
    vi.stubEnv('NODE_ENV', 'production');
    const response = await POST(req({ date: '2026-08-28' }));
    vi.unstubAllEnvs();
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error).toMatch(/PRODUCTION_REFUSES_BVC_PUBLIC_TESTING/);
    expect(state.fetch).not.toHaveBeenCalled();
  });
});
