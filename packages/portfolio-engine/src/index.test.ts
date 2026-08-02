import { describe, expect, it } from 'vitest';
import { calculateLedger, valuePortfolio } from './index';

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
