/**
 * Pure valuation-ratio helpers, built on top of market price + a point-in-time fundamentals
 * period. Every function returns null (never throws, never guesses) when a required input is
 * missing, a denominator is exactly zero, or the result would not be finite. A handful of
 * ratios additionally return null when the input they divide by is economically non-meaningful
 * (see the per-function notes) -- that is a deliberate valuation-semantics rule, not a generic
 * null-propagation rule, and does not apply to the raw financial figures themselves.
 */

const toNumber = (value: string | null | undefined): number | null => {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const finiteOrNull = (value: number): number | null => (Number.isFinite(value) ? value : null);

/** market_cap = latest_price * shares_outstanding. Null if price or share count is missing, or
 * the share count is not a positive number (a company cannot have zero/negative shares). */
export function marketCap(price: string | null, sharesOutstanding: string | null): number | null {
  const p = toNumber(price);
  const shares = toNumber(sharesOutstanding);
  if (p === null || shares === null || shares <= 0) return null;
  return finiteOrNull(p * shares);
}

/** enterprise_value = market_cap + total_debt - cash_and_equivalents. Requires both debt and
 * cash to be explicitly known (blank is not the same as zero) as well as a market cap. */
export function enterpriseValue(
  marketCapValue: number | null,
  totalDebt: string | null,
  cashAndEquivalents: string | null,
): number | null {
  const debt = toNumber(totalDebt);
  const cash = toNumber(cashAndEquivalents);
  if (marketCapValue === null || debt === null || cash === null) return null;
  return finiteOrNull(marketCapValue + debt - cash);
}

/** P/E = market_cap / net_income. Not meaningful (null) for a loss-making or breakeven company
 * -- a negative or near-zero P/E is not a normal valuation multiple. Mathematically equivalent
 * to price / EPS whenever EPS was derived from the same net_income and share count (see tests). */
export function pe(marketCapValue: number | null, netIncome: string | null): number | null {
  const income = toNumber(netIncome);
  if (marketCapValue === null || income === null || income <= 0) return null;
  return finiteOrNull(marketCapValue / income);
}

/** P/B = market_cap / total_equity. Not meaningful (null) when equity is zero or negative. */
export function pb(marketCapValue: number | null, totalEquity: string | null): number | null {
  const equity = toNumber(totalEquity);
  if (marketCapValue === null || equity === null || equity <= 0) return null;
  return finiteOrNull(marketCapValue / equity);
}

/** EV/EBITDA. Not meaningful (null) when EBITDA is zero or negative. EV itself is allowed to be
 * negative (a net-cash company) -- only the EBITDA denominator is guarded. */
export function evEbitda(
  enterpriseValueValue: number | null,
  ebitda: string | null,
): number | null {
  const e = toNumber(ebitda);
  if (enterpriseValueValue === null || e === null || e <= 0) return null;
  return finiteOrNull(enterpriseValueValue / e);
}

/** dividend_yield = dividend_per_share / latest_price. A dividend of exactly 0 is a legitimate,
 * known fact (no distribution) and yields 0 -- only a *missing* dividend or price is null. */
export function dividendYield(
  dividendPerShare: string | null,
  price: string | null,
): number | null {
  const dps = toNumber(dividendPerShare);
  const p = toNumber(price);
  if (dps === null || p === null || p <= 0) return null;
  return finiteOrNull(dps / p);
}

/** earnings_yield = net_income / market_cap. Unlike P/E, this stays well-behaved for a
 * loss-making company (a negative yield is meaningful, not a mangled inverted multiple), so it
 * is not restricted to positive net income. */
export function earningsYield(
  netIncome: string | null,
  marketCapValue: number | null,
): number | null {
  const income = toNumber(netIncome);
  if (income === null || marketCapValue === null || marketCapValue <= 0) return null;
  return finiteOrNull(income / marketCapValue);
}

/** fcf_yield = free_cash_flow / market_cap. Free cash flow may legitimately be negative; only
 * the market-cap denominator is guarded (must be a positive, known value). */
export function fcfYield(
  freeCashFlow: number | null,
  marketCapValue: number | null,
): number | null {
  if (freeCashFlow === null || marketCapValue === null || marketCapValue <= 0) return null;
  return finiteOrNull(freeCashFlow / marketCapValue);
}
