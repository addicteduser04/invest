import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ mode: 'ok' as 'ok' | 'unauthenticated' }));
vi.mock('@/lib/portfolio-read', () => ({
  readPortfolioValuation: async () =>
    state.mode === 'unauthenticated'
      ? { status: 'unauthenticated' }
      : {
          status: 'ok',
          valuation: {
            valuationDate: '2026-08-28',
            status: 'current',
            totalValue: '1000',
            cashValue: '100',
            securitiesValue: '900',
            totalGain: '50',
            realizedGain: '10',
            unrealizedGain: '30',
            netDividendIncome: '10',
            positions: [
              {
                quantity: '1',
                ticker: 'IAM',
                sector: 'Telecom',
                weightPercent: '90',
                unrealizedGain: '30',
                priceStatus: 'current',
              },
            ],
          },
        },
  readPortfolioPerformance: async () =>
    state.mode === 'unauthenticated'
      ? { status: 'unauthenticated' }
      : { status: 'ok', performance: { twr: '0.05', xirr: '0.04' } },
}));

import { POST } from './route';

const params = Promise.resolve({ portfolioId: '00000000-0000-4000-8000-000000000001' });

describe('portfolio insight API', () => {
  afterEach(() => {
    delete process.env.DEEPSEEK_API_KEY;
    state.mode = 'ok';
  });

  it('keeps private portfolio insight generation authenticated', async () => {
    state.mode = 'unauthenticated';
    const response = await POST(new Request('http://localhost', { method: 'POST', body: '{}' }), {
      params,
    });
    expect(response.status).toBe(401);
  });

  it('returns a transparent deterministic summary when no AI provider is configured', async () => {
    const response = await POST(
      new Request('http://localhost', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ locale: 'en' }),
      }),
      { params },
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.provider).toBe('deterministic');
    expect(body.summary).toContain('largest position');
  });
});
