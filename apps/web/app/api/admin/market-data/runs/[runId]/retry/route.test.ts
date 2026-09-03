import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeSupabase, type FakeSupabaseConfig } from '@/test/fake-supabase';
import type { StoredRun } from '@bvc/market-ingestion';

const state = vi.hoisted(() => ({
  config: { user: null, role: null } as FakeSupabaseConfig,
  storedRun: null as StoredRun | null,
  runDailyIngestion: vi.fn(async (_options: Record<string, unknown>) => ({
    runId: 'run-2',
    providerId: 'bvc_public_testing',
    marketDate: '2026-08-28',
    status: 'succeeded',
    triggerSource: 'retry',
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
    PgIngestionStore: vi.fn().mockImplementation(() => ({
      getRun: async () => state.storedRun,
      close: vi.fn(),
    })),
    runDailyIngestion: (...args: unknown[]) =>
      state.runDailyIngestion(...(args as [Record<string, unknown>])),
  };
});

import { POST } from './route';

const USER = { id: '00000000-0000-4000-8000-000000000010' };
const params = Promise.resolve({ runId: 'run-1' });

function baseRun(overrides: Partial<StoredRun> = {}): StoredRun {
  return {
    id: 'run-1',
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
  beforeEach(() => {
    state.config = { user: null, role: null };
    state.storedRun = null;
    state.runDailyIngestion.mockClear();
    process.env['MARKET_INGESTION_PROVIDER'] = 'bvc_public_testing';
    process.env['BVC_PUBLIC_TESTING_ENABLED'] = 'true';
    process.env['WORKER_DATABASE_URL'] = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
  });

  it('denies an unauthenticated caller', async () => {
    const response = await POST(new Request('http://localhost', { method: 'POST' }), { params });
    expect(response.status).toBe(401);
  });

  it('denies an investor', async () => {
    state.config = { user: USER, role: 'investor' };
    const response = await POST(new Request('http://localhost', { method: 'POST' }), { params });
    expect(response.status).toBe(403);
  });

  it('retries a partial run for a data_admin, scoped to failed instruments only', async () => {
    state.config = { user: USER, role: 'data_admin' };
    state.storedRun = baseRun();
    const response = await POST(new Request('http://localhost', { method: 'POST' }), { params });
    expect(response.status).toBe(200);
    const [options] = state.runDailyIngestion.mock.calls[0]!;
    expect(options).toMatchObject({
      tickers: ['ATW'],
      triggerSource: 'retry',
      parentRunId: 'run-1',
    });
  });

  it('returns 404 when the run does not exist', async () => {
    state.config = { user: USER, role: 'data_admin' };
    state.storedRun = null;
    const response = await POST(new Request('http://localhost', { method: 'POST' }), { params });
    expect(response.status).toBe(404);
  });

  it('refuses to retry a run that is not partial/failed', async () => {
    state.config = { user: USER, role: 'data_admin' };
    state.storedRun = baseRun({ status: 'succeeded', instrumentFailures: [] });
    const response = await POST(new Request('http://localhost', { method: 'POST' }), { params });
    expect(response.status).toBe(409);
    expect(state.runDailyIngestion).not.toHaveBeenCalled();
  });

  it('refuses to retry a run with no retryable failures', async () => {
    state.config = { user: USER, role: 'data_admin' };
    state.storedRun = baseRun({ instrumentFailures: [] });
    const response = await POST(new Request('http://localhost', { method: 'POST' }), { params });
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toMatch(/NO_FAILED_INSTRUMENTS/);
  });
});
