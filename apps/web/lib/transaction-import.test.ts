import { describe, expect, it } from 'vitest';
import { previewTransactionCsv, type ImportMapping } from './transaction-import';

const mapping: ImportMapping = {
  date: 'date',
  type: 'type',
  security: 'security',
  quantity: 'quantity',
  unitPrice: 'value',
  fees: 'fees',
  taxes: 'taxes',
  currency: 'currency',
  externalReference: 'reference',
  description: 'description',
};
const securities = new Map([['IAM', '00000000-0000-4000-8000-000000000001']]);
describe('transaction CSV preview', () => {
  it('maps every type while preserving exact decimals', () => {
    const body = [
      'date,type,security,quantity,value,fees,taxes,currency,reference,description',
      '2026-01-01,deposit,,,100.000001,0,0,MAD,ref-000000000001,',
      '2026-01-02,withdrawal,,,1,0,0,MAD,ref-000000000002,',
      '2026-01-03,buy,IAM,2.5,10.01,0.1,0,MAD,ref-000000000003,',
      '2026-01-04,sell,IAM,1,11,0,0,MAD,ref-000000000004,',
      '2026-01-05,dividend,,,5,0,0,MAD,ref-000000000005,',
      '2026-01-06,fee,,,2,0,0,MAD,ref-000000000006,',
      '2026-01-07,tax,,,1,0,0,MAD,ref-000000000007,',
    ].join('\n');
    const preview = previewTransactionCsv(body, mapping, securities);
    expect(preview.totals).toMatchObject({ total: 7, valid: 7, invalid: 0 });
    expect(preview.rows[0]!.transaction!.amount).toBe('100.000001');
  });
  it('finds duplicate rows and references', () => {
    const row = '2026-01-01,deposit,,100,,,MAD,ref-000000000001,';
    const result = previewTransactionCsv(
      `date,type,security,quantity,value,fees,taxes,currency,reference,description\n${row}\n${row}`,
      mapping,
      securities,
    );
    expect(result.canConfirm).toBe(false);
    expect(result.totals.duplicates).toBe(1);
  });
  it('rejects exponential decimals and unknown securities', () => {
    const result = previewTransactionCsv(
      'date,type,security,quantity,value,fees,taxes,currency,reference,description\n2026-01-01,buy,NOPE,1e3,2,0,0,MAD,ref-000000000001,',
      mapping,
      securities,
    );
    expect(result.rows[0]!.errors.map((error) => error.code)).toEqual(
      expect.arrayContaining(['INVALID_DECIMAL', 'UNKNOWN_SECURITY']),
    );
  });
});
