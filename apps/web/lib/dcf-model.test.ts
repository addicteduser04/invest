import { describe, expect, it } from 'vitest';
import {
  projectDcf,
  runDcf,
  terminalValue,
  type DcfAssumptions,
  type DcfBaseInputs,
} from './dcf-model';
import type { DcfAssumptionsInput, DcfBaseInputsInput } from './dcf-validation';

// Hand-calculable fixture (also verified independently in a spreadsheet/calculator): revenue
// grows at exactly the WACC rate, so every year's PV(FCFF) collapses to the same constant
// (FCFF_1 / (1 + WACC) = 130.0), which makes every intermediate number easy to check by hand.
// year | revenue  | EBIT   | tax   | NOPAT  | D&A   | capex | dNWC  | FCFF    | PV(FCFF)
//   1  | 1100.00  | 220.00 | 55.00 | 165.00 | 55.00 | 66.00 | 11.00 | 143.000 | 130.000
//   2  | 1210.00  | 242.00 | 60.50 | 181.50 | 60.50 | 72.60 | 12.10 | 157.300 | 130.000
//   3  | 1331.00  | 266.20 | 66.55 | 199.65 | 66.55 | 79.86 | 13.31 | 173.030 | 130.000
//   4  | 1464.10  | 292.82 | 73.21 | 219.62 | 73.21 | 87.85 | 14.64 | 190.333 | 130.000
//   5  | 1610.51  | 322.10 | 80.53 | 241.58 | 80.53 | 96.63 | 16.11 | 209.366 | 130.000
// PV(forecast) = 650.000; TV = 209.3663*1.02/0.08 = 2669.420325; PV(TV) = 1657.500
// EV = 2307.500; net debt = 200-100 = 100; equity = 2207.500; per share = 22.075
const baseInputs: DcfBaseInputs = {
  baseRevenue: 1000,
  cash: 100,
  totalDebt: 200,
  sharesOutstanding: 100,
};
const assumptions5y: DcfAssumptions = {
  forecastYears: 5,
  revenueGrowth: 0.1,
  ebitMargin: 0.2,
  taxRate: 0.25,
  daPercentRevenue: 0.05,
  capexPercentRevenue: 0.06,
  changeNwcPercentRevenue: 0.01,
  wacc: 0.1,
  terminalGrowth: 0.02,
};

describe('projectDcf -- 5-year hand-calculable fixture', () => {
  const result = projectDcf(baseInputs, assumptions5y);

  it('produces 5 forecast years with the expected revenue/EBIT/NOPAT/D&A/capex/NWC/FCFF path', () => {
    expect(result.years).toHaveLength(5);
    expect(result.years[0]).toMatchObject({ year: 1, revenue: 1100 });
    expect(result.years[0]!.ebit).toBeCloseTo(220, 6);
    expect(result.years[0]!.tax).toBeCloseTo(55, 6);
    expect(result.years[0]!.nopat).toBeCloseTo(165, 6);
    expect(result.years[0]!.da).toBeCloseTo(55, 6);
    expect(result.years[0]!.capex).toBeCloseTo(66, 6);
    expect(result.years[0]!.changeInNwc).toBeCloseTo(11, 6);
    expect(result.years[0]!.fcff).toBeCloseTo(143, 6);

    expect(result.years[4]!.revenue).toBeCloseTo(1610.51, 6);
    expect(result.years[4]!.ebit).toBeCloseTo(322.102, 6);
    expect(result.years[4]!.fcff).toBeCloseTo(209.3663, 4);
  });

  it('computes discount factors as 1/(1+wacc)^t and a constant PV(FCFF) given growth == wacc', () => {
    expect(result.years[0]!.discountFactor).toBeCloseTo(1 / 1.1, 10);
    expect(result.years[4]!.discountFactor).toBeCloseTo(1 / 1.1 ** 5, 10);
    for (const year of result.years) {
      expect(year.presentValueFcff).toBeCloseTo(130, 4);
    }
  });

  it('sums PV(FCFF) correctly', () => {
    expect(result.presentValueForecast).toBeCloseTo(650, 3);
  });

  it('computes Gordon Growth terminal value and its present value', () => {
    expect(result.terminalValue).toBeCloseTo(2669.420325, 3);
    expect(result.presentValueTerminalValue).toBeCloseTo(1657.5, 2);
    expect(terminalValue(209.3663, 0.1, 0.02)).toBeCloseTo(2669.420325, 3);
  });

  it('bridges enterprise value to equity value to per-share value', () => {
    expect(result.enterpriseValue).toBeCloseTo(2307.5, 2);
    expect(result.netDebt).toBeCloseTo(100, 6);
    expect(result.equityValue).toBeCloseTo(2207.5, 2);
    expect(result.valuePerShare).toBeCloseTo(22.075, 3);
  });

  it('reports terminal value as a share of enterprise value', () => {
    expect(result.terminalValueShareOfEv).toBeCloseTo(1657.5 / 2307.5, 4);
  });
});

