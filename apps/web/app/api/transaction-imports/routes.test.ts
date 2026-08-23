import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  user: null as null | { id: string },
  rpcData: null as unknown,
  rpcError: null as null | { message: string },
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    rpc: async () => ({ data: state.rpcData, error: state.rpcError }),
  }),
}));
import { POST as confirm } from './[id]/confirm/route';

const request = (locale: 'fr' | 'ar') =>
  new Request('http://localhost/api/transaction-imports/id/confirm', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ locale }),
  });
describe('transaction import API boundary', () => {
  beforeEach(() => {
    state.user = null;
    state.rpcData = null;
    state.rpcError = null;
  });
  it.each(['fr', 'ar'] as const)('rejects unauthenticated %s confirmation', async (locale) => {
    const response = await confirm(request(locale), {
      params: Promise.resolve({ id: '00000000-0000-4000-8000-000000000001' }),
    });
    expect(response.status).toBe(401);
    expect((await response.json()).code).toBe('UNAUTHENTICATED');
  });
  it('localizes a durable Arabic confirmation failure without exposing database text', async () => {
    state.user = { id: 'user' };
    state.rpcData = { status: 'failed', failureCode: 'INSUFFICIENT_CASH', failedRow: 3 };
    const response = await confirm(request('ar'), {
      params: Promise.resolve({ id: '00000000-0000-4000-8000-000000000001' }),
    });
    const body = await response.json();
    expect(response.status).toBe(409);
    expect(body.message).toContain('السيولة');
    expect(JSON.stringify(body)).not.toContain('stack');
  });
  it('maps cross-user database rejection to a stable public error', async () => {
    state.user = { id: 'user' };
    state.rpcError = { message: 'FORBIDDEN_PORTFOLIO' };
    const response = await confirm(request('fr'), {
      params: Promise.resolve({ id: '00000000-0000-4000-8000-000000000001' }),
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'FORBIDDEN_PORTFOLIO' });
  });
});
