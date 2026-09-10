import { describe, expect, it } from 'vitest';
import { checkRateLimit, hashIdentity, rateLimitResponse } from './rate-limit';

function fakeSupabase(response: { data?: unknown; error?: { message: string } | null }) {
  return { rpc: async () => response } as Parameters<typeof checkRateLimit>[0];
}

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
  it('returns the RPC result when the database call succeeds', async () => {
    const supabase = fakeSupabase({
      data: { allowed: true, count: 1, limit: 3, retryAfterSeconds: 12 },
    });
    const result = await checkRateLimit(supabase, {
      scope: 'test',
      identity: 'user-1',
      maxCount: 3,
      windowSeconds: 60,
    });
    expect(result).toEqual({ allowed: true, count: 1, limit: 3, retryAfterSeconds: 12 });
  });

  it('reports over-limit when the RPC says so', async () => {
    const supabase = fakeSupabase({
      data: { allowed: false, count: 4, limit: 3, retryAfterSeconds: 45 },
    });
    const result = await checkRateLimit(supabase, {
      scope: 'test',
      identity: 'user-1',
      maxCount: 3,
      windowSeconds: 60,
    });
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBe(45);
  });

  it('fails open (allows the request) when the RPC errors', async () => {
    const supabase = fakeSupabase({ data: null, error: { message: 'connection lost' } });
    const result = await checkRateLimit(supabase, {
      scope: 'test',
      identity: 'user-1',
      maxCount: 3,
      windowSeconds: 60,
    });
    expect(result.allowed).toBe(true);
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
