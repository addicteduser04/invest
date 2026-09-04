import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SecurityValuationSection } from './security-valuation-section';
import type { ValuationSnapshot } from '@/lib/valuation-read';

const populated: ValuationSnapshot = {
  securityId: 'sec-1',
  price: '120',
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
  marketCap: 6_000_000_000,
  enterpriseValue: 6_100_000_000,
  pe: 14.2,
  pb: 2.1,
  evEbitda: 8.7,
  dividendYield: 0.043,
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
  netDebt: 500_000_000,
  fcfMargin: 0.1,
};

const empty: ValuationSnapshot = {
  ...populated,
  price: null,
  priceDate: null,
  hasFundamentals: false,
  fundamentalsPeriod: null,
  marketCap: null,
  enterpriseValue: null,
  pe: null,
  pb: null,
  evEbitda: null,
  dividendYield: null,
  earningsYield: null,
  fcfYield: null,
};

describe('SecurityValuationSection', () => {
  it('renders populated ratios with neutral labels (no cheap/expensive language)', () => {
    const html = renderToStaticMarkup(
      createElement(SecurityValuationSection, { locale: 'en', valuation: populated }),
    );
    expect(html).toContain('14.2x');
    expect(html).toContain('2.1x');
    expect(html).toContain('8.7x');
    expect(html).not.toMatch(/cheap|expensive|undervalued|overvalued|attractive/i);
  });

  it('shows the fiscal period and publication date used for the calculation', () => {
    const html = renderToStaticMarkup(
      createElement(SecurityValuationSection, { locale: 'en', valuation: populated }),
    );
    expect(html).toContain('FY2025');
    expect(html).toContain('2026-02-18');
  });

  it('flags a stale price without hiding it', () => {
    const html = renderToStaticMarkup(
      createElement(SecurityValuationSection, {
        locale: 'en',
        valuation: { ...populated, priceStale: true },
      }),
    );
    expect(html).toContain('2026-09-03');
    expect(html).toContain('stale');
  });

  it('shows an explicit empty state when there is no price and no fundamentals', () => {
    const html = renderToStaticMarkup(
      createElement(SecurityValuationSection, { locale: 'en', valuation: empty }),
    );
    expect(html).toContain('No valuation data is available');
    expect(html).not.toContain('14.2x');
  });

  it('renders dashes for missing individual ratios rather than fabricating values', () => {
    const partial: ValuationSnapshot = { ...populated, pe: null, dividendYield: null };
    const html = renderToStaticMarkup(
      createElement(SecurityValuationSection, { locale: 'en', valuation: partial }),
    );
    expect(html).toContain('—');
  });

  it('renders French terminology', () => {
    const html = renderToStaticMarkup(
      createElement(SecurityValuationSection, { locale: 'fr', valuation: populated }),
    );
    expect(html).toContain('Capitalisation boursière');
    expect(html).toContain('Valeur d’entreprise');
    expect(html).toContain('Rendement du dividende');
  });

  it('renders Arabic with technical values kept LTR-isolated', () => {
    const html = renderToStaticMarkup(
      createElement(SecurityValuationSection, { locale: 'ar', valuation: populated }),
    );
    expect(html).toContain('التقييم');
    expect(html).toContain('dir="ltr"');
    // ar-MA number formatting uses a comma decimal separator ("14,2x"), unlike en-MA/fr-MA's
    // "14.2x" -- this is correct locale-aware formatting, not a bug.
    expect(html).toMatch(/14[.,]2x/);
  });
});
