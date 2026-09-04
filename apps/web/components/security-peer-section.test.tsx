import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SecurityPeerSection } from './security-peer-section';
import { buildPeerComparison, type PeerSecurityMeta } from '@/lib/peer-read';
import type { ValuationSnapshot } from '@/lib/valuation-read';

function snapshot(overrides: Partial<ValuationSnapshot> = {}): ValuationSnapshot {
  return {
    securityId: 'x',
    price: '145.3',
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
    ...overrides,
  };
}

function meta(id: string): PeerSecurityMeta {
  return { id, ticker: id.toUpperCase(), name: `${id} Company`, sector: 'Telecoms' };
}

const target = meta('target');
const peerA = meta('peer-a');
const peerB = meta('peer-b');

const populatedComparison = buildPeerComparison(
  target,
  [peerA, peerB],
  new Map([
    ['target', snapshot({ pe: 14.2, roe: 0.14 })],
    ['peer-a', snapshot({ pe: 17.6, roe: 0.1 })],
    ['peer-b', snapshot({ pe: 20, roe: 0.2 })],
  ]),
);

const noPeerComparison = buildPeerComparison(target, [], new Map([['target', snapshot()]]));

describe('SecurityPeerSection', () => {
  it('renders the target value, sector median, and rank for populated peer metrics', () => {
    const html = renderToStaticMarkup(
      createElement(SecurityPeerSection, { locale: 'en', comparison: populatedComparison }),
    );
    expect(html).toContain('14.2x');
    expect(html).toMatch(/17\.8|17\.6|18\.8/); // median of [17.6, 20] = 18.8x
    expect(html).toContain('Rank');
  });

  it('never uses cheap/expensive/investment-recommendation language', () => {
    const html = renderToStaticMarkup(
      createElement(SecurityPeerSection, { locale: 'en', comparison: populatedComparison }),
    );
    expect(html).not.toMatch(/cheap|expensive|undervalued|overvalued|buy|sell|score/i);
  });

  it('shows a dedicated empty state when there are no peers', () => {
    const html = renderToStaticMarkup(
      createElement(SecurityPeerSection, { locale: 'en', comparison: noPeerComparison }),
    );
    expect(html).toContain('No other listed, non-synthetic company');
    expect(html).not.toContain('14.2x');
  });

  it('shows a dedicated empty state when the target has no sector', () => {
    const noSectorTarget: PeerSecurityMeta = { ...target, sector: null };
    const comparison = buildPeerComparison(
      noSectorTarget,
      [],
      new Map([['target', snapshot()]]),
    );
    const html = renderToStaticMarkup(
      createElement(SecurityPeerSection, { locale: 'en', comparison }),
    );
    expect(html).toContain('No sector is recorded');
  });

  it('distinguishes the target row and links peer rows to their Security Detail pages', () => {
    const html = renderToStaticMarkup(
      createElement(SecurityPeerSection, { locale: 'en', comparison: populatedComparison }),
    );
    expect(html).toContain('peer-table-target-row');
    expect(html).toContain('This company');
    expect(html).toContain('href="/en/market/peer-a"');
    expect(html).toContain('href="/en/market/peer-b"');
  });

  it('includes an explicit sector median summary row in the table', () => {
    const html = renderToStaticMarkup(
      createElement(SecurityPeerSection, { locale: 'en', comparison: populatedComparison }),
    );
    expect(html).toContain('peer-table-median-row');
  });

  it('renders French terminology', () => {
    const html = renderToStaticMarkup(
      createElement(SecurityPeerSection, { locale: 'fr', comparison: populatedComparison }),
    );
    expect(html).toContain('Comparaison sectorielle');
    expect(html).toContain('Médiane sectorielle');
  });

  it('renders Arabic with technical values kept LTR-isolated', () => {
    const html = renderToStaticMarkup(
      createElement(SecurityPeerSection, { locale: 'ar', comparison: populatedComparison }),
    );
    expect(html).toContain('المقارنة القطاعية');
    expect(html).toContain('dir="ltr"');
    expect(html).toMatch(/14[.,]2x/);
  });
});