describe('projectDcf -- 1-year projection', () => {
  it('matches the hand-calculable 1-year fixture', () => {
    const result = projectDcf(baseInputs, { ...assumptions5y, forecastYears: 1 });
    expect(result.years).toHaveLength(1);
    expect(result.years[0]!.fcff).toBeCloseTo(143, 6);
    expect(result.presentValueForecast).toBeCloseTo(130, 6);
    expect(result.terminalValue).toBeCloseTo(1823.25, 2);
    expect(result.presentValueTerminalValue).toBeCloseTo(1657.5, 2);
    expect(result.enterpriseValue).toBeCloseTo(1787.5, 2);
    expect(result.equityValue).toBeCloseTo(1687.5, 2);
    expect(result.valuePerShare).toBeCloseTo(16.875, 3);
  });
});

describe('projectDcf -- edge cases', () => {
  it('does not credit a tax benefit on a forecast operating loss (tax is clamped at 0, not negative)', () => {
    const result = projectDcf(baseInputs, { ...assumptions5y, ebitMargin: -0.5 });
    expect(result.years[0]!.ebit).toBeLessThan(0);
    expect(result.years[0]!.tax).toBe(0);
    expect(result.years[0]!.nopat).toBe(result.years[0]!.ebit);
    expect(Number.isFinite(result.years[0]!.fcff)).toBe(true);
  });

  it('allows negative FCFF without crashing', () => {
    const result = projectDcf(baseInputs, {
      ...assumptions5y,
      ebitMargin: 0.02,
      capexPercentRevenue: 0.3,
    });
    expect(result.years[0]!.fcff).toBeLessThan(0);
    expect(Number.isFinite(result.enterpriseValue)).toBe(true);
  });

  it('handles a net-cash position (negative net debt) by adding the surplus to equity value', () => {
    const result = projectDcf({ ...baseInputs, cash: 500, totalDebt: 50 }, assumptions5y);
    expect(result.netDebt).toBeCloseTo(-450, 6);
    expect(result.equityValue).toBeCloseTo(result.enterpriseValue + 450, 6);
  });

  it('returns a null per-share value when shares outstanding is null, without failing the rest of the model', () => {
    const result = projectDcf({ ...baseInputs, sharesOutstanding: null }, assumptions5y);
    expect(result.valuePerShare).toBeNull();
    expect(Number.isFinite(result.equityValue)).toBe(true);
  });

  it('treats missing cash/debt as zero (never null-propagates the whole bridge)', () => {
    const result = projectDcf({ ...baseInputs, cash: null, totalDebt: null }, assumptions5y);
    expect(result.cash).toBe(0);
    expect(result.totalDebt).toBe(0);
    expect(result.netDebt).toBe(0);
    expect(result.equityValue).toBeCloseTo(result.enterpriseValue, 6);
  });
});

const validInput: DcfBaseInputsInput = {
  baseRevenue: 1000,
  cash: 100,
  totalDebt: 200,
  sharesOutstanding: 100,
};
const validAssumptionsInput: DcfAssumptionsInput = {
  forecastYears: 5,
  revenueGrowth: 0.1,
  ebitMargin: 0.2,
  taxRate: 0.25,
  daPercentRevenue: 0.05,
  capexPercentRevenue: 0.06,
  changeNwcPercentRevenue: 0.01,
  wacc: 0.1,
  terminalGrowth: 0.02,
};

describe('runDcf', () => {
  it('is valid and matches projectDcf for the same fixture', () => {
    const run = runDcf(validInput, validAssumptionsInput);
    expect(run.valid).toBe(true);
    expect(run.result?.valuePerShare).toBeCloseTo(22.075, 3);
  });

  it('is invalid and returns no result when wacc <= terminal growth', () => {
    const run = runDcf(validInput, { ...validAssumptionsInput, wacc: 0.02, terminalGrowth: 0.02 });
    expect(run.valid).toBe(false);
    expect(run.result).toBeNull();
    expect(run.issues.some((i) => i.code === 'WACC_NOT_ABOVE_TERMINAL_GROWTH')).toBe(true);
  });

  it('is still valid (with a non-blocking issue) when shares outstanding is missing', () => {
    const run = runDcf({ ...validInput, sharesOutstanding: null }, validAssumptionsInput);
    expect(run.valid).toBe(true);
    expect(run.result?.valuePerShare).toBeNull();
    expect(run.issues).toEqual([
      { code: 'MISSING_SHARES_OUTSTANDING', field: 'sharesOutstanding', blocking: false },
    ]);
  });
});
