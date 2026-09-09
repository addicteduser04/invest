import { describe, expect, it } from 'vitest';
import {
  validateDcfInputs,
  type DcfAssumptionsInput,
  type DcfBaseInputsInput,
} from './dcf-validation';

const validBase: DcfBaseInputsInput = {
  baseRevenue: 1000,
  cash: 100,
  totalDebt: 200,
  sharesOutstanding: 100,
};
const validAssumptions: DcfAssumptionsInput = {
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

describe('validateDcfInputs', () => {
  it('returns no issues for a fully valid input', () => {
    expect(validateDcfInputs(validBase, validAssumptions)).toEqual([]);
  });

  it('flags missing base revenue as blocking', () => {
    const issues = validateDcfInputs({ ...validBase, baseRevenue: null }, validAssumptions);
    expect(issues).toContainEqual({
      code: 'MISSING_BASE_REVENUE',
      field: 'baseRevenue',
      blocking: true,
    });
  });

  it('flags missing WACC and missing terminal growth as blocking', () => {
    expect(validateDcfInputs(validBase, { ...validAssumptions, wacc: null })).toContainEqual({
      code: 'MISSING_WACC',
      field: 'wacc',
      blocking: true,
    });
    expect(
      validateDcfInputs(validBase, { ...validAssumptions, terminalGrowth: null }),
    ).toContainEqual({ code: 'MISSING_TERMINAL_GROWTH', field: 'terminalGrowth', blocking: true });
  });

  it('flags wacc <= terminal growth as blocking (equal and less-than)', () => {
    expect(
      validateDcfInputs(validBase, { ...validAssumptions, wacc: 0.05, terminalGrowth: 0.05 }),
    ).toContainEqual({ code: 'WACC_NOT_ABOVE_TERMINAL_GROWTH', field: 'wacc', blocking: true });
    expect(
      validateDcfInputs(validBase, { ...validAssumptions, wacc: 0.03, terminalGrowth: 0.05 }),
    ).toContainEqual({ code: 'WACC_NOT_ABOVE_TERMINAL_GROWTH', field: 'wacc', blocking: true });
  });

  it('does not flag wacc <= terminal growth when either is not yet provided', () => {
    const issues = validateDcfInputs(validBase, {
      ...validAssumptions,
      wacc: null,
      terminalGrowth: null,
    });
    expect(issues.some((i) => i.code === 'WACC_NOT_ABOVE_TERMINAL_GROWTH')).toBe(false);
  });

  it('flags an out-of-range or non-integer forecast horizon as blocking', () => {
    expect(validateDcfInputs(validBase, { ...validAssumptions, forecastYears: 2 })).toContainEqual({
      code: 'INVALID_FORECAST_HORIZON',
      field: 'forecastYears',
      blocking: true,
    });
    expect(validateDcfInputs(validBase, { ...validAssumptions, forecastYears: 11 })).toContainEqual(
      { code: 'INVALID_FORECAST_HORIZON', field: 'forecastYears', blocking: true },
    );
    expect(
      validateDcfInputs(validBase, { ...validAssumptions, forecastYears: 5.5 }),
    ).toContainEqual({ code: 'INVALID_FORECAST_HORIZON', field: 'forecastYears', blocking: true });
    expect(
      validateDcfInputs(validBase, { ...validAssumptions, forecastYears: null }),
    ).toContainEqual({ code: 'INVALID_FORECAST_HORIZON', field: 'forecastYears', blocking: true });
  });

  it('accepts the 3-10 year boundary inclusive', () => {
    expect(
      validateDcfInputs(validBase, { ...validAssumptions, forecastYears: 3 }).some(
        (i) => i.code === 'INVALID_FORECAST_HORIZON',
      ),
    ).toBe(false);
    expect(
      validateDcfInputs(validBase, { ...validAssumptions, forecastYears: 10 }).some(
        (i) => i.code === 'INVALID_FORECAST_HORIZON',
      ),
    ).toBe(false);
  });

  it('flags any missing operating assumption as blocking, one issue per missing field', () => {
    const issues = validateDcfInputs(validBase, {
      ...validAssumptions,
      revenueGrowth: null,
      ebitMargin: null,
    });
    expect(issues.filter((i) => i.code === 'MISSING_OPERATING_ASSUMPTION')).toHaveLength(2);
  });

  it('flags a non-finite assumption (NaN/Infinity) as blocking', () => {
    expect(
      validateDcfInputs(validBase, { ...validAssumptions, revenueGrowth: Number.NaN }),
    ).toContainEqual({ code: 'NON_FINITE_ASSUMPTION', field: 'revenueGrowth', blocking: true });
    expect(
      validateDcfInputs(validBase, { ...validAssumptions, wacc: Number.POSITIVE_INFINITY }),
    ).toContainEqual({ code: 'NON_FINITE_ASSUMPTION', field: 'wacc', blocking: true });
  });

  it('flags missing, zero and negative shares outstanding as non-blocking', () => {
    for (const shares of [null, 0]) {
      const issues = validateDcfInputs(
        { ...validBase, sharesOutstanding: shares },
        validAssumptions,
      );
      expect(issues).toContainEqual({
        code: 'MISSING_SHARES_OUTSTANDING',
        field: 'sharesOutstanding',
        blocking: false,
      });
    }
    const negative = validateDcfInputs({ ...validBase, sharesOutstanding: -10 }, validAssumptions);
    expect(negative).toContainEqual({
      code: 'NEGATIVE_SHARES',
      field: 'sharesOutstanding',
      blocking: false,
    });
    // None of the shares-related issues should block the rest of the model.
    expect(negative.some((i) => i.blocking)).toBe(false);
  });

  it('flags missing cash/debt as non-issues but non-finite cash/debt as blocking', () => {
    expect(
      validateDcfInputs({ ...validBase, cash: null, totalDebt: null }, validAssumptions),
    ).toEqual([]);
    expect(validateDcfInputs({ ...validBase, cash: Number.NaN }, validAssumptions)).toContainEqual({
      code: 'NON_FINITE_ASSUMPTION',
      field: 'cash',
      blocking: true,
    });
  });
});
