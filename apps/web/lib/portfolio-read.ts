import {
  calculateLedger,
  calculateTimeWeightedReturn,
  calculateXirr,
  valuePortfolioAsOf,
  valuePosition,
  type DatedPrice,
  type Transaction,
} from '@bvc/portfolio-engine';
import { portfolioPerformanceSchema, portfolioValuationSchema } from '@bvc/contracts';
import { createClient } from '@/lib/supabase/server';

interface ReplayRow {
  id: string;
  portfolio_id: string;
  transaction_type: Transaction['type'];
  settlement_date: string;
  security_id: string | null;
  quantity: string | null;
  unit_price: string | null;
  gross_amount: string | null;
  fees: string;
  taxes: string;
  reverses_transaction_id: string | null;
  created_at: string;
  effective_at: string;
  ledger_sequence: string;
}

interface SecurityRow {
  id: string;
  ticker: string;
  name: string;
  sector: string | null;
}

interface PriceRow {
  security_id: string;
  market_date: string;
  close_price: string;
  status: 'published' | 'provisional';
}

interface IndexHistoryRow {
  code: string;
  market_date: string;
  close_value: string;
}

const toTransaction = (row: ReplayRow): Transaction => ({
  id: row.id,
  type: row.transaction_type,
  settlementDate: row.settlement_date,
  ...(row.security_id ? { securityId: row.security_id } : {}),
  ...(row.quantity ? { quantity: row.quantity } : {}),
  ...(row.unit_price ? { unitPrice: row.unit_price } : {}),
  ...(row.gross_amount ? { amount: row.gross_amount } : {}),
  fees: row.fees,
  taxes: row.taxes,
  ...(row.reverses_transaction_id ? { reversesTransactionId: row.reverses_transaction_id } : {}),
  recordedAt: row.created_at,
  effectiveAt: row.effective_at,
  ledgerSequence: row.ledger_sequence,
});

const dateOnly = (value: Date) => value.toISOString().slice(0, 10);
const exactAsOf = (date: string) => `${date}T23:59:59.999Z`;

async function loadOwnedPortfolio(portfolioId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, status: 'unauthenticated' as const };
  const { data: portfolio } = await supabase
    .from('portfolios')
    .select('id,name,base_currency,status,tracking_mode')
    .eq('id', portfolioId)
    .maybeSingle();
  if (!portfolio) return { supabase, status: 'forbidden' as const };
  return { supabase, status: 'ok' as const, portfolio };
}

async function loadReplayRows(
  supabase: Awaited<ReturnType<typeof createClient>>,
  portfolioId: string,
) {
  const { data, error } = await supabase
    .from('portfolio_replay_transactions')
    .select(
      'id,portfolio_id,transaction_type,settlement_date,security_id,quantity,unit_price,gross_amount,fees,taxes,reverses_transaction_id,created_at,effective_at,ledger_sequence',
    )
    .eq('portfolio_id', portfolioId);
  if (error) throw error;
  return (data ?? []) as ReplayRow[];
}

async function loadSecurities(
  supabase: Awaited<ReturnType<typeof createClient>>,
  securityIds: readonly string[],
) {
  if (!securityIds.length) return new Map<string, SecurityRow>();
  const { data, error } = await supabase
    .from('market_security_overview')
    .select('id,ticker,name,sector')
    .in('id', [...securityIds]);
  if (error) throw error;
  return new Map(((data ?? []) as SecurityRow[]).map((security) => [security.id, security]));
}

async function loadPrices(
  supabase: Awaited<ReturnType<typeof createClient>>,
  securityIds: readonly string[],
  through: string,
) {
  if (!securityIds.length) return [] as PriceRow[];
  const { data, error } = await supabase
    .from('market_price_history')
    .select('security_id,market_date,close_price,status')
    .in('security_id', [...securityIds])
    .lte('market_date', through)
    .order('market_date', { ascending: true });
  if (error) throw error;
  return (data ?? []) as PriceRow[];
}

function latestPricesAsOf(rows: readonly PriceRow[], asOf: string) {
  const map: Record<string, DatedPrice | undefined> = {};
  for (const row of rows) {
    if (row.market_date > asOf) break;
    map[row.security_id] = { value: String(row.close_price), marketDate: row.market_date };
  }
  return map;
}

async function hasMasiBenchmarkSeries(
  supabase: Awaited<ReturnType<typeof createClient>>,
  fromDate: string | null,
  toDate: string,
) {
  const query = supabase
    .from('market_index_history')
    .select('code,market_date,close_value')
    .eq('code', 'MASI')
    .lte('market_date', toDate)
    .order('market_date', { ascending: true })
    .limit(2);
  if (fromDate) query.gte('market_date', fromDate);
  const { data, error } = await query;
  if (error) return false;
  return ((data ?? []) as IndexHistoryRow[]).length >= 2;
}

