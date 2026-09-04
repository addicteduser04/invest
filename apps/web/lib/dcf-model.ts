/**
 * Canonical FCFF / enterprise-value DCF engine. Pure functions only -- no I/O, no React, no
 * formatting. See docs/DCF.md for the full methodology writeup.
 *
 * FCFF = EBIT * (1 - tax rate) + D&A - capex - change in NWC
 * PV(forecast FCFF) + PV(terminal value) = Enterprise value
 * Enterprise value - total debt + cash = Equity value
 * Equity value / shares outstanding = Intrinsic value per share
 *
 * Discounting uses year-end convention: PV = CF_t / (1 + WACC)^t, t = 1..N integers. No mid-year
 * convention is applied.
 *
 * Every numeric assumption is a single flat rate applied uniformly across the forecast horizon
 * (e.g. one revenue-growth rate for all N years, not a year-by-year schedule) -- this keeps the
 * assumption editor a short, auditable list rather than an N-column grid, matching the product's
 * "do not over-engineer" guidance. Revenue still compounds year over year even under a flat rate.
 */
import { validateDcfInputs, type DcfAssumptionsInput, type DcfBaseInputsInput } from '@/lib/dcf-validation';

export interface DcfAssumptions {
  forecastYears: number;
  revenueGrowth: number;
  ebitMargin: number;
  taxRate: number;
  daPercentRevenue: number;
  capexPercentRevenue: number;
  changeNwcPercentRevenue: number;
  wacc: number;
  terminalGrowth: number;
}

export interface DcfBaseInputs {
  baseRevenue: number;
  cash: number | null;
  totalDebt: number | null;
  sharesOutstanding: number | null;
}

export interface DcfYearProjection {
  year: number;
  revenue: number;
  revenueGrowth: number;
  ebitMargin: number;
  ebit: number;
  tax: number;
  nopat: number;
  da: number;
  capex: number;
  changeInNwc: number;
  fcff: number;
  discountFactor: number;
  presentValueFcff: number;
}

export interface DcfResult {
  years: DcfYearProjection[];
  presentValueForecast: number;
  terminalValue: number;
  presentValueTerminalValue: number;
  enterpriseValue: number;
  cash: number;
  totalDebt: number;
  netDebt: number;
  equityValue: number;
  sharesOutstanding: number | null;
  valuePerShare: number | null;
  terminalValueShareOfEv: number | null;
}

/** Gordon Growth terminal value on the final forecast year's FCFF. Caller must have already
 * confirmed wacc > terminalGrowth (see dcf-validation.ts) -- this function does not re-check. */
export function terminalValue(finalYearFcff: number, wacc: number, terminalGrowth: number): number {
  const nextYearFcff = finalYearFcff * (1 + terminalGrowth);
  return nextYearFcff / (wacc - terminalGrowth);
}

/** Pure forecast + valuation engine. Assumes inputs are already validated (non-null, finite,
 * wacc > terminalGrowth, forecastYears in range) -- call validateDcfInputs first, or use runDcf
 * below which does that for you and never calls this on invalid inputs. */
export function projectDcf(base: DcfBaseInputs, assumptions: DcfAssumptions): DcfResult {
  const years: DcfYearProjection[] = [];
  let revenue = base.baseRevenue;

  for (let year = 1; year <= assumptions.forecastYears; year += 1) {
    revenue = revenue * (1 + assumptions.revenueGrowth);
    const ebit = revenue * assumptions.ebitMargin;
    const tax = ebit > 0 ? ebit * assumptions.taxRate : 0;
    const nopat = ebit - tax;
    const da = revenue * assumptions.daPercentRevenue;
    const capex = revenue * assumptions.capexPercentRevenue;
    const changeInNwc = revenue * assumptions.changeNwcPercentRevenue;
    const fcff = nopat + da - capex - changeInNwc;
    const discountFactor = 1 / (1 + assumptions.wacc) ** year;
    const presentValueFcff = fcff * discountFactor;

    years.push({
      year,
      revenue,
      revenueGrowth: assumptions.revenueGrowth,
      ebitMargin: assumptions.ebitMargin,
      ebit,
      tax,
      nopat,
      da,
      capex,
      changeInNwc,
      fcff,
      discountFactor,
      presentValueFcff,
    });
  }

  const presentValueForecast = years.reduce((sum, y) => sum + y.presentValueFcff, 0);
  const finalYear = years[years.length - 1]!;
  const tv = terminalValue(finalYear.fcff, assumptions.wacc, assumptions.terminalGrowth);
  const presentValueTerminalValue = tv * finalYear.discountFactor;
  const enterpriseValue = presentValueForecast + presentValueTerminalValue;

  const cash = base.cash ?? 0;
  const totalDebt = base.totalDebt ?? 0;
  const netDebt = totalDebt - cash;
  const equityValue = enterpriseValue - netDebt;

  const shares = base.sharesOutstanding;
  const valuePerShare = shares !== null && shares > 0 ? equityValue / shares : null;
  const terminalValueShareOfEv = enterpriseValue !== 0 ? presentValueTerminalValue / enterpriseValue : null;

  return {
    years,
    presentValueForecast,
    terminalValue: tv,
    presentValueTerminalValue,
    enterpriseValue,
    cash,
    totalDebt,
    netDebt,
    equityValue,
    sharesOutstanding: shares,
    valuePerShare,
    terminalValueShareOfEv,
  };
}

export interface DcfRun {
  valid: boolean;
  issues: ReturnType<typeof validateDcfInputs>;
  result: DcfResult | null;
}

/** Orchestrator: validates first (structured issues, never a thrown/raw error), then projects
 * only when nothing blocking was found. Non-blocking issues (e.g. missing shares outstanding)
 * are still returned alongside a valid result so the UI can show "per-share unavailable" without
 * losing the enterprise/equity value. */
export function runDcf(base: DcfBaseInputsInput, assumptions: DcfAssumptionsInput): DcfRun {
  const issues = validateDcfInputs(base, assumptions);
  if (issues.some((issue) => issue.blocking)) {
    return { valid: false, issues, result: null };
  }
  const strictBase: DcfBaseInputs = {
    baseRevenue: base.baseRevenue as number,
    cash: base.cash,
    totalDebt: base.totalDebt,
    sharesOutstanding:
      base.sharesOutstanding !== null && base.sharesOutstanding > 0 ? base.sharesOutstanding : null,
  };
  const strictAssumptions: DcfAssumptions = {
    forecastYears: assumptions.forecastYears as number,
    revenueGrowth: assumptions.revenueGrowth as number,
    ebitMargin: assumptions.ebitMargin as number,
    taxRate: assumptions.taxRate as number,
    daPercentRevenue: assumptions.daPercentRevenue as number,
    capexPercentRevenue: assumptions.capexPercentRevenue as number,
    changeNwcPercentRevenue: assumptions.changeNwcPercentRevenue as number,
    wacc: assumptions.wacc as number,
    terminalGrowth: assumptions.terminalGrowth as number,
  };
  return { valid: true, issues, result: projectDcf(strictBase, strictAssumptions) };
}
