import { describe, expect, it } from 'vitest';
import {
  annualizedVolatility,
  averageVolume,
  offsetDate,
  periodCutoff,
  periodHighLow,
  periodReturn,
  rebaseToHundred,
} from './compare-metrics';

describe('rebaseToHundred', () => {
  it('rebases the first point to exactly 100 and preserves proportional moves', () => {
    const rebased = rebaseToHundred([
      { market_date: '2026-01-01', close_price: '100' },
      { market_date: '2026-01-02', close_price: '108.2' },
      { market_date: '2026-01-03', close_price: '97.8' },
    ]);
    expect(rebased[0]).toEqual({ market_date: '2026-01-01', value: 100 });
    expect(rebased[1]?.value).toBeCloseTo(108.2, 6);
    expect(rebased[2]?.value).toBeCloseTo(97.8, 6);
  });

  it('rebases from an arbitrary base price, not just 100', () => {
    const rebased = rebaseToHundred([
      { market_date: '2026-01-01', close_price: '50' },
      { market_date: '2026-01-02', close_price: '55' },
    ]);
    expect(rebased[0]?.value).toBe(100);
    expect(rebased[1]?.value).toBeCloseTo(110, 6);
  });

  it('sorts out-of-order input before rebasing so the earliest date is always the base', () => {
    const rebased = rebaseToHundred([
      { market_date: '2026-01-03', close_price: '120' },
      { market_date: '2026-01-01', close_price: '60' },
      { market_date: '2026-01-02', close_price: '90' },
    ]);
    expect(rebased.map((point) => point.market_date)).toEqual([
      '2026-01-01',
      '2026-01-02',
      '2026-01-03',
    ]);
    expect(rebased[0]?.value).toBe(100);
    expect(rebased[1]?.value).toBeCloseTo(150, 6);
    expect(rebased[2]?.value).toBeCloseTo(200, 6);
  });

  it('drops points with a non-finite close price instead of throwing', () => {
    const rebased = rebaseToHundred([
      { market_date: '2026-01-01', close_price: 'not-a-number' },
      { market_date: '2026-01-02', close_price: '100' },
      { market_date: '2026-01-03', close_price: '101' },
    ]);
    expect(rebased[0]).toEqual({ market_date: '2026-01-02', value: 100 });
    expect(rebased[1]?.value).toBeCloseTo(101, 6);
  });

  it('returns an empty series for empty input or a non-positive base price', () => {
    expect(rebaseToHundred([])).toEqual([]);
    expect(rebaseToHundred([{ market_date: '2026-01-01', close_price: '0' }])).toEqual([]);
    expect(rebaseToHundred([{ market_date: '2026-01-01', close_price: '-5' }])).toEqual([]);
  });
});

describe('periodCutoff / offsetDate', () => {
  it('computes YTD as January 1st of the latest date year', () => {
    expect(periodCutoff('YTD', '2026-08-31')).toBe('2026-01-01');
  });

  it('offsets calendar days across a UTC month boundary', () => {
    expect(offsetDate('2026-03-01', 1)).toBe('2026-02-28');
  });
});

describe('periodReturn', () => {
  const rows = [
    { market_date: '2025-08-01', close_price: '100' },
    { market_date: '2026-01-01', close_price: '110' },
    { market_date: '2026-08-31', close_price: '121' },
  ];

  it('computes percentage return from the first row on/after the cutoff to the last row', () => {
    expect(periodReturn(rows, 'YTD')).toBeCloseTo(10, 6);
  });

  it('spans the full available history when every row already falls inside the requested period', () => {
    expect(periodReturn(rows, '3Y')).toBeCloseTo(21, 6);
  });

  it('returns null for an empty series', () => {
    expect(periodReturn([], '1Y')).toBeNull();
  });
});

describe('annualizedVolatility', () => {
  it('returns null below 20 return observations', () => {
    const rows = Array.from({ length: 10 }, (_, index) => ({
      market_date: `2026-01-${String(index + 1).padStart(2, '0')}`,
      close_price: String(100 + index),
    }));
    expect(annualizedVolatility(rows)).toBeNull();
  });

  it('returns zero for a perfectly flat price series', () => {
    const rows = Array.from({ length: 25 }, (_, index) => ({
      market_date: `2026-01-${String(index + 1).padStart(2, '0')}`,
      close_price: '100',
    }));
    expect(annualizedVolatility(rows)).toBe(0);
  });
});

describe('periodHighLow / averageVolume', () => {
  it('finds the high and low close over the given rows', () => {
    const rows = [
      { market_date: '2026-01-01', close_price: '100' },
      { market_date: '2026-01-02', close_price: '120' },
      { market_date: '2026-01-03', close_price: '90' },
    ];
    expect(periodHighLow(rows)).toEqual({ high: 120, low: 90 });
  });

  it('returns nulls for an empty series', () => {
    expect(periodHighLow([])).toEqual({ high: null, low: null });
  });

  it('averages only rows with a finite volume', () => {
    const rows = [
      { market_date: '2026-01-01', close_price: '100', volume: '1000' },
      { market_date: '2026-01-02', close_price: '101', volume: null },
      { market_date: '2026-01-03', close_price: '102', volume: '3000' },
    ];
    expect(averageVolume(rows)).toBe(2000);
  });

  it('returns null when no row has a volume', () => {
    expect(averageVolume([{ market_date: '2026-01-01', close_price: '100' }])).toBeNull();
  });
});
