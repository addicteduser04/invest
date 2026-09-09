import { describe, expect, it } from 'vitest';
import {
  buildPeerComparison,
  selectPeerCandidates,
  type PeerSecurityMeta,
  type SecurityOverviewRow,
} from './peer-read';
import type { ValuationSnapshot } from './valuation-read';

function securityRow(
  overrides: Partial<SecurityOverviewRow> & { id: string },
): SecurityOverviewRow {
  return {
    ticker: overrides.id.toUpperCase(),
    name: `${overrides.id} co`,
    sector: 'Telecoms',
    listing_status: 'active',
    is_synthetic: false,
    latest_close_price: '100',
    latest_market_date: '2026-09-03',
    ...overrides,
  };
}

describe('selectPeerCandidates', () => {
  const target = securityRow({ id: 'target' });

  it('selects only securities in the same sector', () => {
    const rows = [
      target,
      securityRow({ id: 'same-sector', sector: 'Telecoms' }),
      securityRow({ id: 'other-sector', sector: 'Banks' }),
    ];
    const peers = selectPeerCandidates(rows, target);
    expect(peers.map((p) => p.id)).toEqual(['same-sector']);
  });

  it('never includes the target itself, even if present in the candidate rows', () => {
    const rows = [target, securityRow({ id: 'peer' })];
    const peers = selectPeerCandidates(rows, target);
    expect(peers.some((p) => p.id === 'target')).toBe(false);
  });

  it('excludes synthetic securities from the peer set', () => {
    const rows = [target, securityRow({ id: 'synthetic-peer', is_synthetic: true })];
    const peers = selectPeerCandidates(rows, target);
    expect(peers).toEqual([]);
  });

  it('excludes delisted/pending securities, keeping active and suspended', () => {
    const rows = [
      target,
      securityRow({ id: 'delisted', listing_status: 'delisted' }),
      securityRow({ id: 'pending', listing_status: 'pending' }),
      securityRow({ id: 'suspended', listing_status: 'suspended' }),
      securityRow({ id: 'active', listing_status: 'active' }),
    ];
    const peers = selectPeerCandidates(rows, target)
      .map((p) => p.id)
      .sort();
    expect(peers).toEqual(['active', 'suspended']);
  });

  it('returns no peers when the target has no sector', () => {
    const noSectorTarget = securityRow({ id: 'target', sector: null });
    const peers = selectPeerCandidates(
      [noSectorTarget, securityRow({ id: 'peer' })],
      noSectorTarget,
    );
    expect(peers).toEqual([]);
  });
});

function snapshot(overrides: Partial<ValuationSnapshot> = {}): ValuationSnapshot {
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
    marketCap: 1000,
    enterpriseValue: 1100,
    pe: 10,
    pb: 2,
    evEbitda: 6,
    dividendYield: 0.03,
    earningsYield: 0.1,
    fcfYield: 0.08,
    revenueGrowth: 0.05,
    ebitdaGrowth: 0.04,
    epsGrowth: 0.06,
    ebitdaMargin: 0.3,
    operatingMargin: 0.25,
    netMargin: 0.15,
    roe: 0.12,
    debtEquity: 0.5,
    netDebt: 200,
    fcfMargin: 0.1,
    ...overrides,
  };
}

function meta(id: string, sector = 'Telecoms'): PeerSecurityMeta {
  return { id, ticker: id.toUpperCase(), name: `${id} co`, sector };
}

