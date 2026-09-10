import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeSupabase, type FakeSupabaseConfig } from '@/test/fake-supabase';

const state = vi.hoisted(() => ({ config: { user: null, role: null } as FakeSupabaseConfig }));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => createFakeSupabase(state.config),
}));

import { isErrorResponse, requireDataAdmin } from './admin-auth';

const USER = { id: '00000000-0000-4000-8000-000000000099' };

describe('requireDataAdmin', () => {
  beforeEach(() => {
    state.config = { user: null, role: null };
  });

  it('rejects an unauthenticated caller with 401', async () => {
    const result = await requireDataAdmin();
    expect(isErrorResponse(result)).toBe(true);
    expect((result as Response).status).toBe(401);
  });

  it('rejects a signed-in investor with 403', async () => {
    state.config = { user: USER, role: 'investor' };
    const result = await requireDataAdmin();
    expect(isErrorResponse(result)).toBe(true);
    expect((result as Response).status).toBe(403);
  });

  it('allows a data_admin through with no rate limit configured', async () => {
    state.config = { user: USER, role: 'data_admin' };
    const result = await requireDataAdmin();
    expect(isErrorResponse(result)).toBe(false);
    if (!isErrorResponse(result)) expect(result.userId).toBe(USER.id);
  });

  it('rejects a data_admin over the configured rate limit with 429', async () => {
    state.config = {
      user: USER,
      role: 'data_admin',
      rpc: {
        check_rate_limit: { data: { allowed: false, count: 4, limit: 3, retryAfterSeconds: 20 } },
      },
    };
    const result = await requireDataAdmin({ scope: 'test-job', maxCount: 3, windowSeconds: 900 });
    expect(isErrorResponse(result)).toBe(true);
    expect((result as Response).status).toBe(429);
    expect((result as Response).headers.get('Retry-After')).toBe('20');
  });

  it('allows a data_admin under the configured rate limit', async () => {
    state.config = {
      user: USER,
      role: 'data_admin',
      rpc: {
        check_rate_limit: { data: { allowed: true, count: 1, limit: 3, retryAfterSeconds: 900 } },
      },
    };
    const result = await requireDataAdmin({ scope: 'test-job', maxCount: 3, windowSeconds: 900 });
    expect(isErrorResponse(result)).toBe(false);
  });
});
