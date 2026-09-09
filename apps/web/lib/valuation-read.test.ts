import { describe, expect, it } from 'vitest';
import {
  buildValuationSnapshot,
  selectLatestUsablePeriod,
  type FundamentalsRow,
} from './valuation-read';

const NOW = new Date('2026-09-04T12:00:00Z');

function row(overrides: Partial<FundamentalsRow> & { id: string }): FundamentalsRow {
  return {
    security_id: 'sec-1',
    period_type: 'annual',
    interim_period: null,
    fiscal_year: 2025,
    period_end_date: '2025-12-31',
    publication_date: '2026-02-18',
    revenue: '1000',
    ebitda: '300',
    ebit: '250',
    net_income: '150',
    eps: '3',
    cash_and_equivalents: '400',
    total_debt: '200',
    total_assets: '2000',
    total_equity: '900',
    operating_cash_flow: '350',
    capex: '80',
    shares_outstanding: '50',
    dividend_per_share: '1',
    ...overrides,
  };
}

describe('selectLatestUsablePeriod', () => {
  it('picks the most recent period among those with a known, non-future publication date', () => {
    const older = row({ id: 'a', period_end_date: '2024-12-31', publication_date: '2025-02-10' });
    const newer = row({ id: 'b', period_end_date: '2025-12-31', publication_date: '2026-02-18' });
    expect(selectLatestUsablePeriod([older, newer], '2026-09-04')?.id).toBe('b');
  });

  it('does not let an unknown publication date outrank a known-published, chronologically earlier period', () => {
    const published = row({
      id: 'a',
      period_end_date: '2025-12-31',
      publication_date: '2026-02-18',
    });
    const unpublishedButLater = row({
      id: 'b',
      period_type: 'interim',
      interim_period: 'H1',
      period_end_date: '2026-06-30',
      publication_date: null,
    });
    expect(selectLatestUsablePeriod([published, unpublishedButLater], '2026-09-04')?.id).toBe('a');
  });

  it('excludes a period whose publication date is in the future', () => {
    const notYetPublished = row({ id: 'a', publication_date: '2026-12-01' });
    expect(selectLatestUsablePeriod([notYetPublished], '2026-09-04')).toBeNull();
  });

  it('returns null when no period has a known, non-future publication date', () => {
    const unknown = row({ id: 'a', publication_date: null });
    expect(selectLatestUsablePeriod([unknown], '2026-09-04')).toBeNull();
  });
});

describe('buildValuationSnapshot', () => {
  it('computes a full snapshot when price and a usable fundamentals period are both present', () => {
    const snapshot = buildValuationSnapshot(
      { id: 'sec-1', latestPrice: '120', priceDate: '2026-09-03' },
      [row({ id: 'a' })],
      NOW,
    );
    expect(snapshot.hasFundamentals).toBe(true);
    expect(snapshot.marketCap).toBe(120 * 50);
    expect(snapshot.pe).toBeCloseTo((120 * 50) / 150, 6);
    expect(snapshot.fundamentalsPeriod).toEqual({
      periodType: 'annual',
      interimPeriod: null,
      fiscalYear: 2025,
      periodEndDate: '2025-12-31',
      publicationDate: '2026-02-18',
    });
  });

  it('coerces a price delivered as a JSON number (PostgREST can serialize numeric either way) without throwing', () => {
    const snapshot = buildValuationSnapshot(
      { id: 'sec-1', latestPrice: 120, priceDate: '2026-09-03' },
      [row({ id: 'a' })],
      NOW,
    );
    expect(snapshot.price).toBe('120');
    expect(snapshot.marketCap).toBe(120 * 50);
  });

  it('flags a stale price without discarding it', () => {
    const snapshot = buildValuationSnapshot(
      { id: 'sec-1', latestPrice: '120', priceDate: '2025-01-01' },
      [row({ id: 'a' })],
      NOW,
    );
    expect(snapshot.priceStale).toBe(true);
    expect(snapshot.price).toBe('120');
  });

  it('is not stale for a fresh price date', () => {
    const snapshot = buildValuationSnapshot(
      { id: 'sec-1', latestPrice: '120', priceDate: '2026-09-03' },
      [row({ id: 'a' })],
      NOW,
    );
    expect(snapshot.priceStale).toBe(false);
  });

  it('has null ratios and hasFundamentals=false when no fundamentals period is usable', () => {
    const snapshot = buildValuationSnapshot(
      { id: 'sec-1', latestPrice: '120', priceDate: '2026-09-03' },
      [row({ id: 'a', publication_date: null })],
      NOW,
    );
    expect(snapshot.hasFundamentals).toBe(false);
    expect(snapshot.fundamentalsPeriod).toBeNull();
    expect(snapshot.marketCap).toBeNull();
    expect(snapshot.pe).toBeNull();
    expect(snapshot.roe).toBeNull();
  });

  it('has null price-derived ratios (but real fundamentals margins) when the price is missing', () => {
    const snapshot = buildValuationSnapshot(
      { id: 'sec-1', latestPrice: null, priceDate: null },
      [row({ id: 'a' })],
      NOW,
    );
    expect(snapshot.marketCap).toBeNull();
    expect(snapshot.pe).toBeNull();
    expect(snapshot.priceStale).toBe(false);
    expect(snapshot.netMargin).toBeCloseTo(0.15, 10);
  });

  it('has null market-cap-dependent ratios when shares outstanding is missing', () => {
    const snapshot = buildValuationSnapshot(
      { id: 'sec-1', latestPrice: '120', priceDate: '2026-09-03' },
      [row({ id: 'a', shares_outstanding: null })],
      NOW,
    );
    expect(snapshot.marketCap).toBeNull();
    expect(snapshot.pe).toBeNull();
    expect(snapshot.pb).toBeNull();
  });

  it('computes growth against the prior matching period regardless of that prior period’s own publication status', () => {
    const prior = row({
      id: 'p',
      period_end_date: '2024-12-31',
      publication_date: '2025-02-01',
      revenue: '800',
    });
    const latest = row({ id: 'a', revenue: '1000' });
    const snapshot = buildValuationSnapshot(
      { id: 'sec-1', latestPrice: '120', priceDate: '2026-09-03' },
      [prior, latest],
      NOW,
    );
    expect(snapshot.revenueGrowth).toBeCloseTo(0.25, 10);
  });
});
