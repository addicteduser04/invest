import { describe, expect, it } from 'vitest';
import { computeExpectedLatestMarketDate, isMarketDateStale } from './staleness';

// All instants below are UTC; Africa/Casablanca is UTC+1 year-round (no DST since 2018),
// so e.g. 2026-08-31T18:00:00Z is 19:00 local time.

describe('computeExpectedLatestMarketDate', () => {
  it('expects the previous business day before the cutoff on a weekday', () => {
    // Monday 2026-08-31 08:00 local (before 19:30 cutoff) -> Friday 2026-08-28
    expect(computeExpectedLatestMarketDate(new Date('2026-08-31T07:00:00Z'))).toBe('2026-08-28');
  });

  it('expects today once past the cutoff on a weekday', () => {
    // Monday 2026-08-31 20:00 local (past 19:30 cutoff)
    expect(computeExpectedLatestMarketDate(new Date('2026-08-31T19:00:00Z'))).toBe('2026-08-31');
  });

  it('is exact at the cutoff boundary', () => {
    expect(computeExpectedLatestMarketDate(new Date('2026-08-31T18:30:00Z'))).toBe('2026-08-31');
    expect(computeExpectedLatestMarketDate(new Date('2026-08-31T18:29:00Z'))).toBe('2026-08-28');
  });

  it('never treats a weekend date itself as expected, before or after cutoff', () => {
    // Saturday 2026-09-05 morning and evening both expect Friday 2026-09-04
    expect(computeExpectedLatestMarketDate(new Date('2026-09-05T08:00:00Z'))).toBe('2026-09-04');
    expect(computeExpectedLatestMarketDate(new Date('2026-09-05T20:00:00Z'))).toBe('2026-09-04');
    // Sunday too
    expect(computeExpectedLatestMarketDate(new Date('2026-09-06T20:00:00Z'))).toBe('2026-09-04');
  });

  it('skips a full weekend when computing the previous business day before a Monday cutoff', () => {
    // Monday 2026-08-31 08:00 local, before cutoff -> walks back through Sun/Sat to Friday
    expect(computeExpectedLatestMarketDate(new Date('2026-08-31T07:00:00Z'))).toBe('2026-08-28');
  });
});

describe('isMarketDateStale', () => {
  it('is false when the latest date matches the expected date', () => {
    expect(isMarketDateStale('2026-08-31', new Date('2026-08-31T19:00:00Z'))).toBe(false);
  });

  it('is true when the latest date is older than expected', () => {
    expect(isMarketDateStale('2026-08-27', new Date('2026-08-31T19:00:00Z'))).toBe(true);
  });

  it('is false on a weekend for a Friday close, since weekends are not themselves expected', () => {
    expect(isMarketDateStale('2026-09-04', new Date('2026-09-05T12:00:00Z'))).toBe(false);
    expect(isMarketDateStale('2026-09-04', new Date('2026-09-06T12:00:00Z'))).toBe(false);
  });

  it('accepts a custom cutoff', () => {
    const noon = { hour: 12, minute: 0 };
    // 10:00Z = 11:00 local, before the noon cutoff -> expected is still Friday 2026-08-28
    expect(isMarketDateStale('2026-08-28', new Date('2026-08-31T10:00:00Z'), noon)).toBe(false);
    // 11:00Z = 12:00 local, at/after the noon cutoff -> expected becomes Monday 2026-08-31
    expect(isMarketDateStale('2026-08-28', new Date('2026-08-31T11:00:00Z'), noon)).toBe(true);
  });
});
