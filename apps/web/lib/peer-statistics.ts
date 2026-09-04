/**
 * Pure descriptive statistics for peer-relative comparison: median/min/max/mean, rank, and a
 * rank-derived percentile. These are purely descriptive -- nothing here collapses a company's
 * standing across metrics into a single score. Null values are always excluded from a
 * computation rather than treated as zero.
 */

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

export function mean(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function minimum(values: number[]): number | null {
  return values.length ? Math.min(...values) : null;
}

export function maximum(values: number[]): number | null {
  return values.length ? Math.max(...values) : null;
}

export type RankDirection = 'asc' | 'desc';

export interface RankResult {
  rank: number;
  n: number;
}

/**
 * Ranks `targetId` among `entries` (which should include the target itself alongside its
 * peers). `direction` is purely descriptive labeling ("lower P/E shown as rank 1" vs "higher
 * ROE shown as rank 1") -- it has no bearing on whether a low or high rank is "good". Ties are
 * broken deterministically by `id` (ascending) so the same input always produces the same rank,
 * never an arbitrary one dependent on unstable sort order.
 */
export function computeRank(
  entries: Array<{ id: string; value: number }>,
  targetId: string,
  direction: RankDirection,
): RankResult | null {
  if (!entries.some((entry) => entry.id === targetId)) return null;
  const sorted = [...entries].sort((a, b) => {
    const diff = direction === 'asc' ? a.value - b.value : b.value - a.value;
    if (diff !== 0) return diff;
    return a.id.localeCompare(b.id);
  });
  const rank = sorted.findIndex((entry) => entry.id === targetId) + 1;
  return { rank, n: sorted.length };
}

/**
 * A rank-derived percentile: 100 for the best-ranked entry (rank 1), 0 for the worst, scaled
 * linearly in between. Null for a sample of 1 (or the target not being ranked) -- a percentile
 * among a sample of one is not a meaningful statement.
 */
export function percentileFromRank(rank: RankResult | null): number | null {
  if (!rank || rank.n <= 1) return null;
  return ((rank.n - rank.rank) / (rank.n - 1)) * 100;
}
