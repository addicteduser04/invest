/**
 * Structured DCF validation -- never throws a raw runtime error into the UI. Every field the
 * forecast engine needs is nullable here (the user may not have filled it in yet); this module's
 * job is to turn "missing/invalid" into a typed, explainable issue list before dcf-model.ts's
 * runDcf ever calls the pure projection function.
 */
export interface DcfAssumptionsInput {
  forecastYears: number | null;
  revenueGrowth: number | null;
  ebitMargin: number | null;
  taxRate: number | null;
  daPercentRevenue: number | null;
  capexPercentRevenue: number | null;
  changeNwcPercentRevenue: number | null;
  wacc: number | null;
  terminalGrowth: number | null;
}

export interface DcfBaseInputsInput {
  baseRevenue: number | null;
  cash: number | null;
  totalDebt: number | null;
  sharesOutstanding: number | null;
}

export type DcfValidationCode =
  | 'MISSING_BASE_REVENUE'
  | 'MISSING_SHARES_OUTSTANDING'
  | 'MISSING_WACC'
  | 'MISSING_TERMINAL_GROWTH'
  | 'WACC_NOT_ABOVE_TERMINAL_GROWTH'
  | 'INVALID_FORECAST_HORIZON'
  | 'NON_FINITE_ASSUMPTION'
  | 'NEGATIVE_SHARES'
  | 'MISSING_OPERATING_ASSUMPTION';

export interface DcfValidationIssue {
  code: DcfValidationCode;
  field: string;
  /** blocking: true means no projection can be computed at all. blocking: false means the
   * projection still runs, just with a specific output unavailable (e.g. per-share value). */
  blocking: boolean;
}

export const MIN_FORECAST_YEARS = 3;
export const MAX_FORECAST_YEARS = 10;
export const DEFAULT_FORECAST_YEARS = 5;

const OPERATING_ASSUMPTION_FIELDS: Array<[keyof DcfAssumptionsInput, string]> = [
  ['revenueGrowth', 'revenueGrowth'],
  ['ebitMargin', 'ebitMargin'],
  ['taxRate', 'taxRate'],
  ['daPercentRevenue', 'daPercentRevenue'],
  ['capexPercentRevenue', 'capexPercentRevenue'],
  ['changeNwcPercentRevenue', 'changeNwcPercentRevenue'],
];

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function validateDcfInputs(
  base: DcfBaseInputsInput,
  assumptions: DcfAssumptionsInput,
): DcfValidationIssue[] {
  const issues: DcfValidationIssue[] = [];

  if (base.baseRevenue === null) {
    issues.push({ code: 'MISSING_BASE_REVENUE', field: 'baseRevenue', blocking: true });
  } else if (!isFiniteNumber(base.baseRevenue)) {
    issues.push({ code: 'NON_FINITE_ASSUMPTION', field: 'baseRevenue', blocking: true });
  }

  if (assumptions.forecastYears === null || !Number.isInteger(assumptions.forecastYears)) {
    issues.push({ code: 'INVALID_FORECAST_HORIZON', field: 'forecastYears', blocking: true });
  } else if (
    assumptions.forecastYears < MIN_FORECAST_YEARS ||
    assumptions.forecastYears > MAX_FORECAST_YEARS
  ) {
    issues.push({ code: 'INVALID_FORECAST_HORIZON', field: 'forecastYears', blocking: true });
  }

  for (const [field, label] of OPERATING_ASSUMPTION_FIELDS) {
    const value = assumptions[field];
    if (value === null) {
      issues.push({ code: 'MISSING_OPERATING_ASSUMPTION', field: label, blocking: true });
    } else if (!isFiniteNumber(value)) {
      issues.push({ code: 'NON_FINITE_ASSUMPTION', field: label, blocking: true });
    }
  }

  if (assumptions.wacc === null) {
    issues.push({ code: 'MISSING_WACC', field: 'wacc', blocking: true });
  } else if (!isFiniteNumber(assumptions.wacc)) {
    issues.push({ code: 'NON_FINITE_ASSUMPTION', field: 'wacc', blocking: true });
  }

  if (assumptions.terminalGrowth === null) {
    issues.push({ code: 'MISSING_TERMINAL_GROWTH', field: 'terminalGrowth', blocking: true });
  } else if (!isFiniteNumber(assumptions.terminalGrowth)) {
    issues.push({ code: 'NON_FINITE_ASSUMPTION', field: 'terminalGrowth', blocking: true });
  }

  if (
    isFiniteNumber(assumptions.wacc) &&
    isFiniteNumber(assumptions.terminalGrowth) &&
    assumptions.wacc <= assumptions.terminalGrowth
  ) {
    issues.push({ code: 'WACC_NOT_ABOVE_TERMINAL_GROWTH', field: 'wacc', blocking: true });
  }

  // Shares outstanding only gates the per-share output, never the enterprise/equity value --
  // missing, zero and negative share counts are all "no valid per-share value", not a reason to
  // refuse the whole model.
  if (base.sharesOutstanding === null) {
    issues.push({
      code: 'MISSING_SHARES_OUTSTANDING',
      field: 'sharesOutstanding',
      blocking: false,
    });
  } else if (!isFiniteNumber(base.sharesOutstanding)) {
    issues.push({ code: 'NON_FINITE_ASSUMPTION', field: 'sharesOutstanding', blocking: false });
  } else if (base.sharesOutstanding < 0) {
    issues.push({ code: 'NEGATIVE_SHARES', field: 'sharesOutstanding', blocking: false });
  } else if (base.sharesOutstanding === 0) {
    issues.push({
      code: 'MISSING_SHARES_OUTSTANDING',
      field: 'sharesOutstanding',
      blocking: false,
    });
  }

  if (base.cash !== null && !isFiniteNumber(base.cash)) {
    issues.push({ code: 'NON_FINITE_ASSUMPTION', field: 'cash', blocking: true });
  }
  if (base.totalDebt !== null && !isFiniteNumber(base.totalDebt)) {
    issues.push({ code: 'NON_FINITE_ASSUMPTION', field: 'totalDebt', blocking: true });
  }

  return issues;
}
