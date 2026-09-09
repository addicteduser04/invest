import { describe, expect, it } from 'vitest';
import { buildDcfHistoricalInputs, type FundamentalsRow } from './dcf-inputs';

function row(overrides: Partial<FundamentalsRow> = {}): FundamentalsRow {
  return {
    id: overrides.id ?? 'row-1',
    security_id: 'sec-1',
    period_type: 'annual',
    interim_period: null,
    fiscal_year: 2024,
    period_end_date: '2024-12-31',
    publication_date: '2025-02-15',
    revenue: '1000',
    ebitda: '300',
    ebit: '250',
    net_income: '150',
    eps: '1.5',
    cash_and_equivalents: '400',
    total_debt: '200',
    total_assets: '2000',
    total_equity: '900',
    operating_cash_flow: '350',
    capex: '80',
    shares_outstanding: '1000000',
    dividend_per_share: '0.5',
    depreciation_amortization: '100',
    tax_expense: '50',
    working_capital: '-200',
    change_in_working_capital: null,
    ...overrides,
  };
}

const TODAY = '2026-09-04';

describe('buildDcfHistoricalInputs', () => {
  it('sorts periods ascending and computes revenue growth / EBIT margin / effective tax rate for each', () => {
    const rows = [
      row({
        id: 'y1',
        period_end_date: '2023-12-31',
        publication_date: '2024-02-01',
        revenue: '1000',
        ebit: '200',
        net_income: '120',
        tax_expense: '40',
      }),
      row({
        id: 'y2',
        period_end_date: '2024-12-31',
        publication_date: '2025-02-01',
        revenue: '1100',
        ebit: '230',
        net_income: '135',
        tax_expense: '45',
      }),
    ];
    const inputs = buildDcfHistoricalInputs('sec-1', rows, TODAY);
    expect(inputs.periods.map((p) => p.periodEndDate)).toEqual(['2023-12-31', '2024-12-31']);
    expect(inputs.periods[0]!.revenueGrowth).toBeNull(); // no prior period
    expect(inputs.periods[1]!.revenueGrowth).toBeCloseTo(0.1, 10);
    expect(inputs.periods[0]!.ebitMargin).toBeCloseTo(0.2, 10);
    expect(inputs.periods[0]!.effectiveTaxRate).toBeCloseTo(40 / 160, 10);
  });

  it('prefers a directly reported change_in_working_capital over deriving one', () => {
    const rows = [
      row({
        id: 'y1',
        period_end_date: '2023-12-31',
        working_capital: '-200',
        change_in_working_capital: null,
      }),
      row({
        id: 'y2',
        period_end_date: '2024-12-31',
        working_capital: '-150',
        change_in_working_capital: '999',
      }),
    ];
    const inputs = buildDcfHistoricalInputs('sec-1', rows, TODAY);
    expect(inputs.periods[1]!.changeInWorkingCapital).toBe(999);
    expect(inputs.periods[1]!.changeInWorkingCapitalSource).toBe('historical');
  });

  it('derives change in working capital from consecutive same-period-type working_capital when not directly reported', () => {
    const rows = [
      row({
        id: 'y1',
        period_end_date: '2023-12-31',
        working_capital: '-200',
        change_in_working_capital: null,
      }),
      row({
        id: 'y2',
        period_end_date: '2024-12-31',
        working_capital: '-150',
        change_in_working_capital: null,
      }),
    ];
    const inputs = buildDcfHistoricalInputs('sec-1', rows, TODAY);
    expect(inputs.periods[1]!.changeInWorkingCapital).toBeCloseTo(50, 10);
    expect(inputs.periods[1]!.changeInWorkingCapitalSource).toBe('derived');
  });

  it('does not derive change in working capital across an interim/annual mismatch', () => {
    const rows = [
      row({
        id: 'h1',
        period_type: 'interim',
        interim_period: 'H1',
        period_end_date: '2024-06-30',
        working_capital: '-180',
        change_in_working_capital: null,
      }),
      row({
        id: 'y2',
        period_type: 'annual',
        interim_period: null,
        period_end_date: '2024-12-31',
        working_capital: '-150',
        change_in_working_capital: null,
      }),
    ];
    const inputs = buildDcfHistoricalInputs('sec-1', rows, TODAY);
    const annual = inputs.periods.find((p) => p.periodType === 'annual')!;
    expect(annual.changeInWorkingCapital).toBeNull();
    expect(annual.changeInWorkingCapitalSource).toBeNull();
  });

  it('leaves changeInWorkingCapital null (never 0) when there is no prior period at all', () => {
    const inputs = buildDcfHistoricalInputs('sec-1', [row({ working_capital: '-200' })], TODAY);
    expect(inputs.periods[0]!.changeInWorkingCapital).toBeNull();
  });

  it('picks the PIT-usable base period, excluding an unpublished future/interim row', () => {
    const rows = [
      row({
        id: 'fy2025',
        period_end_date: '2025-12-31',
        publication_date: '2026-02-18',
        fiscal_year: 2025,
      }),
      row({
        id: 'h1-2026',
        period_type: 'interim',
        interim_period: 'H1',
        period_end_date: '2026-06-30',
        publication_date: null,
        fiscal_year: 2026,
      }),
    ];
    const inputs = buildDcfHistoricalInputs('sec-1', rows, TODAY);
    expect(inputs.basePeriod?.periodEndDate).toBe('2025-12-31');
    expect(inputs.basePeriod?.fiscalYear).toBe(2025);
  });

  it('returns a null base period when no period has a known, non-future publication date', () => {
    const rows = [row({ publication_date: null })];
    const inputs = buildDcfHistoricalInputs('sec-1', rows, TODAY);
    expect(inputs.basePeriod).toBeNull();
  });

  it('returns an empty period list and null base period for a security with no fundamentals rows', () => {
    const inputs = buildDcfHistoricalInputs('sec-1', [], TODAY);
    expect(inputs.periods).toEqual([]);
    expect(inputs.basePeriod).toBeNull();
  });
});
