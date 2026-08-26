import { describe, expect, it } from 'vitest';
import { localizeError, reversalInputSchema, transactionInputSchema } from './index';
describe('shared contracts', () => {
  it('keeps behavior codes stable while localizing messages', () => {
    expect(localizeError({ code: 'INSUFFICIENT_CASH' }, 'fr')).toContain('Trésorerie');
    expect(localizeError({ code: 'INSUFFICIENT_CASH' }, 'ar')).toContain('السيولة');
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
});
