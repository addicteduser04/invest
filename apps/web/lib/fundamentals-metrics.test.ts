import { describe, expect, it } from 'vitest';
import {
  debtToEquity,
  ebitMargin,
  ebitdaMargin,
  epsGrowth,
  fcfMargin,
  freeCashFlow,
  netDebt,
  netIncomeGrowth,
  netMargin,
  revenueGrowth,
  roe,
  type FundamentalsFigures,
} from './fundamentals-metrics';

const nullFigures: FundamentalsFigures = {
  revenue: null,
  ebitda: null,
  ebit: null,
  netIncome: null,
  eps: null,
  cashAndEquivalents: null,
  totalDebt: null,
  totalAssets: null,
  totalEquity: null,
  operatingCashFlow: null,
  capex: null,
  sharesOutstanding: null,
  dividendPerShare: null,
};

const figures = (overrides: Partial<FundamentalsFigures>): FundamentalsFigures => ({
  ...nullFigures,
  ...overrides,
});

describe('freeCashFlow', () => {
  it('subtracts capex (a non-negative magnitude) from operating cash flow', () => {
    expect(freeCashFlow(figures({ operatingCashFlow: '500', capex: '120' }))).toBe(380);
  });
  it('is null when either input is missing', () => {
    expect(freeCashFlow(figures({ operatingCashFlow: '500' }))).toBeNull();
    expect(freeCashFlow(figures({ capex: '120' }))).toBeNull();
  });
  it('handles a negative operating cash flow correctly', () => {
    expect(freeCashFlow(figures({ operatingCashFlow: '-100', capex: '20' }))).toBe(-120);
  });
});

describe('margins', () => {
  it('computes EBITDA, EBIT, net and FCF margins', () => {
    const f = figures({ revenue: '1000', ebitda: '300', ebit: '250', netIncome: '150' });
    expect(ebitdaMargin(f)).toBeCloseTo(0.3, 10);
    expect(ebitMargin(f)).toBeCloseTo(0.25, 10);
    expect(netMargin(f)).toBeCloseTo(0.15, 10);
  });
  it('computes FCF margin via freeCashFlow', () => {
    const f = figures({ revenue: '1000', operatingCashFlow: '400', capex: '100' });
    expect(fcfMargin(f)).toBeCloseTo(0.3, 10);
  });
  it('is null when revenue is missing or exactly zero', () => {
    expect(netMargin(figures({ netIncome: '150' }))).toBeNull();
    expect(netMargin(figures({ revenue: '0', netIncome: '150' }))).toBeNull();
  });
  it('produces a negative margin for a loss-making period without nulling it out', () => {
    expect(netMargin(figures({ revenue: '1000', netIncome: '-80' }))).toBeCloseTo(-0.08, 10);
  });
});

describe('debtToEquity and netDebt', () => {
  it('computes debt/equity', () => {
    expect(debtToEquity(figures({ totalDebt: '400', totalEquity: '800' }))).toBeCloseTo(0.5, 10);
  });
  it('is null when equity is exactly zero', () => {
    expect(debtToEquity(figures({ totalDebt: '400', totalEquity: '0' }))).toBeNull();
  });
  it('computes net debt as debt minus cash, allowing a negative (net cash) result', () => {
    expect(netDebt(figures({ totalDebt: '400', cashAndEquivalents: '900' }))).toBe(-500);
  });
});

describe('roe', () => {
  it('computes ROE for positive equity', () => {
    expect(roe(figures({ netIncome: '150', totalEquity: '1000' }))).toBeCloseTo(0.15, 10);
  });
  it('is still computed (not nulled) when equity is negative -- no naive positivity gate', () => {
    expect(roe(figures({ netIncome: '150', totalEquity: '-1000' }))).toBeCloseTo(-0.15, 10);
  });
  it('is null only when equity is exactly zero or an input is missing', () => {
    expect(roe(figures({ netIncome: '150', totalEquity: '0' }))).toBeNull();
    expect(roe(figures({ totalEquity: '1000' }))).toBeNull();
  });
});

describe('growth rates', () => {
  it('computes YoY revenue, net income and EPS growth', () => {
    expect(revenueGrowth(figures({ revenue: '1100' }), figures({ revenue: '1000' }))).toBeCloseTo(
      0.1,
      10,
    );
    expect(
      netIncomeGrowth(figures({ netIncome: '90' }), figures({ netIncome: '100' })),
    ).toBeCloseTo(-0.1, 10);
    expect(epsGrowth(figures({ eps: '2.2' }), figures({ eps: '2' }))).toBeCloseTo(0.1, 10);
  });
  it('divides by the absolute prior value so a swing from a loss to a profit is directional, not undefined', () => {
    expect(
      netIncomeGrowth(figures({ netIncome: '50' }), figures({ netIncome: '-100' })),
    ).toBeCloseTo(1.5, 10);
  });
  it('is null when there is no prior period or the prior value is missing/zero', () => {
    expect(revenueGrowth(figures({ revenue: '1100' }), null)).toBeNull();
    expect(revenueGrowth(figures({ revenue: '1100' }), figures({ revenue: null }))).toBeNull();
    expect(revenueGrowth(figures({ revenue: '1100' }), figures({ revenue: '0' }))).toBeNull();
  });
});
