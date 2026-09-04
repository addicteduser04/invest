/**
 * Safe, historical-data-derived DCF defaults only. WACC and terminal growth are deliberately
 * never produced here -- they must always be an explicit user assumption (see docs/DCF.md).
 * Reuses the same `median` helper the peer-comparison module already established (prefer median
 * over mean -- fewer periods, easily skewed by one unusual year).
 */
import { median } from '@/lib/peer-statistics';
import type { DcfHistoricalPeriod } from '@/lib/dcf-inputs';

export interface DcfDefaultReference {
  /** The suggested default, or null when there isn't enough historical data to suggest one. */
  value: number | null;
  /** How many historical periods the value was derived from (0 when value is null). */
  periodsUsed: number;
}

export interface DcfDefaults {
  revenueGrowth: DcfDefaultReference;
  ebitMargin: DcfDefaultReference;
  taxRate: DcfDefaultReference;
  daPercentRevenue: DcfDefaultReference;
  capexPercentRevenue: DcfDefaultReference;
  changeNwcPercentRevenue: DcfDefaultReference;
}

const LOOKBACK_PERIODS = 3;

function annualPeriods(periods: DcfHistoricalPeriod[]): DcfHistoricalPeriod[] {
  // Only annual periods: mixing interim growth/margin figures (computed against a different-size
  // base) into the same median would silently blend two incompatible scales.
  return periods.filter((p) => p.periodType === 'annual').slice(-LOOKBACK_PERIODS);
}

function medianOf(values: Array<number | null>): DcfDefaultReference {
  const finite = values.filter((v): v is number => v !== null && Number.isFinite(v));
  return { value: finite.length ? median(finite) : null, periodsUsed: finite.length };
}

function ratioToRevenue(period: DcfHistoricalPeriod, numerator: number | null): number | null {
  if (numerator === null || period.revenue === null || period.revenue === 0) return null;
  return numerator / period.revenue;
}

export function deriveDcfDefaults(periods: DcfHistoricalPeriod[]): DcfDefaults {
  const recent = annualPeriods(periods);
  return {
    revenueGrowth: medianOf(recent.map((p) => p.revenueGrowth)),
    ebitMargin: medianOf(recent.map((p) => p.ebitMargin)),
    taxRate: medianOf(recent.map((p) => p.effectiveTaxRate)),
    daPercentRevenue: medianOf(recent.map((p) => ratioToRevenue(p, p.depreciationAmortization))),
    capexPercentRevenue: medianOf(recent.map((p) => ratioToRevenue(p, p.capex))),
    changeNwcPercentRevenue: medianOf(recent.map((p) => ratioToRevenue(p, p.changeInWorkingCapital))),
  };
}