describe('buildPeerComparison', () => {
  it('computes peer median/min/max and the target rank for a normal metric', () => {
    const target = meta('target');
    const peers = [meta('a'), meta('b'), meta('c')];
    const valuationMap = new Map<string, ValuationSnapshot>([
      ['target', snapshot({ pe: 14 })],
      ['a', snapshot({ pe: 10 })],
      ['b', snapshot({ pe: 20 })],
      ['c', snapshot({ pe: 18 })],
    ]);
    const result = buildPeerComparison(target, peers, valuationMap);
    expect(result.peerCount).toBe(3);
    expect(result.stats.pe.median).toBe(18); // peer-only median of [10, 20, 18]
    expect(result.stats.pe.min).toBe(10);
    expect(result.stats.pe.max).toBe(20);
    expect(result.stats.pe.targetValue).toBe(14);
    // Ascending direction for P/E: values [10, 14, 18, 20] -> target (14) is rank 2 of 4.
    expect(result.stats.pe.rank).toEqual({ rank: 2, n: 4 });
  });

  it('excludes loss-making (null) P/E observations from the peer sample entirely', () => {
    const target = meta('target');
    const peers = [meta('a'), meta('b')];
    const valuationMap = new Map<string, ValuationSnapshot>([
      ['target', snapshot({ pe: 14 })],
      ['a', snapshot({ pe: null })], // loss-making -- valuation-metrics already nulled this
      ['b', snapshot({ pe: 20 })],
    ]);
    const result = buildPeerComparison(target, peers, valuationMap);
    expect(result.stats.pe.n).toBe(1); // only 'b' counts
    expect(result.stats.pe.median).toBe(20);
    expect(result.stats.pe.rank).toEqual({ rank: 1, n: 2 }); // target + 'b' only
  });

  it('excludes negative-EBITDA EV/EBITDA observations from the peer sample', () => {
    const target = meta('target');
    const peers = [meta('a')];
    const valuationMap = new Map<string, ValuationSnapshot>([
      ['target', snapshot({ evEbitda: 8 })],
      ['a', snapshot({ evEbitda: null })], // negative EBITDA -- already nulled upstream
    ]);
    const result = buildPeerComparison(target, peers, valuationMap);
    expect(result.stats.evEbitda.n).toBe(0);
    expect(result.stats.evEbitda.median).toBeNull();
    expect(result.stats.evEbitda.rank).toEqual({ rank: 1, n: 1 });
  });

  it('handles a target with no peers at all (no-peer state)', () => {
    const target = meta('target');
    const valuationMap = new Map<string, ValuationSnapshot>([['target', snapshot({ pe: 14 })]]);
    const result = buildPeerComparison(target, [], valuationMap);
    expect(result.peerCount).toBe(0);
    expect(result.stats.pe.median).toBeNull();
    expect(result.stats.pe.n).toBe(0);
    expect(result.stats.pe.rank).toEqual({ rank: 1, n: 1 });
    expect(result.stats.pe.percentile).toBeNull(); // n=1 sample -- no meaningful percentile
  });

  it('handles partial peer data (some peers missing fundamentals) without dropping them from the peer list', () => {
    const target = meta('target');
    const peers = [meta('a'), meta('b')];
    const valuationMap = new Map<string, ValuationSnapshot>([
      ['target', snapshot({ pe: 14, roe: 0.1 })],
      ['a', snapshot({ hasFundamentals: false, pe: null, roe: null, marketCap: null })],
      ['b', snapshot({ pe: 12, roe: 0.2 })],
    ]);
    const result = buildPeerComparison(target, peers, valuationMap);
    expect(result.peerCount).toBe(2); // both peers still listed
    expect(result.stats.pe.n).toBe(1); // only 'b' has a usable P/E
    expect(result.stats.roe.n).toBe(1);
  });

  it('when the target itself has no value for a metric, it is not included in that metric’s rank', () => {
    const target = meta('target');
    const peers = [meta('a')];
    const valuationMap = new Map<string, ValuationSnapshot>([
      ['target', snapshot({ pe: null })],
      ['a', snapshot({ pe: 15 })],
    ]);
    const result = buildPeerComparison(target, peers, valuationMap);
    expect(result.stats.pe.targetValue).toBeNull();
    expect(result.stats.pe.rank).toBeNull();
    expect(result.stats.pe.median).toBe(15);
  });

  it('ranks ROE with the highest value as rank 1 (descending), independent of P/E’s ascending direction', () => {
    const target = meta('target');
    const peers = [meta('a'), meta('b')];
    const valuationMap = new Map<string, ValuationSnapshot>([
      ['target', snapshot({ roe: 0.2 })],
      ['a', snapshot({ roe: 0.1 })],
      ['b', snapshot({ roe: 0.3 })],
    ]);
    const result = buildPeerComparison(target, peers, valuationMap);
    expect(result.stats.roe.rank).toEqual({ rank: 2, n: 3 });
  });

  it('throws when the target has no valuation snapshot at all (programmer error, not a product state)', () => {
    const target = meta('target');
    expect(() => buildPeerComparison(target, [], new Map())).toThrow();
  });
});
