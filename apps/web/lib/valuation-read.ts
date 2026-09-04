import { z } from 'zod';
import { isMarketDateStale } from '@bvc/market-data/staleness';
import { createClient } from '@/lib/supabase/server';
import {
  debtToEquity,
  ebitMargin,
  ebitdaGrowth,
  ebitdaMargin,
  epsGrowth,
  fcfMargin,
  freeCashFlow,
  netDebt,
  netMargin,
  revenueGrowth,
  roe,
  type FundamentalsFigures,
} from '@/lib/fundamentals-metrics';
import {
  dividendYield,
  earningsYield,
  enterpriseValue,
  evEbitda,
  fcfYield,
  marketCap,
  pb,
  pe,
} from '@/lib/valuation-metrics';

export interface SecurityPriceInput {
  id: string;
  // PostgREST can serialize a `numeric` column as either a JSON string or a JSON number
  // depending on the query path -- callers should not have to know which, so this accepts
  // either and buildValuationSnapshot coerces it to a string at the boundary.
  latestPrice: string | number | null;
  priceDate: string | null;
}

export interface FundamentalsRow {
  id: string;
  security_id: string;
  period_type: 'annual' | 'interim';
  interim_period: 'H1' | 'H2' | null;
  fiscal_year: number;
  period_end_date: string;
  publication_date: string | null;
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

const periodSchema = z.object({
  periodType: z.enum(['annual', 'interim']),
  interimPeriod: z.enum(['H1', 'H2']).nullable(),
  fiscalYear: z.number(),
  periodEndDate: z.string(),
  publicationDate: z.string(),
});

const snapshotSchema = z.object({
  securityId: z.string(),
  price: z.string().nullable(),
  priceDate: z.string().nullable(),
  priceStale: z.boolean(),
  fundamentalsPeriod: periodSchema.nullable(),
  hasFundamentals: z.boolean(),
  marketCap: z.number().nullable(),
  enterpriseValue: z.number().nullable(),
  pe: z.number().nullable(),
  pb: z.number().nullable(),
  evEbitda: z.number().nullable(),
  dividendYield: z.number().nullable(),
  earningsYield: z.number().nullable(),
  fcfYield: z.number().nullable(),
  revenueGrowth: z.number().nullable(),
  ebitdaGrowth: z.number().nullable(),
  epsGrowth: z.number().nullable(),
  ebitdaMargin: z.number().nullable(),
  operatingMargin: z.number().nullable(),
  netMargin: z.number().nullable(),
  roe: z.number().nullable(),
  debtEquity: z.number().nullable(),
  netDebt: z.number().nullable(),
  fcfMargin: z.number().nullable(),
});

export type ValuationSnapshot = z.infer<typeof snapshotSchema>;

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

/**
 * Point-in-time selection rule for valuation: only a period whose publication_date is known
 * AND not in the future counts as "available" -- an unknown publication date must never
 * silently outrank a known-published period, and a security whose only data has an unknown or
 * future publication date has no usable fundamentals for valuation purposes (shows null/"--"),
 * even though the same period may still be shown on the plain fundamentals overview. Among the
 * usable periods, the most economically current one (greatest period_end_date) wins.
 */
export function selectLatestUsablePeriod(
  rows: FundamentalsRow[],
  todayIso: string,
): FundamentalsRow | null {
  const usable = rows.filter(
    (row) => row.publication_date !== null && row.publication_date <= todayIso,
  );
  if (!usable.length) return null;
  return usable.reduce((latest, row) =>
    row.period_end_date > latest.period_end_date ? row : latest,
  );
}

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

export function buildValuationSnapshot(
  security: SecurityPriceInput,
  fundamentalsRows: FundamentalsRow[],
  now: Date,
): ValuationSnapshot {
  const todayIso = now.toISOString().slice(0, 10);
  const latestRow = selectLatestUsablePeriod(fundamentalsRows, todayIso);
  const priorRow = latestRow ? findPriorMatchingPeriod(fundamentalsRows, latestRow) : null;
  const figures = latestRow ? toFigures(latestRow) : null;
  const priorFigures = priorRow ? toFigures(priorRow) : null;
  // PostgREST can hand back a `numeric` column as a JSON number rather than a string depending
  // on the query path -- coerce once at the boundary, matching apps/web/lib/portfolio-read.ts's
  // established "never trust the cast, coerce to a real string" convention.
  const price = security.latestPrice === null ? null : String(security.latestPrice);

  const cap = figures ? marketCap(price, figures.sharesOutstanding) : null;
  const ev = figures ? enterpriseValue(cap, figures.totalDebt, figures.cashAndEquivalents) : null;
  const fcf = figures ? freeCashFlow(figures) : null;

  return snapshotSchema.parse({
    securityId: security.id,
    price,
    priceDate: security.priceDate,
    priceStale: security.priceDate !== null && isMarketDateStale(security.priceDate, now),
    fundamentalsPeriod: latestRow
      ? {
          periodType: latestRow.period_type,
          interimPeriod: latestRow.interim_period,
          fiscalYear: latestRow.fiscal_year,
          periodEndDate: latestRow.period_end_date,
          publicationDate: latestRow.publication_date,
        }
      : null,
    hasFundamentals: figures !== null,
    marketCap: cap,
    enterpriseValue: ev,
    pe: figures ? pe(cap, figures.netIncome) : null,
    pb: figures ? pb(cap, figures.totalEquity) : null,
    evEbitda: figures ? evEbitda(ev, figures.ebitda) : null,
    dividendYield: figures ? dividendYield(figures.dividendPerShare, price) : null,
    earningsYield: figures ? earningsYield(figures.netIncome, cap) : null,
    fcfYield: fcf !== null ? fcfYield(fcf, cap) : null,
    revenueGrowth: figures ? revenueGrowth(figures, priorFigures) : null,
    ebitdaGrowth: figures ? ebitdaGrowth(figures, priorFigures) : null,
    epsGrowth: figures ? epsGrowth(figures, priorFigures) : null,
    ebitdaMargin: figures ? ebitdaMargin(figures) : null,
    operatingMargin: figures ? ebitMargin(figures) : null,
    netMargin: figures ? netMargin(figures) : null,
    roe: figures ? roe(figures) : null,
    debtEquity: figures ? debtToEquity(figures) : null,
    netDebt: figures ? netDebt(figures) : null,
    fcfMargin: figures ? fcfMargin(figures) : null,
  });
}

/**
 * Batched valuation read model: one query for however many securities are passed in (never one
 * query per security), combining each security's already-fetched latest price with its latest
 * point-in-time-usable fundamentals period to compute every valuation ratio. Used by both the
 * Stocks screener (many securities) and the Security Detail valuation summary (one security),
 * so there is a single canonical implementation rather than a duplicate per call site. Reads
 * only from the public `security_fundamentals` view (no admin/audit columns are selected).
 */
export async function readValuationSnapshots(
  securities: SecurityPriceInput[],
): Promise<Map<string, ValuationSnapshot>> {
  const now = new Date();
  if (!securities.length) return new Map();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('security_fundamentals')
    .select(
      'id,security_id,period_type,interim_period,fiscal_year,period_end_date,publication_date,revenue,ebitda,ebit,net_income,eps,cash_and_equivalents,total_debt,total_assets,total_equity,operating_cash_flow,capex,shares_outstanding,dividend_per_share',
    )
    .in(
      'security_id',
      securities.map((security) => security.id),
    );
  if (error) throw error;

  const bySecurity = new Map<string, FundamentalsRow[]>();
  for (const row of (data ?? []) as FundamentalsRow[]) {
    const bucket = bySecurity.get(row.security_id) ?? [];
    bucket.push(row);
    bySecurity.set(row.security_id, bucket);
  }

  const snapshots = new Map<string, ValuationSnapshot>();
  for (const security of securities) {
    const rows = bySecurity.get(security.id) ?? [];
    snapshots.set(security.id, buildValuationSnapshot(security, rows, now));
  }
  return snapshots;
}
