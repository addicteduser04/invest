import { createClient } from '@/lib/supabase/server';
import {
  changeInWorkingCapital as deriveChangeInWorkingCapital,
  ebitMargin,
  effectiveTaxRate,
  revenueGrowth as revenueGrowthYoY,
  type FundamentalsFigures,
} from '@/lib/fundamentals-metrics';
import { selectLatestUsablePeriod, type FundamentalsRow as ValuationFundamentalsRow } from '@/lib/valuation-read';

/**
 * Canonical DCF historical-input read model. Turns approved (`security_fundamentals`)
 * fundamentals rows into the series the DCF forecast engine and its default-assumption generator
 * consume. Reuses valuation-read.ts's selectLatestUsablePeriod unchanged for the base-year pick
 * -- no new "latest" rule is introduced; the DCF base year obeys the exact same point-in-time
 * semantics as every other valuation surface (published FY2025 + unpublished H1 2026 -> base
 * year is FY2025).
 */

export interface FundamentalsRow extends ValuationFundamentalsRow {
  depreciation_amortization: string | number | null;
  tax_expense: string | number | null;
  working_capital: string | number | null;
  change_in_working_capital: string | number | null;
}

export interface DcfHistoricalPeriod {
  periodEndDate: string;
  periodType: 'annual' | 'interim';
  interimPeriod: 'H1' | 'H2' | null;
  fiscalYear: number;
  publicationDate: string | null;
  revenue: number | null;
  revenueGrowth: number | null;
  ebit: number | null;
  ebitMargin: number | null;
  ebitda: number | null;
  depreciationAmortization: number | null;
  taxExpense: number | null;
  effectiveTaxRate: number | null;
  operatingCashFlow: number | null;
  capex: number | null;
  workingCapital: number | null;
  changeInWorkingCapital: number | null;
  /** null when changeInWorkingCapital itself is null. 'historical' when the CSV/import supplied
   * the value directly; 'derived' when it was computed from this period's and the prior matching
   * period's working_capital instead. */
  changeInWorkingCapitalSource: 'historical' | 'derived' | null;
  cash: number | null;
  totalDebt: number | null;
  sharesOutstanding: number | null;
}

export interface DcfHistoricalInputs {
  securityId: string;
  /** Ascending by period_end_date. */
  periods: DcfHistoricalPeriod[];
  /** The point-in-time-usable period the DCF base year defaults from, or null if none exists. */
  basePeriod: DcfHistoricalPeriod | null;
}

const toStringOrNull = (value: string | number | null) => (value === null ? null : String(value));
const toNumber = (value: string | null): number | null => {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const toFigures = (row: FundamentalsRow): FundamentalsFigures => ({
  revenue: toStringOrNull(row.revenue),
  ebitda: toStringOrNull(row.ebitda),
  ebit: toStringOrNull(row.ebit),
  netIncome: toStringOrNull(row.net_income),
  eps: toStringOrNull(row.eps),
  cashAndEquivalents: toStringOrNull(row.cash_and_equivalents),
  totalDebt: toStringOrNull(row.total_debt),
  totalAssets: toStringOrNull(row.total_assets),
  totalEquity: toStringOrNull(row.total_equity),
  operatingCashFlow: toStringOrNull(row.operating_cash_flow),
  capex: toStringOrNull(row.capex),
  sharesOutstanding: toStringOrNull(row.shares_outstanding),
  dividendPerShare: toStringOrNull(row.dividend_per_share),
});

function findPriorMatchingPeriod(rows: FundamentalsRow[], current: FundamentalsRow) {
  return (
    rows.find(
      (row) =>
        row.id !== current.id &&
        row.period_type === current.period_type &&
        row.interim_period === current.interim_period &&
        row.period_end_date < current.period_end_date,
    ) ?? null
  );
}

function buildPeriod(row: FundamentalsRow, priorRow: FundamentalsRow | null): DcfHistoricalPeriod {
  const figures = toFigures(row);
  const priorFigures = priorRow ? toFigures(priorRow) : null;
  const workingCapital = toNumber(toStringOrNull(row.working_capital));
  const priorWorkingCapital = priorRow ? toNumber(toStringOrNull(priorRow.working_capital)) : null;
  const taxExpense = toStringOrNull(row.tax_expense);

  const reportedChange = toNumber(toStringOrNull(row.change_in_working_capital));
  const derivedChange =
    workingCapital !== null && priorWorkingCapital !== null
      ? deriveChangeInWorkingCapital({ workingCapital: String(workingCapital) }, { workingCapital: String(priorWorkingCapital) })
      : null;
  const changeInWorkingCapital = reportedChange ?? derivedChange;
  const changeInWorkingCapitalSource: DcfHistoricalPeriod['changeInWorkingCapitalSource'] =
    reportedChange !== null ? 'historical' : derivedChange !== null ? 'derived' : null;

  return {
    periodEndDate: row.period_end_date,
    periodType: row.period_type,
    interimPeriod: row.interim_period,
    fiscalYear: row.fiscal_year,
    publicationDate: row.publication_date,
    revenue: toNumber(figures.revenue),
    revenueGrowth: revenueGrowthYoY(figures, priorFigures),
    ebit: toNumber(figures.ebit),
    ebitMargin: ebitMargin(figures),
    ebitda: toNumber(figures.ebitda),
    depreciationAmortization: toNumber(toStringOrNull(row.depreciation_amortization)),
    taxExpense: toNumber(taxExpense),
    effectiveTaxRate: effectiveTaxRate({ netIncome: figures.netIncome, taxExpense }),
    operatingCashFlow: toNumber(figures.operatingCashFlow),
    capex: toNumber(figures.capex),
    workingCapital,
    changeInWorkingCapital,
    changeInWorkingCapitalSource,
    cash: toNumber(figures.cashAndEquivalents),
    totalDebt: toNumber(figures.totalDebt),
    sharesOutstanding: toNumber(figures.sharesOutstanding),
  };
}

/** Pure core: builds the full historical-period series and picks the PIT-usable base period from
 * already-fetched rows. Split out from readDcfHistoricalInputs so it is directly unit-testable
 * without a database (mirrors buildValuationSnapshot / buildPeerComparison in the frozen
 * valuation/peer modules). */
export function buildDcfHistoricalInputs(securityId: string, rows: FundamentalsRow[], todayIso: string): DcfHistoricalInputs {
  const ascending = [...rows].sort((a, b) => a.period_end_date.localeCompare(b.period_end_date));
  const periods = ascending.map((row) => buildPeriod(row, findPriorMatchingPeriod(rows, row)));

  const usableRow = selectLatestUsablePeriod(rows, todayIso);
  const basePeriod = usableRow ? periods.find((p) => p.periodEndDate === usableRow.period_end_date && p.periodType === usableRow.period_type) ?? null : null;

  return { securityId, periods, basePeriod };
}

export async function readDcfHistoricalInputs(securityId: string): Promise<DcfHistoricalInputs> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('security_fundamentals')
    .select(
      'id,security_id,period_type,interim_period,fiscal_year,period_end_date,publication_date,revenue,ebitda,ebit,net_income,eps,cash_and_equivalents,total_debt,total_assets,total_equity,operating_cash_flow,capex,shares_outstanding,dividend_per_share,depreciation_amortization,tax_expense,working_capital,change_in_working_capital',
    )
    .eq('security_id', securityId)
    .order('period_end_date', { ascending: false })
    .limit(12);
  if (error) throw error;

  const todayIso = new Date().toISOString().slice(0, 10);
  return buildDcfHistoricalInputs(securityId, (data ?? []) as FundamentalsRow[], todayIso);
}
