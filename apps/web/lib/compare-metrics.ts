export type ComparePeriod = '1M' | '3M' | 'YTD' | '1Y' | '3Y';

export const MAX_COMPARE_SECURITIES = 4;

export interface ComparePricePoint {
  market_date: string;
  close_price: string;
  volume?: string | null;
}

export const comparePeriods: readonly ComparePeriod[] = ['1M', '3M', 'YTD', '1Y', '3Y'];

const periodDays: Record<Exclude<ComparePeriod, 'YTD'>, number> = {
  '1M': 31,
  '3M': 93,
  '1Y': 366,
  '3Y': 1098,
};

export function offsetDate(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - days);
  return value.toISOString().slice(0, 10);
}

export function periodCutoff(period: ComparePeriod, latestDate: string) {
  if (period === 'YTD') return `${latestDate.slice(0, 4)}-01-01`;
  return offsetDate(latestDate, periodDays[period]);
}

/**
 * Rebases a chronologically ordered price series so the first point equals
 * exactly 100, preserving each later point's proportional move relative to
 * that start (e.g. a security up 8.2% over the window becomes 108.2). Each
 * series is rebased independently against its own first available point.
 */
export function rebaseToHundred(
  points: readonly ComparePricePoint[],
): Array<{ market_date: string; value: number }> {
  const ordered = points
    .filter((point) => Number.isFinite(Number(point.close_price)))
    .slice()
    .sort((a, b) => a.market_date.localeCompare(b.market_date));
  const base = Number(ordered[0]?.close_price);
  if (!ordered.length || !Number.isFinite(base) || base <= 0) return [];
  return ordered.map((point) => ({
    market_date: point.market_date,
    value: (Number(point.close_price) / base) * 100,
  }));
}

/** Percentage return from the first row on/after the period cutoff to the last row. */
export function periodReturn(rows: readonly ComparePricePoint[], period: ComparePeriod) {
  const ordered = rows
    .filter((row) => Number.isFinite(Number(row.close_price)))
    .slice()
    .sort((a, b) => a.market_date.localeCompare(b.market_date));
  const last = ordered.at(-1);
  if (!last) return null;
  const cutoff = periodCutoff(period, last.market_date);
  const start =
    ordered.find((row) => row.market_date >= cutoff) ?? (period === '3Y' ? ordered[0] : null);
  if (!start || Number(start.close_price) <= 0) return null;
  return (Number(last.close_price) / Number(start.close_price) - 1) * 100;
}

/** Annualized volatility (%) from daily close-to-close returns; null below 20 observations. */
export function annualizedVolatility(rows: readonly ComparePricePoint[]) {
  const ordered = rows
    .filter((row) => Number.isFinite(Number(row.close_price)))
    .slice()
    .sort((a, b) => a.market_date.localeCompare(b.market_date));
  const returns: number[] = [];
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = Number(ordered[index - 1]?.close_price);
    const current = Number(ordered[index]?.close_price);
    if (previous > 0 && Number.isFinite(current)) returns.push(current / previous - 1);
  }
  if (returns.length < 20) return null;
  const average = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + (value - average) ** 2, 0) / returns.length;
  return Math.sqrt(variance) * Math.sqrt(252) * 100;
}

export function periodHighLow(rows: readonly ComparePricePoint[]) {
  const values = rows.map((row) => Number(row.close_price)).filter(Number.isFinite);
  if (!values.length) return { high: null as number | null, low: null as number | null };
  return { high: Math.max(...values), low: Math.min(...values) };
}

export function averageVolume(rows: readonly ComparePricePoint[]) {
  const values = rows
    .map((row) => (row.volume === null || row.volume === undefined ? null : Number(row.volume)))
    .filter((value): value is number => value !== null && Number.isFinite(value));
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
