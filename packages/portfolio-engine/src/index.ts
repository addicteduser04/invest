import Decimal from 'decimal.js';

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN });
export type DecimalString = string;
export type TransactionType =
  'deposit' | 'withdrawal' | 'buy' | 'sell' | 'dividend' | 'fee' | 'tax';
export interface Transaction {
  id: string;
  type: TransactionType;
  settlementDate: string;
  securityId?: string;
  quantity?: DecimalString;
  unitPrice?: DecimalString;
  fees?: DecimalString;
  taxes?: DecimalString;
  amount?: DecimalString;
}
export interface Position {
  securityId: string;
  quantity: DecimalString;
  averageCost: DecimalString;
  costBasis: DecimalString;
  realizedGain: DecimalString;
}
export interface LedgerResult {
  cash: DecimalString;
  positions: Position[];
}
export interface DatedPrice {
  value: DecimalString;
  marketDate: string;
}
export interface ValuationResult {
  cashValue: DecimalString;
  securitiesValue: DecimalString;
  totalValue: DecimalString;
  unrealizedGain: DecimalString;
  status: 'current' | 'stale' | 'missing';
  missingSecurityIds: string[];
  staleSecurityIds: string[];
}

const d = (value: DecimalString | undefined) => new Decimal(value ?? '0');
const out = (value: Decimal) => value.toFixed();

export function calculateLedger(
  transactions: readonly Transaction[],
  options: { asOfDate?: string } = {},
): LedgerResult {
  let cash = new Decimal(0);
  const positions = new Map<
    string,
    { quantity: Decimal; costBasis: Decimal; realizedGain: Decimal }
  >();
  const ordered = [...transactions]
    .filter((transaction) => !options.asOfDate || transaction.settlementDate <= options.asOfDate)
    .sort((a, b) => a.settlementDate.localeCompare(b.settlementDate) || a.id.localeCompare(b.id));
  for (const tx of ordered) {
    const fees = d(tx.fees);
    const taxes = d(tx.taxes);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tx.settlementDate))
      throw new Error(`Invalid settlement date for transaction ${tx.id}`);
    if (fees.lt(0) || taxes.lt(0)) throw new Error('Financial values must be non-negative');
    if (tx.type === 'deposit') {
      if (!tx.amount || d(tx.amount).lte(0)) throw new Error('Deposit must be positive');
      cash = cash.plus(d(tx.amount));
    }
    if (tx.type === 'withdrawal' || tx.type === 'fee' || tx.type === 'tax') {
      if (!tx.amount || d(tx.amount).lte(0)) throw new Error('Amount must be positive');
      cash = cash.minus(d(tx.amount));
    }
    if (tx.type === 'dividend') {
      if (!tx.amount || d(tx.amount).lte(0) || taxes.gt(d(tx.amount)))
        throw new Error('Dividend and withholding tax are invalid');
      cash = cash.plus(d(tx.amount).minus(taxes));
    }
    if (tx.type === 'buy' || tx.type === 'sell') {
      if (!tx.securityId || !tx.quantity || !tx.unitPrice)
        throw new Error('Security, quantity and unit price are required');
      const quantity = d(tx.quantity);
      const gross = quantity.times(d(tx.unitPrice));
      if (quantity.lte(0) || gross.lt(0)) throw new Error('Financial values must be non-negative');
      const current = positions.get(tx.securityId) ?? {
        quantity: new Decimal(0),
        costBasis: new Decimal(0),
        realizedGain: new Decimal(0),
      };
      if (tx.type === 'buy') {
        current.quantity = current.quantity.plus(quantity);
        current.costBasis = current.costBasis.plus(gross).plus(fees).plus(taxes);
        cash = cash.minus(gross).minus(fees).minus(taxes);
      } else {
        if (quantity.gt(current.quantity)) throw new Error('Cannot sell more shares than held');
        const averageCost = current.quantity.isZero()
          ? new Decimal(0)
          : current.costBasis.div(current.quantity);
        const disposedCost = averageCost.times(quantity);
        const proceeds = gross.minus(fees).minus(taxes);
        current.quantity = current.quantity.minus(quantity);
        current.costBasis = current.costBasis.minus(disposedCost);
        current.realizedGain = current.realizedGain.plus(proceeds.minus(disposedCost));
        cash = cash.plus(proceeds);
      }
      positions.set(tx.securityId, current);
    }
    if (cash.lt(0)) throw new Error(`Negative cash after transaction ${tx.id}`);
  }
  return {
    cash: out(cash),
    positions: [...positions.entries()].map(([securityId, p]) => ({
      securityId,
      quantity: out(p.quantity),
      costBasis: out(p.costBasis),
      averageCost: out(p.quantity.isZero() ? new Decimal(0) : p.costBasis.div(p.quantity)),
      realizedGain: out(p.realizedGain),
    })),
  };
}

export function valuePortfolio(
  ledger: LedgerResult,
  prices: Readonly<Record<string, DecimalString>>,
) {
  const securitiesValue = ledger.positions.reduce((sum, position) => {
    const price = prices[position.securityId];
    if (!price) throw new Error(`Missing price for ${position.securityId}`);
    return sum.plus(d(position.quantity).times(d(price)));
  }, new Decimal(0));
  const costBasis = ledger.positions.reduce((sum, p) => sum.plus(d(p.costBasis)), new Decimal(0));
  return {
    cashValue: ledger.cash,
    securitiesValue: out(securitiesValue),
    totalValue: out(securitiesValue.plus(d(ledger.cash))),
    unrealizedGain: out(securitiesValue.minus(costBasis)),
  };
}

export function valuePortfolioAsOf(
  ledger: LedgerResult,
  prices: Readonly<Record<string, DatedPrice | undefined>>,
  valuationDate: string,
  staleAfterDays = 5,
): ValuationResult {
  let securitiesValue = new Decimal(0);
  let costBasis = new Decimal(0);
  const missingSecurityIds: string[] = [];
  const staleSecurityIds: string[] = [];
  const valuationTime = Date.parse(`${valuationDate}T00:00:00Z`);
  if (!Number.isFinite(valuationTime)) throw new Error('Invalid valuation date');

  for (const position of ledger.positions) {
    if (d(position.quantity).isZero()) continue;
    costBasis = costBasis.plus(d(position.costBasis));
    const price = prices[position.securityId];
    if (!price || price.marketDate > valuationDate) {
      missingSecurityIds.push(position.securityId);
      continue;
    }
    const age = Math.floor(
      (valuationTime - Date.parse(`${price.marketDate}T00:00:00Z`)) / 86_400_000,
    );
    if (!Number.isFinite(age) || age < 0) {
      missingSecurityIds.push(position.securityId);
      continue;
    }
    if (age > staleAfterDays) staleSecurityIds.push(position.securityId);
    securitiesValue = securitiesValue.plus(d(position.quantity).times(d(price.value)));
  }

  const status = missingSecurityIds.length
    ? 'missing'
    : staleSecurityIds.length
      ? 'stale'
      : 'current';
  return {
    cashValue: ledger.cash,
    securitiesValue: out(securitiesValue),
    totalValue: out(securitiesValue.plus(d(ledger.cash))),
    unrealizedGain: out(securitiesValue.minus(costBasis)),
    status,
    missingSecurityIds,
    staleSecurityIds,
  };
}
