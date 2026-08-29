import { describe, expect, it } from 'vitest';
import { calculateLedger, valuePortfolio, valuePortfolioAsOf } from './index';

describe('golden first vertical slice', () => {
  it('reconciles deposit, buy, weighted cost and valuation exactly', () => {
    const ledger = calculateLedger([
      { id: '1', type: 'deposit', settlementDate: '2026-01-02', amount: '100000.00' },
      {
        id: '2',
        type: 'buy',
        settlementDate: '2026-01-03',
        securityId: 'IAM',
        quantity: '100',
        unitPrice: '95.25',
        fees: '20.50',
        taxes: '4.75',
      },
      {
        id: '3',
        type: 'buy',
        settlementDate: '2026-01-04',
        securityId: 'IAM',
        quantity: '50',
        unitPrice: '100',
        fees: '10',
        taxes: '2.5',
      },
    ]);
    expect(ledger.cash).toBe('85437.25');
    expect(ledger.netDividendIncome).toBe('0');
    expect(ledger.standaloneExpenses).toBe('0');
    expect(ledger.positions[0]).toEqual({
      securityId: 'IAM',
      quantity: '150',
      costBasis: '14562.75',
      averageCost: '97.085',
      realizedGain: '0',
    });
    expect(valuePortfolio(ledger, { IAM: '110' })).toEqual({
      cashValue: '85437.25',
      securitiesValue: '16500',
      totalValue: '101937.25',
      unrealizedGain: '1937.25',
    });
  });
  it('rejects negative cash atomically', () =>
    expect(() =>
      calculateLedger([
        {
          id: '1',
          type: 'buy',
          settlementDate: '2026-01-01',
          securityId: 'IAM',
          quantity: '1',
          unitPrice: '1',
        },
      ]),
    ).toThrow('Negative cash'));
});

