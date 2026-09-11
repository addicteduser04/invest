import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  response: { allowed: true, count: 1, limit: 3, retryAfterSeconds: 0 } as {
    allowed: boolean;
    count: number;
    limit: number;
    retryAfterSeconds: number;
  } | null,
  shouldThrow: false,
  queries: [] as Array<{ text: string; values: unknown[] }>,
}));

vi.mock('pg', () => {
  class FakePool {
    async query(text: string, values: unknown[]) {
      state.queries.push({ text, values });
      if (state.shouldThrow) throw new Error('connection lost');
      return { rows: state.response ? [{ check_rate_limit: state.response }] : [] };
    }
  }
  return { Pool: FakePool };
});

import { checkRateLimit, hashIdentity, rateLimitResponse } from './rate-limit';

// vi.stubEnv/unstubAllEnvs rather than a bare `process.env[...] = ...` assignment: this test
// file's worker may be shared with other test files (vitest's default pool), and env vars are
// process-global -- an un-restored WORKER_DATABASE_URL could leak into unrelated tests.
beforeAll(() => vi.stubEnv('WORKER_DATABASE_URL', 'postgres://fake'));
afterAll(() => vi.unstubAllEnvs());

describe('hashIdentity', () => {
  it('never returns the raw input and is deterministic', () => {
    const hashed = hashIdentity('user-123');
    expect(hashed).not.toBe('user-123');
    expect(hashed).toBe(hashIdentity('user-123'));
    expect(hashed).toMatch(/^[0-9a-f]{64}$/);
  });

  it('gives independent users independent hashes', () => {
    expect(hashIdentity('user-a')).not.toBe(hashIdentity('user-b'));
  });
});

describe('checkRateLimit', () => {
  beforeEach(() => {
    state.response = { allowed: true, count: 1, limit: 3, retryAfterSeconds: 0 };
    state.shouldThrow = false;
    state.queries = [];
  });

  it('returns the database result when the call succeeds', async () => {
    state.response = { allowed: true, count: 1, limit: 3, retryAfterSeconds: 12 };
    const result = await checkRateLimit({
      scope: 'test',
      identity: 'user-1',
      maxCount: 3,
      windowSeconds: 60,
    });
    expect(result).toEqual({ allowed: true, count: 1, limit: 3, retryAfterSeconds: 12 });
  });

  it('reports over-limit when the database says so', async () => {
    state.response = { allowed: false, count: 4, limit: 3, retryAfterSeconds: 45 };
    const result = await checkRateLimit({
      scope: 'test',
      identity: 'user-1',
      maxCount: 3,
      windowSeconds: 60,
    });
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBe(45);
  });

  it('fails open (allows the request) when the connection errors', async () => {
    state.shouldThrow = true;
    const result = await checkRateLimit({
      scope: 'test',
      identity: 'user-1',
      maxCount: 3,
      windowSeconds: 60,
    });
    expect(result.allowed).toBe(true);
  });

  it('never sends the raw identity, only its hash, over the connection', async () => {
    await checkRateLimit({ scope: 'test', identity: 'user-1', maxCount: 3, windowSeconds: 60 });
    const call = state.queries[0]!;
    expect(call.values).not.toContain('user-1');
    expect(call.values[1]).toBe(hashIdentity('user-1'));
  });
});

describe('rateLimitResponse', () => {
  it('returns 429 with a Retry-After header and no internal limiter details', async () => {
    const response = rateLimitResponse({
      allowed: false,
      count: 4,
      limit: 3,
      retryAfterSeconds: 30,
    });
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('30');
    const body = await response.json();
    expect(body).toEqual({ error: 'RATE_LIMITED', retryAfterSeconds: 30 });
  });
});
