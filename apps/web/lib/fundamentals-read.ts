import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
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
} from '@/lib/fundamentals-metrics';

interface FundamentalsRow {
  id: string;
  security_id: string;
  period_type: 'annual' | 'interim';
  interim_period: 'H1' | 'H2' | null;
  fiscal_year: number;
  period_end_date: string;
  publication_date: string | null;
  currency: string;
  revenue: string | number | null;
  ebitda: string | number | null;
  ebit: string | number | null;
  net_income: string | number | null;
  eps: string | number | null;
  cash_and_equivalents: string | number | null;
  total_debt: string | number | null;
  total_assets: string | number | null;
  total_equity: string | number | null;
  operating_cash_flow: string | number | null;
  capex: string | number | null;
  shares_outstanding: string | number | null;
  dividend_per_share: string | number | null;
}

const toStringOrNull = (value: string | number | null) => (value === null ? null : String(value));

const figuresSchema = z.object({
  revenue: z.string().nullable(),
  ebitda: z.string().nullable(),
  ebit: z.string().nullable(),
  netIncome: z.string().nullable(),
  eps: z.string().nullable(),
  cashAndEquivalents: z.string().nullable(),
  totalDebt: z.string().nullable(),
  totalAssets: z.string().nullable(),
  totalEquity: z.string().nullable(),
  operatingCashFlow: z.string().nullable(),
  capex: z.string().nullable(),
  sharesOutstanding: z.string().nullable(),
  dividendPerShare: z.string().nullable(),
});

const periodSchema = z.object({
  id: z.string(),
  periodType: z.enum(['annual', 'interim']),
  interimPeriod: z.enum(['H1', 'H2']).nullable(),
  fiscalYear: z.number(),
  periodEndDate: z.string(),
  publicationDate: z.string().nullable(),
  currency: z.string(),
  figures: figuresSchema,
});

const metricsSchema = z.object({
  revenueGrowth: z.number().nullable(),
  netIncomeGrowth: z.number().nullable(),
  epsGrowth: z.number().nullable(),
  ebitdaMargin: z.number().nullable(),
  ebitMargin: z.number().nullable(),
  netMargin: z.number().nullable(),
  fcfMargin: z.number().nullable(),
  freeCashFlow: z.number().nullable(),
  debtToEquity: z.number().nullable(),
  netDebt: z.number().nullable(),
  roe: z.number().nullable(),
});

const trendPointSchema = z.object({
  periodEndDate: z.string(),
  periodType: z.enum(['annual', 'interim']),
  interimPeriod: z.enum(['H1', 'H2']).nullable(),
  fiscalYear: z.number(),
  revenue: z.number().nullable(),
  netIncome: z.number().nullable(),
  freeCashFlow: z.number().nullable(),
});

const fundamentalsViewSchema = z.object({
  securityId: z.string(),
  latest: periodSchema.nullable(),
  metrics: metricsSchema,
  trend: z.array(trendPointSchema),
});

export type FundamentalsPeriodView = z.infer<typeof periodSchema>;
export type FundamentalsView = z.infer<typeof fundamentalsViewSchema>;

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

const toNumber = (value: string | null) => (value === null ? null : Number(value));

function findPriorMatchingPeriod(rows: FundamentalsRow[], latest: FundamentalsRow) {
  return (
    rows.find(
      (row) =>
        row.id !== latest.id &&
        row.period_type === latest.period_type &&
        row.interim_period === latest.interim_period &&
        row.period_end_date < latest.period_end_date,
    ) ?? null
  );
}

/**
 * Reads the fundamentals history for one security from the public, security-barrier'd
 * `security_fundamentals` view (no admin/audit fields), coerces every numeric column to a
 * string at the boundary (never trust the PostgREST-cast JS number for financial math), computes
 * every derived metric for the latest period, and shapes the result through a zod schema before
 * returning -- mirroring apps/web/lib/portfolio-read.ts's authenticate/fetch-narrow/coerce/shape
 * pattern, minus the ownership check: fundamentals are public data, not per-user.
 */
export async function readSecurityFundamentals(securityId: string): Promise<FundamentalsView> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('security_fundamentals')
    .select(
      'id,security_id,period_type,interim_period,fiscal_year,period_end_date,publication_date,currency,revenue,ebitda,ebit,net_income,eps,cash_and_equivalents,total_debt,total_assets,total_equity,operating_cash_flow,capex,shares_outstanding,dividend_per_share',
    )
    .eq('security_id', securityId)
    .order('period_end_date', { ascending: false })
    .limit(12);
  if (error) throw error;

  const rows = (data ?? []) as FundamentalsRow[];
  const latestRow = rows[0] ?? null;
  const priorRow = latestRow ? findPriorMatchingPeriod(rows, latestRow) : null;
  const latestFigures = latestRow ? toFigures(latestRow) : null;
  const priorFigures = priorRow ? toFigures(priorRow) : null;

  const metrics = latestFigures
    ? {
        revenueGrowth: revenueGrowth(latestFigures, priorFigures),
        netIncomeGrowth: netIncomeGrowth(latestFigures, priorFigures),
        epsGrowth: epsGrowth(latestFigures, priorFigures),
        ebitdaMargin: ebitdaMargin(latestFigures),
        ebitMargin: ebitMargin(latestFigures),
        netMargin: netMargin(latestFigures),
        fcfMargin: fcfMargin(latestFigures),
        freeCashFlow: freeCashFlow(latestFigures),
        debtToEquity: debtToEquity(latestFigures),
        netDebt: netDebt(latestFigures),
        roe: roe(latestFigures),
      }
    : {
        revenueGrowth: null,
        netIncomeGrowth: null,
        epsGrowth: null,
        ebitdaMargin: null,
        ebitMargin: null,
        netMargin: null,
        fcfMargin: null,
        freeCashFlow: null,
        debtToEquity: null,
        netDebt: null,
        roe: null,
      };

  const trend = [...rows]
    .sort((a, b) => a.period_end_date.localeCompare(b.period_end_date))
    .map((row) => {
      const figures = toFigures(row);
      return {
        periodEndDate: row.period_end_date,
        periodType: row.period_type,
        interimPeriod: row.interim_period,
        fiscalYear: row.fiscal_year,
        revenue: toNumber(figures.revenue),
        netIncome: toNumber(figures.netIncome),
        freeCashFlow: freeCashFlow(figures),
      };
    });

  return fundamentalsViewSchema.parse({
    securityId,
    latest: latestRow
      ? {
          id: latestRow.id,
          periodType: latestRow.period_type,
          interimPeriod: latestRow.interim_period,
          fiscalYear: latestRow.fiscal_year,
          periodEndDate: latestRow.period_end_date,
          publicationDate: latestRow.publication_date,
          currency: latestRow.currency,
          figures: latestFigures,
        }
      : null,
    metrics,
    trend,
  });
}
