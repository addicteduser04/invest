import { describe, expect, it } from 'vitest';
import { computeRank, maximum, mean, median, minimum, percentileFromRank } from './peer-statistics';

describe('median', () => {
  it('is the middle value for an odd count', () => {
    expect(median([1, 5, 3])).toBe(3);
  });
  it('is the average of the two middle values for an even count', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
  it('is the value itself for a single-element sample', () => {
    expect(median([7])).toBe(7);
  });
  it('is null for an empty sample (never computed from null/missing values)', () => {
    expect(median([])).toBeNull();
  });
  it('does not mutate the input array', () => {
    const input = [3, 1, 2];
    median(input);
    expect(input).toEqual([3, 1, 2]);
  });
});

describe('mean/minimum/maximum', () => {
  it('computes mean, min, and max', () => {
    expect(mean([1, 2, 3])).toBe(2);
    expect(minimum([5, 1, 9])).toBe(1);
    expect(maximum([5, 1, 9])).toBe(9);
  });
  it('are null for an empty sample', () => {
    expect(mean([])).toBeNull();
    expect(minimum([])).toBeNull();
    expect(maximum([])).toBeNull();
  });
});

describe('computeRank', () => {
  it('ranks ascending (lowest value = rank 1)', () => {
    const entries = [
      { id: 'a', value: 20 },
      { id: 'b', value: 10 },
      { id: 'c', value: 30 },
    ];
    expect(computeRank(entries, 'b', 'asc')).toEqual({ rank: 1, n: 3 });
    expect(computeRank(entries, 'a', 'asc')).toEqual({ rank: 2, n: 3 });
    expect(computeRank(entries, 'c', 'asc')).toEqual({ rank: 3, n: 3 });
  });

  it('ranks descending (highest value = rank 1)', () => {
    const entries = [
      { id: 'a', value: 20 },
      { id: 'b', value: 10 },
      { id: 'c', value: 30 },
    ];
    expect(computeRank(entries, 'c', 'desc')).toEqual({ rank: 1, n: 3 });
    expect(computeRank(entries, 'a', 'desc')).toEqual({ rank: 2, n: 3 });
    expect(computeRank(entries, 'b', 'desc')).toEqual({ rank: 3, n: 3 });
  });

  it('breaks ties deterministically by id, regardless of input order', () => {
    const entries = [
      { id: 'z', value: 10 },
      { id: 'a', value: 10 },
      { id: 'm', value: 10 },
    ];
    // 'a' < 'm' < 'z' lexically -- the tiebreak must always resolve the same way.
    expect(computeRank(entries, 'a', 'asc')).toEqual({ rank: 1, n: 3 });
    expect(computeRank(entries, 'm', 'asc')).toEqual({ rank: 2, n: 3 });
    expect(computeRank(entries, 'z', 'asc')).toEqual({ rank: 3, n: 3 });

    const reordered = [...entries].reverse();
    expect(computeRank(reordered, 'a', 'asc')).toEqual({ rank: 1, n: 3 });
    expect(computeRank(reordered, 'm', 'asc')).toEqual({ rank: 2, n: 3 });
    expect(computeRank(reordered, 'z', 'asc')).toEqual({ rank: 3, n: 3 });
  });

  it('is null when the target is not present among the entries', () => {
    const entries = [{ id: 'a', value: 20 }];
    expect(computeRank(entries, 'missing', 'asc')).toBeNull();
  });

  it('ranks a single-element sample as 1/1', () => {
    expect(computeRank([{ id: 'a', value: 5 }], 'a', 'asc')).toEqual({ rank: 1, n: 1 });
  });
});

describe('percentileFromRank', () => {
  it('is 100 for the best rank and 0 for the worst', () => {
    expect(percentileFromRank({ rank: 1, n: 5 })).toBe(100);
    expect(percentileFromRank({ rank: 5, n: 5 })).toBe(0);
  });
  it('scales linearly in between', () => {
    expect(percentileFromRank({ rank: 2, n: 5 })).toBeCloseTo(75, 10);
    expect(percentileFromRank({ rank: 3, n: 5 })).toBeCloseTo(50, 10);
  });
  it('handles a tie at rank 1 among several the same way as any rank-1 entry', () => {
    expect(percentileFromRank({ rank: 1, n: 3 })).toBe(100);
  });
  it('is null for a single-element sample (no meaningful percentile among one)', () => {
    expect(percentileFromRank({ rank: 1, n: 1 })).toBeNull();
  });
  it('is null when there is no rank at all', () => {
    expect(percentileFromRank(null)).toBeNull();
  });
});
