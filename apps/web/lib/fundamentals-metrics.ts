/**
 * Pure derived-metrics helpers for fundamentals. Every function returns null (never throws,
 * never guesses) when a required input is missing or a denominator is exactly zero -- growth
 * and margin figures can legitimately be negative and must never be silently zeroed out.
 */
export interface FundamentalsFigures {
  revenue: string | null;
  ebitda: string | null;
  ebit: string | null;
  netIncome: string | null;
  eps: string | null;
  cashAndEquivalents: string | null;
  totalDebt: string | null;
  totalAssets: string | null;
  totalEquity: string | null;
  operatingCashFlow: string | null;
  capex: string | null;
  sharesOutstanding: string | null;
  dividendPerShare: string | null;
}

const toNumber = (value: string | null | undefined): number | null => {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const ratio = (numerator: number | null, denominator: number | null): number | null => {
  if (numerator === null || denominator === null || denominator === 0) return null;
  return numerator / denominator;
};

/** capex is stored as a non-negative magnitude of cash spent, so FCF = OCF - capex. */
export function freeCashFlow(f: Pick<FundamentalsFigures, 'operatingCashFlow' | 'capex'>) {
  const ocf = toNumber(f.operatingCashFlow);
  const capex = toNumber(f.capex);
  if (ocf === null || capex === null) return null;
  return ocf - capex;
}

export function ebitdaMargin(f: Pick<FundamentalsFigures, 'revenue' | 'ebitda'>) {
  return ratio(toNumber(f.ebitda), toNumber(f.revenue));
}

export function ebitMargin(f: Pick<FundamentalsFigures, 'revenue' | 'ebit'>) {
  return ratio(toNumber(f.ebit), toNumber(f.revenue));
}

export function netMargin(f: Pick<FundamentalsFigures, 'revenue' | 'netIncome'>) {
  return ratio(toNumber(f.netIncome), toNumber(f.revenue));
}

export function fcfMargin(f: Pick<FundamentalsFigures, 'revenue' | 'operatingCashFlow' | 'capex'>) {
  return ratio(freeCashFlow(f), toNumber(f.revenue));
}

export function debtToEquity(f: Pick<FundamentalsFigures, 'totalDebt' | 'totalEquity'>) {
  return ratio(toNumber(f.totalDebt), toNumber(f.totalEquity));
}

export function netDebt(f: Pick<FundamentalsFigures, 'totalDebt' | 'cashAndEquivalents'>) {
  const debt = toNumber(f.totalDebt);
  const cash = toNumber(f.cashAndEquivalents);
  if (debt === null || cash === null) return null;
  return debt - cash;
}

/** Computed even when equity is negative -- no positivity gate on an economically valid input. */
export function roe(f: Pick<FundamentalsFigures, 'totalEquity' | 'netIncome'>) {
  return ratio(toNumber(f.netIncome), toNumber(f.totalEquity));
}

const growthRate = (current: string | null, prior: string | null): number | null => {
  const c = toNumber(current);
  const p = toNumber(prior);
  if (c === null || p === null || p === 0) return null;
  return (c - p) / Math.abs(p);
};

export function revenueGrowth(
  current: Pick<FundamentalsFigures, 'revenue'>,
  prior: Pick<FundamentalsFigures, 'revenue'> | null,
) {
  return growthRate(current.revenue, prior?.revenue ?? null);
}

export function ebitdaGrowth(
  current: Pick<FundamentalsFigures, 'ebitda'>,
  prior: Pick<FundamentalsFigures, 'ebitda'> | null,
) {
  return growthRate(current.ebitda, prior?.ebitda ?? null);
}

export function netIncomeGrowth(
  current: Pick<FundamentalsFigures, 'netIncome'>,
  prior: Pick<FundamentalsFigures, 'netIncome'> | null,
) {
  return growthRate(current.netIncome, prior?.netIncome ?? null);
}

export function epsGrowth(
  current: Pick<FundamentalsFigures, 'eps'>,
  prior: Pick<FundamentalsFigures, 'eps'> | null,
) {
  return growthRate(current.eps, prior?.eps ?? null);
}

/**
 * DCF-only optional figures. Kept as a separate narrow type rather than added to
 * FundamentalsFigures above so the existing (frozen) fundamentals/valuation/peer read models
 * never have to know about them.
 */
export interface DcfOptionalFigures {
  depreciationAmortization: string | null;
  taxExpense: string | null;
  workingCapital: string | null;
  changeInWorkingCapital: string | null;
}

/** Change in NWC, derived from two consecutive periods' working_capital. The caller is
 * responsible for only passing a `prior` period that matches `current`'s period_type/
 * interim_period -- this function does not know about periods at all, so it never risks diffing
 * an annual figure against an interim one. Prefer a directly-reported change_in_working_capital
 * value over this derivation when one exists (see dcf-inputs.ts). */
export function changeInWorkingCapital(
  current: Pick<DcfOptionalFigures, 'workingCapital'>,
  prior: Pick<DcfOptionalFigures, 'workingCapital'> | null,
): number | null {
  const c = toNumber(current.workingCapital);
  const p = toNumber(prior?.workingCapital ?? null);
  if (c === null || p === null) return null;
  return c - p;
}

/** Effective tax rate = tax_expense / pre-tax income, where pre-tax income = net_income +
 * tax_expense -- an exact identity from two genuine reported figures, never invented from
 * net_income alone. Null whenever either input is missing, or pre-tax income is exactly zero
 * (the rate would be undefined or economically meaningless). */
export function effectiveTaxRate(
  f: Pick<FundamentalsFigures, 'netIncome'> & Pick<DcfOptionalFigures, 'taxExpense'>,
): number | null {
  const netIncome = toNumber(f.netIncome);
  const taxExpense = toNumber(f.taxExpense);
  if (netIncome === null || taxExpense === null) return null;
  const preTaxIncome = netIncome + taxExpense;
  if (preTaxIncome === 0) return null;
  return taxExpense / preTaxIncome;
}
