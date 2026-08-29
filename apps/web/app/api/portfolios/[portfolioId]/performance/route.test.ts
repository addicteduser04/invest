import { describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/portfolio-read', () => ({
  readPortfolioPerformance: async () => ({ status: 'unauthenticated' }),
}));
import { GET } from './route';
const params = Promise.resolve({ portfolioId: '00000000-0000-4000-8000-000000000001' });
describe('portfolio performance API boundary', () => {
  it('keeps the private performance boundary authenticated', async () => {
    const response = await GET(new Request('http://localhost/performance?locale=fr'), { params });
    expect(response.status).toBe(401);
  });
  it('rejects impossible calendar ranges before portfolio reads', async () => {
    const response = await GET(
      new Request('http://localhost/performance?locale=en&from=2026-02-31&to=2026-03-10'),
      { params },
    );
    expect(response.status).toBe(422);
  });
});
