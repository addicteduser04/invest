import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeSupabase, type FakeSupabaseConfig } from '@/test/fake-supabase';
import type { StoredRun } from '@bvc/market-ingestion';

const state = vi.hoisted(() => ({
  config: { user: null, role: null } as FakeSupabaseConfig,
  storedRun: null as StoredRun | null,
  runDailyIngestion: vi.fn(),
  fetch: vi.fn<typeof fetch>(async () => new Response(null, { status: 204 })),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () =>
    createFakeSupabase({
      ...state.config,
      rpc: {
        get_market_ingestion_run: () => ({
          data: state.storedRun ? [toRow(state.storedRun)] : [],
          error: null,
        }),
      },
    }),
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
const RUN_ID = '650b1586-07e1-45da-8bcb-98366bcaf3de';
const params = Promise.resolve({ runId: RUN_ID });

function toRow(run: StoredRun) {
  return {
    id: run.id,
    provider_id: run.providerId,
    market_date: run.marketDate,
    status: run.status,
    trigger_source: run.triggerSource,
    started_at: run.startedAt,
    finished_at: run.finishedAt,
    metrics: run.metrics,
    instrument_failures: run.instrumentFailures,
    parent_run_id: run.parentRunId,
  };
}

function baseRun(overrides: Partial<StoredRun> = {}): StoredRun {
  return {
    id: RUN_ID,
    providerId: 'bvc_public_testing',
    marketDate: '2026-08-28',
    status: 'partial',
    triggerSource: 'cli',
    startedAt: '2026-08-28T18:00:00.000Z',
    finishedAt: '2026-08-28T18:01:00.000Z',
    metrics: {
      securitiesExpected: 2,
      securitiesSucceeded: 1,
      securitiesFailed: 1,
      rowsReceived: 1,
      rowsAccepted: 1,
      rowsRejected: 0,
      rowsPublished: 1,
      indicesExpected: 0,
      indicesSucceeded: 0,
      indicesFailed: 0,
      retryCount: 0,
      errorSummary: {},
    },
    instrumentFailures: [
      {
        ticker: 'ATW',
        stage: 'ohlcv',
        dateOrRange: '2026-08-28',
        errorCode: 'BVC_HTTP_500',
        message: 'boom',
        attempts: 3,
        lastAttemptAt: '2026-08-28T18:01:00.000Z',
      },
    ],
    parentRunId: null,
    ...overrides,
  };
}

describe('POST /api/admin/market-data/runs/[runId]/retry', () => {
  const post = () => POST(new Request('http://localhost', { method: 'POST' }), { params });

  beforeEach(() => {
    state.config = { user: null, role: null };
    state.storedRun = null;
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
    expect((await post()).status).toBe(401);
  });

  it('denies an investor', async () => {
    state.config = { user: USER, role: 'investor' };
    expect((await post()).status).toBe(403);
  });

  it('dispatches a retry of a partial run to the executor, never running it in-process', async () => {
    state.config = { user: USER, role: 'data_admin' };
    state.storedRun = baseRun();
    const response = await post();
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ dispatched: true, parentRunId: RUN_ID });
    expect(state.runDailyIngestion).not.toHaveBeenCalled();
    const [, init] = state.fetch.mock.calls[0]!;
    expect(JSON.parse(String(init!.body)).inputs).toMatchObject({
      environment: 'staging',
      retry_run_id: RUN_ID,
      date: '',
      tickers: '',
    });
  });

  it('dispatches a retry of a failed run', async () => {
    state.config = { user: USER, role: 'data_admin' };
    state.storedRun = baseRun({ status: 'failed' });
    expect((await post()).status).toBe(202);
  });

  it('returns 404 when the run does not exist', async () => {
    state.config = { user: USER, role: 'data_admin' };
    expect((await post()).status).toBe(404);
    expect(state.fetch).not.toHaveBeenCalled();
  });

  it('returns 404 for a malformed run id without querying anything', async () => {
    state.config = { user: USER, role: 'data_admin' };
    const response = await POST(new Request('http://localhost', { method: 'POST' }), {
      params: Promise.resolve({ runId: 'not-a-uuid' }),
    });
    expect(response.status).toBe(404);
  });

  it('refuses to retry a run that is not partial/failed', async () => {
    state.config = { user: USER, role: 'data_admin' };
    state.storedRun = baseRun({ status: 'succeeded', instrumentFailures: [] });
    expect((await post()).status).toBe(409);
    expect(state.fetch).not.toHaveBeenCalled();
  });

  it('refuses to retry a run with no retryable failures', async () => {
    state.config = { user: USER, role: 'data_admin' };
    state.storedRun = baseRun({ instrumentFailures: [] });
    const response = await post();
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/NO_FAILED_INSTRUMENTS/);
    expect(state.fetch).not.toHaveBeenCalled();
  });

  it('refuses with EXECUTOR_NOT_CONFIGURED when no executor is configured', async () => {
    state.config = { user: USER, role: 'data_admin' };
    state.storedRun = baseRun();
    delete process.env['MARKET_INGESTION_DISPATCH_REPOSITORY'];
    const response = await post();
    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe('EXECUTOR_NOT_CONFIGURED');
  });
});
