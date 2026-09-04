import type { ValuationSnapshot } from '@/lib/valuation-read';

/**
 * Pure filter/sort logic for the Stocks screener, kept separate from the page component so it
 * is directly unit-testable without a database or Next.js request context.
 */

export type SortMode =
  | 'ticker'
  | 'name'
  | 'price'
  | 'change'
  | 'volume'
  | 'marketCap'
  | 'pe'
  | 'pb'
  | 'evEbitda'
  | 'dividendYield'
  | 'revenueGrowth'
  | 'epsGrowth'
  | 'netMargin'
  | 'roe'
  | 'debtEquity';

export type SortDirection = 'asc' | 'desc';
export type ColumnGroup = 'none' | 'valuation' | 'growth' | 'quality' | 'balance';

export const SORT_MODES: SortMode[] = [
  'ticker',
  'name',
  'price',
  'change',
  'volume',
  'marketCap',
  'pe',
  'pb',
  'evEbitda',
  'dividendYield',
  'revenueGrowth',
  'epsGrowth',
  'netMargin',
  'roe',
  'debtEquity',
];
export const COLUMN_GROUPS: ColumnGroup[] = ['none', 'valuation', 'growth', 'quality', 'balance'];

export interface ValuationFilters {
  hasFundamentalsOnly: boolean;
  hasValuationOnly: boolean;
  peMax?: number | undefined;
  pbMax?: number | undefined;
  evEbitdaMax?: number | undefined;
  divYieldMin?: number | undefined;
  revGrowthMin?: number | undefined;
  epsGrowthMin?: number | undefined;
  netMarginMin?: number | undefined;
  roeMin?: number | undefined;
  debtEquityMax?: number | undefined;
}

export function hasAnyValuationFilter(filters: ValuationFilters): boolean {
  return (
    filters.hasFundamentalsOnly ||
    filters.hasValuationOnly ||
    filters.peMax !== undefined ||
    filters.pbMax !== undefined ||
    filters.evEbitdaMax !== undefined ||
    filters.divYieldMin !== undefined ||
    filters.revGrowthMin !== undefined ||
    filters.epsGrowthMin !== undefined ||
    filters.netMarginMin !== undefined ||
    filters.roeMin !== undefined ||
    filters.debtEquityMax !== undefined
  );
}

/** A missing filter value never excludes a row; a set filter always excludes a null metric --
 * null is never treated as if it were zero. */
export function matchesValuationFilters(
  snapshot: ValuationSnapshot | undefined,
  filters: ValuationFilters,
): boolean {
  if (!snapshot) return false;
  if (filters.hasFundamentalsOnly && !snapshot.hasFundamentals) return false;
  if (filters.hasValuationOnly && snapshot.marketCap === null) return false;
  if (filters.peMax !== undefined && (snapshot.pe === null || snapshot.pe > filters.peMax))
    return false;
  if (filters.pbMax !== undefined && (snapshot.pb === null || snapshot.pb > filters.pbMax))
    return false;
  if (
    filters.evEbitdaMax !== undefined &&
    (snapshot.evEbitda === null || snapshot.evEbitda > filters.evEbitdaMax)
  )
    return false;
  if (
    filters.divYieldMin !== undefined &&
    (snapshot.dividendYield === null || snapshot.dividendYield < filters.divYieldMin)
  )
    return false;
  if (
    filters.revGrowthMin !== undefined &&
    (snapshot.revenueGrowth === null || snapshot.revenueGrowth < filters.revGrowthMin)
  )
    return false;
  if (
    filters.epsGrowthMin !== undefined &&
    (snapshot.epsGrowth === null || snapshot.epsGrowth < filters.epsGrowthMin)
  )
    return false;
  if (
    filters.netMarginMin !== undefined &&
    (snapshot.netMargin === null || snapshot.netMargin < filters.netMarginMin)
  )
    return false;
  if (filters.roeMin !== undefined && (snapshot.roe === null || snapshot.roe < filters.roeMin))
    return false;
  if (
    filters.debtEquityMax !== undefined &&
    (snapshot.debtEquity === null || snapshot.debtEquity > filters.debtEquityMax)
  )
    return false;
  return true;
}

export function parseFilterNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Null/unavailable values always sort last, in either direction -- never treated as zero or as
 * an extreme that would otherwise flip to the front when the direction is reversed. */
export function compareForSort(
  leftValue: number | null,
  rightValue: number | null,
  direction: SortDirection,
): number {
  if (leftValue === null && rightValue === null) return 0;
  if (leftValue === null) return 1;
  if (rightValue === null) return -1;
  return direction === 'asc' ? leftValue - rightValue : rightValue - leftValue;
}

export function priorityRank(ticker: string): number {
  const rank = ['IAM', 'ATW', 'BCP'].indexOf(ticker);
  return rank === -1 ? 99 : rank;
}

export interface SortableSecurity {
  id: string;
  ticker: string;
  name: string;
  latest_close_price: string | number | null;
  daily_change_percent: string | number | null;
}

const toNum = (value: string | number | null | undefined): number | null => {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const VALUATION_SORT_FIELDS = [
  'marketCap',
  'pe',
  'pb',
  'evEbitda',
  'dividendYield',
  'revenueGrowth',
  'epsGrowth',
  'netMargin',
  'roe',
  'debtEquity',
] as const;
type ValuationSortMode = (typeof VALUATION_SORT_FIELDS)[number];

function isValuationSortMode(sort: SortMode): sort is ValuationSortMode {
  return (VALUATION_SORT_FIELDS as readonly string[]).includes(sort);
}

export function sortSecurities<T extends SortableSecurity>(
  rows: T[],
  sort: SortMode,
  direction: SortDirection,
  volumeBySecurity: Map<string, number | null>,
  valuationMap: Map<string, ValuationSnapshot>,
): T[] {
  return [...rows].sort((left, right) => {
    if (sort === 'name') {
      const cmp = left.name.localeCompare(right.name);
      return (direction === 'asc' ? cmp : -cmp) || left.ticker.localeCompare(right.ticker);
    }
    if (sort === 'ticker') {
      return (
        priorityRank(left.ticker) - priorityRank(right.ticker) ||
        left.ticker.localeCompare(right.ticker)
      );
    }
    if (isValuationSortMode(sort)) {
      const leftV = valuationMap.get(left.id);
      const rightV = valuationMap.get(right.id);
      return (
        compareForSort(leftV?.[sort] ?? null, rightV?.[sort] ?? null, direction) ||
        left.ticker.localeCompare(right.ticker)
      );
    }
    if (sort === 'change')
      return (
        compareForSort(toNum(left.daily_change_percent), toNum(right.daily_change_percent), direction) ||
        left.ticker.localeCompare(right.ticker)
      );
    if (sort === 'price')
      return (
        compareForSort(toNum(left.latest_close_price), toNum(right.latest_close_price), direction) ||
        left.ticker.localeCompare(right.ticker)
      );
    if (sort === 'volume') {
      const leftVolume = volumeBySecurity.get(left.id) ?? null;
      const rightVolume = volumeBySecurity.get(right.id) ?? null;
      return (
        compareForSort(leftVolume, rightVolume, direction) || left.ticker.localeCompare(right.ticker)
      );
    }
    return (
      priorityRank(left.ticker) - priorityRank(right.ticker) ||
      left.ticker.localeCompare(right.ticker)
    );
  });
}
