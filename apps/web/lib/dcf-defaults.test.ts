import { describe, expect, it } from 'vitest';
import { deriveDcfDefaults } from './dcf-defaults';
import type { DcfHistoricalPeriod } from './dcf-inputs';

function period(overrides: Partial<DcfHistoricalPeriod> = {}): DcfHistoricalPeriod {
  return {
    periodEndDate: '2024-12-31',
    periodType: 'annual',
    interimPeriod: null,
    fiscalYear: 2024,
    publicationDate: '2025-02-15',
    revenue: 1000,
    revenueGrowth: 0.05,
    ebit: 200,
    ebitMargin: 0.2,
    ebitda: 250,
    depreciationAmortization: 50,
    taxExpense: 40,
    effectiveTaxRate: 0.25,
    operatingCashFlow: 220,
    capex: 60,
    workingCapital: -100,
    changeInWorkingCapital: 10,
    changeInWorkingCapitalSource: 'historical',
    cash: 300,
    totalDebt: 150,
    sharesOutstanding: 1_000_000,
    ...overrides,
  };
}

describe('deriveDcfDefaults', () => {
  it('takes the median of up to the last 3 annual periods for each ratio', () => {
    const periods = [
      period({ periodEndDate: '2021-12-31', revenueGrowth: 0.02, ebitMargin: 0.18 }),
      period({ periodEndDate: '2022-12-31', revenueGrowth: 0.04, ebitMargin: 0.19 }),
      period({ periodEndDate: '2023-12-31', revenueGrowth: 0.06, ebitMargin: 0.21 }),
      period({ periodEndDate: '2024-12-31', revenueGrowth: 0.08, ebitMargin: 0.22 }),
    ];
    const defaults = deriveDcfDefaults(periods);
    // Last 3: 0.04, 0.06, 0.08 -> median 0.06
    expect(defaults.revenueGrowth.value).toBeCloseTo(0.06, 10);
    expect(defaults.revenueGrowth.periodsUsed).toBe(3);
    expect(defaults.ebitMargin.value).toBeCloseTo(0.21, 10);
  });

  it('computes D&A / capex / change-in-NWC as % of revenue from the same recent periods', () => {
    const periods = [
      period({
        revenue: 1000,
        depreciationAmortization: 50,
        capex: 60,
        changeInWorkingCapital: 10,
      }),
    ];
    const defaults = deriveDcfDefaults(periods);
    expect(defaults.daPercentRevenue.value).toBeCloseTo(0.05, 10);
    expect(defaults.capexPercentRevenue.value).toBeCloseTo(0.06, 10);
    expect(defaults.changeNwcPercentRevenue.value).toBeCloseTo(0.01, 10);
  });

  it('derives the tax rate default from historical effective tax rate, not a hardcoded statutory rate', () => {
    const periods = [period({ effectiveTaxRate: 0.31 })];
    expect(deriveDcfDefaults(periods).taxRate.value).toBeCloseTo(0.31, 10);
  });

  it('ignores interim periods entirely (never blends interim and annual growth/margin scales)', () => {
    const periods = [
      period({ periodType: 'interim', interimPeriod: 'H1', revenueGrowth: 0.9, ebitMargin: 0.9 }),
      period({ periodType: 'annual', revenueGrowth: 0.05, ebitMargin: 0.2 }),
    ];
    const defaults = deriveDcfDefaults(periods);
    expect(defaults.revenueGrowth.value).toBeCloseTo(0.05, 10);
    expect(defaults.revenueGrowth.periodsUsed).toBe(1);
  });

  it('returns null with periodsUsed 0 when there is no historical data at all', () => {
    const defaults = deriveDcfDefaults([]);
    expect(defaults.revenueGrowth).toEqual({ value: null, periodsUsed: 0 });
    expect(defaults.taxRate).toEqual({ value: null, periodsUsed: 0 });
  });

  it('excludes null observations from the median rather than treating them as zero', () => {
    const periods = [
      period({ periodEndDate: '2022-12-31', revenueGrowth: null }),
      period({ periodEndDate: '2023-12-31', revenueGrowth: 0.1 }),
    ];
    const defaults = deriveDcfDefaults(periods);
    expect(defaults.revenueGrowth.value).toBeCloseTo(0.1, 10);
    expect(defaults.revenueGrowth.periodsUsed).toBe(1);
  });

  it('never returns a default for WACC or terminal growth (not part of the shape at all)', () => {
    const defaults = deriveDcfDefaults([period()]);
    expect(defaults).not.toHaveProperty('wacc');
    expect(defaults).not.toHaveProperty('terminalGrowth');
  });
});
