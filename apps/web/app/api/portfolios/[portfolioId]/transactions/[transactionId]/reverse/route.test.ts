import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  user: null as null | { id: string },
  rpcData: null as unknown,
  rpcError: null as null | { message: string },
  rpcArgs: null as null | Record<string, unknown>,
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    rpc: async (_name: string, args: Record<string, unknown>) => {
      state.rpcArgs = args;
      return { data: state.rpcData, error: state.rpcError };
    },
  }),
}));
import { POST } from './route';

const params = Promise.resolve({
  portfolioId: '00000000-0000-4000-8000-000000000001',
  transactionId: '00000000-0000-4000-8000-000000000002',
});
const request = (body: Record<string, unknown>) =>
  new Request('http://localhost/reverse', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const valid = {
  locale: 'fr',
  reason: 'Correction documentée',
  idempotencyReference: 'reversal-reference-0001',
};

describe('transaction reversal API boundary', () => {
  beforeEach(() => {
    state.user = null;
    state.rpcData = null;
    state.rpcError = null;
    state.rpcArgs = null;
  });

  it('rejects anonymous access', async () => {
    const response = await POST(request(valid), { params });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it.each([
    ['fr', 'Le motif'],
    ['ar', 'سبب العكس'],
  ] as const)('localizes invalid reasons in %s', async (locale, message) => {
    state.user = { id: 'user' };
    const response = await POST(request({ ...valid, locale, reason: 'court' }), { params });
    expect(response.status).toBe(422);
    expect((await response.json()).message).toContain(message);
  });

  it('forwards only validated values and ignores client-controlled effects', async () => {
    state.user = { id: 'user' };
    state.rpcData = { status: 'completed', repeated: false };
    const response = await POST(
      request({ ...valid, cashEffect: '999999', actorId: 'forged', portfolioTotal: '-1' }),
      { params },
    );
    expect(response.status).toBe(200);
    expect(state.rpcArgs).toEqual({
      p_portfolio_id: '00000000-0000-4000-8000-000000000001',
      p_original_transaction_id: '00000000-0000-4000-8000-000000000002',
      p_reason: valid.reason,
      p_idempotency_reference: valid.idempotencyReference,
      p_replacement: null,
    });
  });

  it.each([
    ['FORBIDDEN_PORTFOLIO', 403],
    ['ALREADY_REVERSED', 409],
    ['REVERSAL_OF_REVERSAL_PROHIBITED', 422],
    ['INVALID_REPLACEMENT', 422],
  ] as const)('maps %s to a stable response', async (code, status) => {
    state.user = { id: 'user' };
    state.rpcError = { message: code };
    const response = await POST(request(valid), { params });
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ code });
  });

  it('submits a validated atomic replacement', async () => {
    state.user = { id: 'user' };
    state.rpcData = { status: 'completed', replacementTransactionId: 'replacement' };
    const replacement = {
      type: 'fee',
      settlementDate: '2026-08-20',
      amount: '4.5',
      currency: 'MAD',
    };
    expect((await POST(request({ ...valid, replacement }), { params })).status).toBe(200);
    expect(state.rpcArgs?.['p_replacement']).toEqual(replacement);
  });
});