export async function readPortfolioValuation(portfolioId: string, requestedAsOf?: Date) {
  const ownership = await loadOwnedPortfolio(portfolioId);
  if (ownership.status !== 'ok') return ownership;
  const asOf = requestedAsOf ?? new Date();
  const valuationDate = dateOnly(asOf);
  const rows = await loadReplayRows(ownership.supabase, portfolioId);
  const transactions = rows.map(toTransaction);
  const ledger = calculateLedger(transactions, { asOf: asOf.toISOString() });
  const securityIds = ledger.positions
    .filter((position) => position.quantity !== '0')
    .map((position) => position.securityId);
  const [securities, priceRows] = await Promise.all([
    loadSecurities(
      ownership.supabase,
      ledger.positions.map((position) => position.securityId),
    ),
    loadPrices(ownership.supabase, securityIds, valuationDate),
  ]);
  const prices = latestPricesAsOf(priceRows, valuationDate);
  const valuation = valuePortfolioAsOf(ledger, prices, valuationDate);
  const positions = ledger.positions.map((position) => {
    const security = securities.get(position.securityId);
    const price = prices[position.securityId];
    const priceStatus = !price
      ? ('missing' as const)
      : valuation.staleSecurityIds.includes(position.securityId)
        ? ('stale' as const)
        : ('current' as const);
    const derived = price ? valuePosition(position, price.value, valuation.totalValue) : null;
    return {
      ...position,
      ticker: security?.ticker ?? '—',
      name: security?.name ?? '—',
      sector: security?.sector ?? null,
      marketDate: price?.marketDate ?? null,
      price: price?.value ?? null,
      marketValue: derived?.marketValue ?? null,
      unrealizedGain: derived?.unrealizedGain ?? null,
      weightPercent: derived?.weightPercent ?? null,
      priceStatus,
    };
  });
  const realized = ledger.realizedGain;
  const expenseEffect = ledger.standaloneExpenses === '0' ? '0' : `-${ledger.standaloneExpenses}`;
  const totalGainExact = addSignedDecimals(
    addSignedDecimals(
      addSignedDecimals(realized, valuation.unrealizedGain),
      ledger.netDividendIncome,
    ),
    expenseEffect,
  );
  const parsed = portfolioValuationSchema.parse({
    portfolioId,
    asOf: asOf.toISOString(),
    valuationDate,
    currency: 'MAD',
    cashValue: valuation.cashValue,
    securitiesValue: valuation.securitiesValue,
    totalValue: valuation.totalValue,
    realizedGain: realized,
    netDividendIncome: ledger.netDividendIncome,
    standaloneExpenses: ledger.standaloneExpenses,
    unrealizedGain: valuation.unrealizedGain,
    totalGain: totalGainExact,
    status: valuation.status,
    missingSecurityIds: valuation.missingSecurityIds,
    staleSecurityIds: valuation.staleSecurityIds,
    positions,
    ruleVersion: 'average-cost-v1',
  });
  return { ...ownership, valuation: parsed, ledger, transactions, priceRows };
}

