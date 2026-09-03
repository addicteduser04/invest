import { describe, expect, it } from 'vitest';
import {
  localizeError,
  portfolioPerformanceSchema,
  portfolioStateSchema,
  portfolioValuationSchema,
  reversalInputSchema,
  transactionInputSchema,
} from './index';
describe('shared contracts', () => {
  it('keeps behavior codes stable while localizing messages', () => {
    expect(localizeError({ code: 'INSUFFICIENT_CASH' }, 'fr')).toContain('Trésorerie');
    expect(localizeError({ code: 'INSUFFICIENT_CASH' }, 'ar')).toContain('السيولة');
    expect(localizeError({ code: 'INSUFFICIENT_CASH' }, 'en')).toContain('Insufficient');
  });
  it('accepts every Sprint 2 transaction type with exact decimal strings', () => {
    for (const type of ['deposit', 'withdrawal', 'buy', 'sell', 'dividend', 'fee', 'tax'])
      expect(
        transactionInputSchema.safeParse({
          portfolioId: '00000000-0000-4000-8000-000000000001',
          type,
          settlementDate: '2026-08-05',
          amount: '0.000001',
          currency: 'MAD',
          idempotencyKey: 'reference-0000001',
        }).success,
      ).toBe(true);
  });
  it('rejects exponential and signed decimal notation', () => {
    expect(
      transactionInputSchema.safeParse({
        portfolioId: '00000000-0000-4000-8000-000000000001',
        type: 'deposit',
        settlementDate: '2026-08-05',
        amount: '1e3',
        currency: 'MAD',
        idempotencyKey: 'reference-0000001',
      }).success,
    ).toBe(false);
  });
  it('validates reversal reasons and atomic replacements without accepting effect totals', () => {
    const parsed = reversalInputSchema.parse({
      locale: 'ar',
      reason: 'سبب موثق لتصحيح العملية',
      idempotencyReference: 'reversal-reference-0001',
      replacement: {
        type: 'fee',
        settlementDate: '2026-08-20',
        amount: '2.5',
        currency: 'MAD',
      },
      cashEffect: '999999',
    });
    expect(parsed).not.toHaveProperty('cashEffect');
    expect(parsed.replacement?.type).toBe('fee');
    expect(
      reversalInputSchema.safeParse({
        locale: 'fr',
        reason: 'court',
        idempotencyReference: 'reversal-reference-0001',
      }).success,
    ).toBe(false);
  });
  it('keeps portfolio-state money and quantities as exact decimal strings', () => {
    const state = {
      portfolioId: '00000000-0000-4000-8000-000000000001',
      asOf: '2026-08-27T12:00:00.000Z',
      cash: '0.3000000001',
      realizedGain: '-1.25',
      positions: [],
      transactionCount: 0,
      lastTransactionId: null,
      lastTransactionRecordedAt: null,
      source: 'replay',
      ruleVersion: 'average-cost-v1',
    };
    expect(portfolioStateSchema.parse(state).cash).toBe('0.3000000001');
    expect(portfolioStateSchema.safeParse({ ...state, cash: 0.3 }).success).toBe(false);
  });
  it('keeps MASI benchmark returns explicit and typed as a price index', () => {
    const performance = portfolioPerformanceSchema.parse({
      portfolioId: '00000000-0000-4000-8000-000000000001',
      from: '2026-01-02',
      to: '2026-08-28',
      twr: '0.12',
      xirr: '0.11',
      points: [],
      benchmark: {
        available: true,
        label: 'MASI',
        kind: 'price_index',
        from: '2026-01-02',
        to: '2026-08-28',
        cumulativeReturn: '0.08',
      },
    });
    expect(performance.benchmark.cumulativeReturn).toBe('0.08');
    expect(performance.benchmark.kind).toBe('price_index');
  });

  it('keeps valuation, dividends and expenses as exact decimal strings', () => {
    const value = portfolioValuationSchema.parse({
      portfolioId: '00000000-0000-4000-8000-000000000001',
      asOf: '2026-08-28T12:00:00.000Z',
      valuationDate: '2026-08-28',
      currency: 'MAD',
      cashValue: '101.25',
      securitiesValue: '250',
      totalValue: '351.25',
      realizedGain: '10',
      netDividendIncome: '5.25',
      standaloneExpenses: '1',
      unrealizedGain: '-2',
      totalGain: '12.25',
      status: 'current',
      missingSecurityIds: [],
      staleSecurityIds: [],
      positions: [],
      ruleVersion: 'average-cost-v1',
    });
    expect(value.netDividendIncome).toBe('5.25');
    expect(portfolioValuationSchema.safeParse({ ...value, totalValue: 351.25 }).success).toBe(
      false,
    );
  });
});