describe('Sprint 2 accounting rules', () => {
  const history = [
    { id: '01', type: 'deposit' as const, settlementDate: '2026-01-02', amount: '1000' },
    { id: '02', type: 'deposit' as const, settlementDate: '2026-01-02', amount: '500' },
    {
      id: '03',
      type: 'buy' as const,
      settlementDate: '2026-01-03',
      securityId: 'IAM',
      quantity: '10',
      unitPrice: '50',
      fees: '5',
      taxes: '5',
    },
    {
      id: '04',
      type: 'buy' as const,
      settlementDate: '2026-01-03',
      securityId: 'IAM',
      quantity: '10',
      unitPrice: '70',
    },
    {
      id: '05',
      type: 'sell' as const,
      settlementDate: '2026-01-04',
      securityId: 'IAM',
      quantity: '5',
      unitPrice: '80',
      fees: '4',
      taxes: '1',
    },
    {
      id: '06',
      type: 'dividend' as const,
      settlementDate: '2026-01-05',
      amount: '30',
      taxes: '3',
    },
    { id: '07', type: 'fee' as const, settlementDate: '2026-01-05', amount: '2' },
    { id: '08', type: 'tax' as const, settlementDate: '2026-01-05', amount: '1' },
  ];

  it('calculates weighted cost, partial sale, realized gain, dividends, fees and taxes', () => {
    expect(calculateLedger(history)).toEqual({
      cash: '709',
      positions: [
        {
          securityId: 'IAM',
          quantity: '15',
          costBasis: '907.5',
          averageCost: '60.5',
          realizedGain: '92.5',
        },
      ],
      realizedGain: '92.5',
      netDividendIncome: '27',
      standaloneExpenses: '3',
      transactionCount: 8,
      lastTransactionId: '08',
      lastTransactionRecordedAt: null,
    });
  });

  it('orders same-day transactions by immutable id and supports an as-of boundary', () => {
    expect(calculateLedger([...history].reverse(), { asOfDate: '2026-01-03' }).cash).toBe('290');
    expect(calculateLedger(history, { asOfDate: '2026-01-02' }).cash).toBe('1500');
    expect(calculateLedger(history)).toEqual(calculateLedger(history));
  });

  it('reports current, stale and missing price states without valuing future prices', () => {
    const ledger = calculateLedger(history);
    expect(
      valuePortfolioAsOf(ledger, { IAM: { value: '75', marketDate: '2026-01-05' } }, '2026-01-06'),
    ).toMatchObject({ status: 'current', securitiesValue: '1125', unrealizedGain: '217.5' });
    expect(
      valuePortfolioAsOf(ledger, { IAM: { value: '75', marketDate: '2026-01-01' } }, '2026-01-10'),
    ).toMatchObject({ status: 'stale', staleSecurityIds: ['IAM'] });
    expect(valuePortfolioAsOf(ledger, {}, '2026-01-06')).toMatchObject({
      status: 'missing',
      missingSecurityIds: ['IAM'],
    });
  });

  it.each([
    [{ id: 'x', type: 'deposit', settlementDate: '2026-01-01', amount: '-1' }, 'positive'],
    [
      {
        id: 'x',
        type: 'buy',
        settlementDate: '2026-01-01',
        securityId: 'IAM',
        quantity: '0',
        unitPrice: '1',
      },
      'non-negative',
    ],
    [
      { id: 'x', type: 'dividend', settlementDate: '2026-01-01', amount: '2', taxes: '3' },
      'Dividend',
    ],
  ])('rejects invalid financial input %#', (transaction, message) => {
    expect(() => calculateLedger([transaction as never])).toThrow(message);
  });

  it('keeps exact decimal arithmetic at rounding boundaries', () => {
    const ledger = calculateLedger([
      { id: '1', type: 'deposit', settlementDate: '2026-01-01', amount: '1' },
      {
        id: '2',
        type: 'buy',
        settlementDate: '2026-01-02',
        securityId: 'IAM',
        quantity: '3',
        unitPrice: '0.1',
      },
    ]);
    expect(ledger.cash).toBe('0.7');
    expect(ledger.positions[0]!.averageCost).toBe('0.1');
  });

  it('reconstructs empty, between-transaction, and fully closed position states exactly', () => {
    const transactions = [
      {
        id: 'z-deposit',
        type: 'deposit' as const,
        settlementDate: '2026-01-02',
        amount: '100',
        effectiveAt: '2026-01-02T10:00:00.000Z',
        ledgerSequence: '1',
      },
      {
        id: 'a-buy',
        type: 'buy' as const,
        settlementDate: '2026-01-02',
        securityId: 'IAM',
        quantity: '2',
        unitPrice: '10',
        fees: '2',
        effectiveAt: '2026-01-02T10:00:00.000Z',
        ledgerSequence: '2',
      },
      {
        id: 'sale',
        type: 'sell' as const,
        settlementDate: '2026-01-03',
        securityId: 'IAM',
        quantity: '2',
        unitPrice: '15',
        fees: '1',
        ledgerSequence: '3',
      },
    ];
    expect(calculateLedger(transactions, { asOf: '2026-01-01T23:59:59.999Z' })).toMatchObject({
      cash: '0',
      positions: [],
      transactionCount: 0,
    });
    expect(calculateLedger(transactions, { asOf: '2026-01-02T10:00:00.000Z' })).toMatchObject({
      cash: '78',
      transactionCount: 2,
    });
    expect(calculateLedger(transactions)).toMatchObject({
      cash: '107',
      realizedGain: '7',
      positions: [{ securityId: 'IAM', quantity: '0', costBasis: '0', averageCost: '0' }],
    });
  });

  it('treats a linked reversal as removal of the immutable original for all as-of calculations', () => {
    const reversal = {
      id: '09',
      type: 'reversal' as const,
      settlementDate: '2026-01-03',
      reversesTransactionId: '03',
    };
    const corrected = calculateLedger([...history, reversal]);
    const withoutOriginal = calculateLedger(
      history.filter((transaction) => transaction.id !== '03'),
    );
    expect({ cash: corrected.cash, positions: corrected.positions }).toEqual({
      cash: withoutOriginal.cash,
      positions: withoutOriginal.positions,
    });
    const correctedAsOf = calculateLedger([...history, reversal], { asOfDate: '2026-01-03' });
    const withoutOriginalAsOf = calculateLedger(
      history.filter((transaction) => transaction.id !== '03'),
      { asOfDate: '2026-01-03' },
    );
    expect({ cash: correctedAsOf.cash, positions: correctedAsOf.positions }).toEqual({
      cash: withoutOriginalAsOf.cash,
      positions: withoutOriginalAsOf.positions,
    });
  });

  it('preserves the historical state before a later correction becomes effective', () => {
    const original = {
      id: 'original',
      type: 'fee' as const,
      settlementDate: '2026-01-02',
      amount: '10',
      recordedAt: '2026-01-02T10:00:00.000Z',
    };
    const transactions = [
      {
        id: 'deposit',
        type: 'deposit' as const,
        settlementDate: '2026-01-01',
        amount: '100',
        recordedAt: '2026-01-01T10:00:00.000Z',
      },
      original,
      {
        id: 'reversal',
        type: 'reversal' as const,
        settlementDate: '2026-01-02',
        reversesTransactionId: original.id,
        recordedAt: '2026-02-01T10:00:00.000Z',
        effectiveAt: '2026-02-01T10:00:00.000Z',
      },
    ];
    expect(calculateLedger(transactions, { asOf: '2026-01-15T00:00:00.000Z' }).cash).toBe('90');
    expect(calculateLedger(transactions, { asOf: '2026-02-02T00:00:00.000Z' }).cash).toBe('100');
  });

  it('rejects orphan and duplicate reversals', () => {
    expect(() =>
      calculateLedger([
        {
          id: 'orphan',
          type: 'reversal',
          settlementDate: '2026-01-01',
          reversesTransactionId: 'missing',
        },
      ]),
    ).toThrow('Missing reversed transaction');
    expect(() =>
      calculateLedger([
        ...history,
        {
          id: '09',
          type: 'reversal',
          settlementDate: '2026-01-03',
          reversesTransactionId: '03',
        },
        {
          id: '10',
          type: 'reversal',
          settlementDate: '2026-01-03',
          reversesTransactionId: '03',
        },
      ]),
    ).toThrow('reversed more than once');
  });
});