// Exact signed decimal addition for contract assembly without introducing JS binary floating-point money math.
function addSignedDecimals(a: string, b: string) {
  const parse = (value: string) => {
    const negative = value.startsWith('-');
    const raw = negative ? value.slice(1) : value;
    const [whole = '0', fraction = ''] = raw.split('.');
    return { negative, whole, fraction };
  };
  const left = parse(a);
  const right = parse(b);
  const scale = Math.max(left.fraction.length, right.fraction.length);
  const toInt = (value: ReturnType<typeof parse>) => {
    const digits = `${value.whole}${value.fraction.padEnd(scale, '0')}`.replace(/^0+(?=\d)/, '');
    const integer = BigInt(digits || '0');
    return value.negative ? -integer : integer;
  };
  const sum = toInt(left) + toInt(right);
  const negative = sum < 0n;
  const digits = (negative ? -sum : sum).toString().padStart(scale + 1, '0');
  if (!scale) return `${negative ? '-' : ''}${digits}`;
  const whole = digits.slice(0, -scale) || '0';
  const fraction = digits.slice(-scale).replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

export async function readPortfolioPerformance(
  portfolioId: string,
  requestedTo?: Date,
  requestedFrom?: Date,
) {
  const ownership = await loadOwnedPortfolio(portfolioId);
  if (ownership.status !== 'ok') return ownership;
  const to = requestedTo ?? new Date();
  const toDate = dateOnly(to);
  const fromDate = requestedFrom ? dateOnly(requestedFrom) : null;
  if (fromDate && fromDate > toDate) throw new Error('Invalid performance range');
  const rows = await loadReplayRows(ownership.supabase, portfolioId);
  const transactions = rows.map(toTransaction);
  const securityIds = [
    ...new Set(rows.flatMap((row) => (row.security_id ? [row.security_id] : []))),
  ];
  const priceRows = await loadPrices(ownership.supabase, securityIds, toDate);
  const effectiveDates = rows
    .map((row) => row.effective_at.slice(0, 10))
    .filter((date) => date <= toDate);
  const candidateDates = [...priceRows.map((row) => row.market_date), ...effectiveDates, toDate];
  if (fromDate) candidateDates.push(fromDate);
  const dates = [...new Set(candidateDates)].filter((date) => !fromDate || date >= fromDate).sort();
  const originalById = new Map(rows.map((row) => [row.id, row]));
  const externalFlowForDate = (date: string) => {
    const flows: string[] = [];
    for (const row of rows) {
      if (row.effective_at.slice(0, 10) !== date) continue;
      if (row.transaction_type === 'deposit' && row.gross_amount) flows.push(row.gross_amount);
      if (row.transaction_type === 'withdrawal' && row.gross_amount)
        flows.push(`-${row.gross_amount}`);
      if (row.transaction_type === 'reversal' && row.reverses_transaction_id) {
        const original = originalById.get(row.reverses_transaction_id);
        if (original?.transaction_type === 'deposit' && original.gross_amount)
          flows.push(`-${original.gross_amount}`);
        if (original?.transaction_type === 'withdrawal' && original.gross_amount)
          flows.push(original.gross_amount);
      }
    }
    return flows.reduce((sum, flow) => addSignedDecimals(sum, flow), '0');
  };
  const rawPoints = dates.map((date) => {
    const ledger = calculateLedger(transactions, { asOf: exactAsOf(date) });
    const valuation = valuePortfolioAsOf(ledger, latestPricesAsOf(priceRows, date), date);
    return {
      date,
      totalValue: valuation.totalValue,
      externalFlow: externalFlowForDate(date),
      status: valuation.status,
    };
  });
  const twr = calculateTimeWeightedReturn(rawPoints);
  const hasMissingValuation = rawPoints.some((point) => point.status === 'missing');
  const mergedPoints = rawPoints.map((point, index) => ({
    ...point,
    periodReturn: hasMissingValuation ? null : (twr.points[index]?.periodReturn ?? null),
    cumulativeReturn: hasMissingValuation ? null : (twr.points[index]?.cumulativeReturn ?? null),
  }));
  const investorFlows = rows.flatMap((row) => {
    const date = row.effective_at.slice(0, 10);
    if (date > toDate || (fromDate && date <= fromDate)) return [];
    if (row.transaction_type === 'deposit' && row.gross_amount)
      return [{ date, amount: `-${row.gross_amount}` }];
    if (row.transaction_type === 'withdrawal' && row.gross_amount)
      return [{ date, amount: row.gross_amount }];
    if (row.transaction_type === 'reversal' && row.reverses_transaction_id) {
      const original = originalById.get(row.reverses_transaction_id);
      if (original?.transaction_type === 'deposit' && original.gross_amount)
        return [{ date, amount: original.gross_amount }];
      if (original?.transaction_type === 'withdrawal' && original.gross_amount)
        return [{ date, amount: `-${original.gross_amount}` }];
    }
    return [];
  });
  if (fromDate) {
    const openingLedger = calculateLedger(transactions, { asOf: exactAsOf(fromDate) });
    const openingValuation = valuePortfolioAsOf(
      openingLedger,
      latestPricesAsOf(priceRows, fromDate),
      fromDate,
    );
    if (openingValuation.status !== 'missing' && openingValuation.totalValue !== '0') {
      investorFlows.unshift({ date: fromDate, amount: `-${openingValuation.totalValue}` });
    }
  }
  const terminalPoint = rawPoints.at(-1);
  if (terminalPoint && terminalPoint.status !== 'missing' && terminalPoint.totalValue !== '0') {
    investorFlows.push({ date: toDate, amount: terminalPoint.totalValue });
  }
  const benchmarkAvailable = await hasMasiBenchmarkSeries(ownership.supabase, fromDate, toDate);
  const response = portfolioPerformanceSchema.parse({
    portfolioId,
    from: fromDate ?? dates[0] ?? null,
    to: toDate,
    twr: hasMissingValuation ? null : twr.twr,
    xirr: hasMissingValuation ? null : calculateXirr(investorFlows),
    points: mergedPoints,
    benchmark: { available: benchmarkAvailable, label: 'MASI' },
  });
  return { ...ownership, performance: response };
}
