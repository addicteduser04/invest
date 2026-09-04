import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ComparePanel, type CompareSecurityDetail } from './compare-panel';
import type { ValuationSnapshot } from '@/lib/valuation-read';

function valuation(overrides: Partial<ValuationSnapshot> = {}): ValuationSnapshot {
  return {
    securityId: 'x',
    price: '100',
    priceDate: '2026-09-03',
    priceStale: false,
    fundamentalsPeriod: {
      periodType: 'annual',
      interimPeriod: null,
      fiscalYear: 2025,
      periodEndDate: '2025-12-31',
      publicationDate: '2026-02-18',
    },
    hasFundamentals: true,
    marketCap: 1_000_000_000,
    enterpriseValue: 1_100_000_000,
    pe: 14.2,
    pb: 2.1,
    evEbitda: 8.7,
    dividendYield: 0.04,
    earningsYield: 0.07,
    fcfYield: 0.06,
    revenueGrowth: 0.072,
    ebitdaGrowth: 0.05,
    epsGrowth: 0.03,
    ebitdaMargin: 0.3,
    operatingMargin: 0.25,
    netMargin: 0.15,
    roe: 0.14,
    debtEquity: 0.55,
    netDebt: 200_000_000,
    fcfMargin: 0.1,
    ...overrides,
  };
}

function security(overrides: Partial<CompareSecurityDetail> & { id: string }): CompareSecurityDetail {
  return {
    ticker: overrides.id.toUpperCase(),
    name: `${overrides.id} co`,
    sector: 'Telecoms',
    latest_market_date: '2026-09-03',
    latest_close_price: '100',
    daily_change_percent: '1.2',
    latest_price_provisional: false,
    history: [
      { market_date: '2026-08-01', close_price: '95' },
      { market_date: '2026-09-03', close_price: '100' },
    ],
    valuation: valuation(),
    ...overrides,
  };
}

describe('ComparePanel fundamentals/valuation integration', () => {
  it('renders valuation metrics for each compared security', () => {
    const html = renderToStaticMarkup(
      createElement(ComparePanel, {
        locale: 'en',
        securities: [security({ id: 'iam' }), security({ id: 'atw', valuation: valuation({ pe: 17.6 }) })],
      }),
    );
    expect(html).toContain('14.2x');
    expect(html).toContain('17.6x');
  });

  it('shows a dash for a security missing fundamentals rather than fabricating a value', () => {
    const noFundamentals = valuation({
      hasFundamentals: false,
      marketCap: null,
      pe: null,
      pb: null,
      evEbitda: null,
      revenueGrowth: null,
      netMargin: null,
      roe: null,
      debtEquity: null,
    });
    const html = renderToStaticMarkup(
      createElement(ComparePanel, {
        locale: 'en',
        securities: [security({ id: 'iam' }), security({ id: 'unknown', valuation: noFundamentals })],
      }),
    );
    expect(html).toContain('—');
  });

  it('does not blow up the existing price-performance matrix (still present alongside the new rows)', () => {
    const html = renderToStaticMarkup(
      createElement(ComparePanel, {
        locale: 'fr',
        securities: [security({ id: 'iam' }), security({ id: 'atw' })],
      }),
    );
    expect(html).toContain('compare-v2-matrix');
  });
});
