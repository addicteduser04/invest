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

  it('treats a linked reversal as removal of the immutable original for all as-of calculations', () => {
    const reversal = {
      id: '09',
      type: 'reversal' as const,
      settlementDate: '2026-01-03',
      reversesTransactionId: '03',
    };
    expect(calculateLedger([...history, reversal])).toEqual(
      calculateLedger(history.filter((transaction) => transaction.id !== '03')),
    );
    expect(calculateLedger([...history, reversal], { asOfDate: '2026-01-03' })).toEqual(
      calculateLedger(
        history.filter((transaction) => transaction.id !== '03'),
        {
          asOfDate: '2026-01-03',
        },
      ),
    );
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
