import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  status: 'unauthenticated' as 'unauthenticated' | 'forbidden' | 'ok',
}));
vi.mock('@/lib/portfolio-read', () => ({
  readPortfolioValuation: async () =>
    state.status === 'ok'
      ? { status: 'ok', valuation: { portfolioId: '00000000-0000-4000-8000-000000000001' } }
      : { status: state.status },
}));
import { GET } from './route';

const params = Promise.resolve({ portfolioId: '00000000-0000-4000-8000-000000000001' });
describe('portfolio valuation API boundary', () => {
  beforeEach(() => {
    state.status = 'unauthenticated';
  });
  it('returns an English authentication error', async () => {
    const response = await GET(new Request('http://localhost/value?locale=en'), { params });
    expect(response.status).toBe(401);
    expect((await response.json()).message).toContain('Authentication');
  });
  it('rejects malformed as_of dates', async () => {
    const response = await GET(new Request('http://localhost/value?locale=en&as_of=bad'), {
      params,
    });
    expect(response.status).toBe(422);
  });
  it('rejects impossible calendar dates', async () => {
    const response = await GET(new Request('http://localhost/value?locale=en&as_of=2026-02-31'), {
      params,
    });
    expect(response.status).toBe(422);
  });
});