describe('MVP performance analytics', () => {
  it('calculates TWR without treating capital contributions as investment return', async () => {
    const { calculateTimeWeightedReturn } = await import('./index');
    const result = calculateTimeWeightedReturn([
      { date: '2026-01-01', totalValue: '100', externalFlow: '100' },
      { date: '2026-01-02', totalValue: '110', externalFlow: '0' },
      { date: '2026-01-03', totalValue: '220', externalFlow: '100' },
    ]);
    expect(result.points[1]?.periodReturn).toBe('0.1');
    expect(result.points[2]?.periodReturn).toBe('0.090909090909090909090909090909090909091');
    expect(result.twr).toBe('0.2');
  });

  it('returns an annualized XIRR for dated investor cash flows', async () => {
    const { calculateXirr } = await import('./index');
    const result = calculateXirr([
      { date: '2026-01-01', amount: '-100' },
      { date: '2027-01-01', amount: '110' },
    ]);
    expect(result).not.toBeNull();
    expect(Number(result)).toBeCloseTo(0.1, 8);
  });
});

describe('MVP income and expense attribution', () => {
  it('tracks net dividends and standalone expenses and reverses them at correction time', () => {
    const history = [
      { id: 'd', type: 'deposit' as const, settlementDate: '2026-01-01', amount: '100' },
      {
        id: 'div',
        type: 'dividend' as const,
        settlementDate: '2026-01-02',
        amount: '20',
        taxes: '3',
      },
      { id: 'fee', type: 'fee' as const, settlementDate: '2026-01-03', amount: '2' },
    ];
    expect(calculateLedger(history)).toMatchObject({
      cash: '115',
      netDividendIncome: '17',
      standaloneExpenses: '2',
    });
    expect(
      calculateLedger([
        ...history,
        {
          id: 'reverse-div',
          type: 'reversal' as const,
          settlementDate: '2026-01-10',
          reversesTransactionId: 'div',
          effectiveAt: '2026-01-10T12:00:00.000Z',
        },
      ]),
    ).toMatchObject({ cash: '98', netDividendIncome: '0', standaloneExpenses: '2' });
  });
});
