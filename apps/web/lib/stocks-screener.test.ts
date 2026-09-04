import { describe, expect, it } from 'vitest';
import {
  compareForSort,
  hasAnyValuationFilter,
  matchesValuationFilters,
  parseFilterNumber,
  sortSecurities,
  type SortableSecurity,
  type ValuationFilters,
} from './stocks-screener';
import type { ValuationSnapshot } from './valuation-read';

const emptyFilters: ValuationFilters = {
  hasFundamentalsOnly: false,
  hasValuationOnly: false,
};

function snapshot(overrides: Partial<ValuationSnapshot> = {}): ValuationSnapshot {
  return {
    securityId: 'sec-1',
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
    enterpriseValue: 1200,
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

describe('parseFilterNumber', () => {
  it('parses a valid numeric string', () => {
    expect(parseFilterNumber('15.5')).toBe(15.5);
  });
  it('is undefined for blank, missing, or non-finite input', () => {
    expect(parseFilterNumber(undefined)).toBeUndefined();
    expect(parseFilterNumber('')).toBeUndefined();
    expect(parseFilterNumber('abc')).toBeUndefined();
  });
});

describe('compareForSort', () => {
  it('sorts descending by default, and ascending when requested', () => {
    // A negative result means the left value sorts first (Array.prototype.sort semantics).
    expect(compareForSort(10, 5, 'desc')).toBeLessThan(0); // 10 (left) sorts before 5 when descending
    expect(compareForSort(10, 5, 'asc')).toBeGreaterThan(0); // 10 (left) sorts after 5 when ascending
  });
  it('always sorts null last, regardless of direction', () => {
    expect(compareForSort(null, 5, 'desc')).toBeGreaterThan(0);
    expect(compareForSort(null, 5, 'asc')).toBeGreaterThan(0);
    expect(compareForSort(5, null, 'desc')).toBeLessThan(0);
    expect(compareForSort(5, null, 'asc')).toBeLessThan(0);
    expect(compareForSort(null, null, 'asc')).toBe(0);
  });
});

describe('hasAnyValuationFilter', () => {
  it('is false when nothing is set', () => {
    expect(hasAnyValuationFilter(emptyFilters)).toBe(false);
  });
  it('is true when any single filter is set', () => {
    expect(hasAnyValuationFilter({ ...emptyFilters, peMax: 15 })).toBe(true);
    expect(hasAnyValuationFilter({ ...emptyFilters, hasFundamentalsOnly: true })).toBe(true);
  });
});

describe('matchesValuationFilters', () => {
  it('passes everything when no filters are set', () => {
    expect(matchesValuationFilters(snapshot(), emptyFilters)).toBe(true);
    expect(matchesValuationFilters(undefined, emptyFilters)).toBe(false);
  });

  it('excludes a null P/E when a P/E max filter is set (never treats null as passing)', () => {
    const filters: ValuationFilters = { ...emptyFilters, peMax: 15 };
    expect(matchesValuationFilters(snapshot({ pe: null }), filters)).toBe(false);
    expect(matchesValuationFilters(snapshot({ pe: 10 }), filters)).toBe(true);
    expect(matchesValuationFilters(snapshot({ pe: 20 }), filters)).toBe(false);
  });

  it('P/E < 15 excludes both null and loss-making (already-null) companies', () => {
    // A loss-making company already has pe === null from the metrics library -- this proves the
    // screener filter does not resurrect it as if it were meaningful.
    const filters: ValuationFilters = { ...emptyFilters, peMax: 15 };
    expect(matchesValuationFilters(snapshot({ pe: null }), filters)).toBe(false);
  });

  it('applies min filters symmetrically (null excluded, below threshold excluded)', () => {
    const filters: ValuationFilters = { ...emptyFilters, roeMin: 0.1 };
    expect(matchesValuationFilters(snapshot({ roe: null }), filters)).toBe(false);
    expect(matchesValuationFilters(snapshot({ roe: 0.05 }), filters)).toBe(false);
    expect(matchesValuationFilters(snapshot({ roe: 0.1 }), filters)).toBe(true);
    expect(matchesValuationFilters(snapshot({ roe: 0.2 }), filters)).toBe(true);
  });

  it('hasFundamentals filter excludes securities without a usable fundamentals period', () => {
    const filters: ValuationFilters = { ...emptyFilters, hasFundamentalsOnly: true };
    expect(matchesValuationFilters(snapshot({ hasFundamentals: false }), filters)).toBe(false);
    expect(matchesValuationFilters(snapshot({ hasFundamentals: true }), filters)).toBe(true);
  });

  it('hasValuation filter excludes securities without a computable market cap', () => {
    const filters: ValuationFilters = { ...emptyFilters, hasValuationOnly: true };
    expect(matchesValuationFilters(snapshot({ marketCap: null }), filters)).toBe(false);
    expect(matchesValuationFilters(snapshot({ marketCap: 1000 }), filters)).toBe(true);
  });

  it('combines multiple filters with AND semantics', () => {
    const filters: ValuationFilters = { ...emptyFilters, peMax: 15, roeMin: 0.1 };
    expect(matchesValuationFilters(snapshot({ pe: 10, roe: 0.12 }), filters)).toBe(true);
    expect(matchesValuationFilters(snapshot({ pe: 20, roe: 0.12 }), filters)).toBe(false);
    expect(matchesValuationFilters(snapshot({ pe: 10, roe: 0.05 }), filters)).toBe(false);
  });
});

describe('sortSecurities', () => {
  const rows: SortableSecurity[] = [
    { id: 'a', ticker: 'AAA', name: 'Alpha', latest_close_price: '100', daily_change_percent: '1' },
    { id: 'b', ticker: 'BBB', name: 'Beta', latest_close_price: '200', daily_change_percent: '-2' },
    { id: 'c', ticker: 'CCC', name: 'Gamma', latest_close_price: null, daily_change_percent: null },
  ];
  const valuationMap = new Map<string, ValuationSnapshot>([
    ['a', snapshot({ securityId: 'a', pe: 10, roe: 0.2 })],
    ['b', snapshot({ securityId: 'b', pe: 20, roe: null })],
    ['c', snapshot({ securityId: 'c', pe: null, roe: 0.05 })],
  ]);
  const emptyVolume = new Map<string, number | null>();

  it('sorts by a valuation field, nulls last', () => {
    const sorted = sortSecurities(rows, 'pe', 'asc', emptyVolume, valuationMap);
    expect(sorted.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('reverses direction for the same field', () => {
    const sorted = sortSecurities(rows, 'pe', 'desc', emptyVolume, valuationMap);
    expect(sorted.map((r) => r.id)).toEqual(['b', 'a', 'c']);
  });

  it('sorts by price with nulls last regardless of direction', () => {
    const asc = sortSecurities(rows, 'price', 'asc', emptyVolume, valuationMap);
    expect(asc.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    const desc = sortSecurities(rows, 'price', 'desc', emptyVolume, valuationMap);
    expect(desc.map((r) => r.id)).toEqual(['b', 'a', 'c']);
  });

  it('sorts roe with a null value (id "b") always last', () => {
    const sorted = sortSecurities(rows, 'roe', 'asc', emptyVolume, valuationMap);
    expect(sorted.at(-1)?.id).toBe('b');
  });
});
