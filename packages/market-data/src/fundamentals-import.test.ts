import { describe, expect, it } from 'vitest';
import { previewFundamentalsCsv } from './fundamentals-import';

const securities = [
  { id: 'sec-iam', ticker: 'SYN-IAM' },
  { id: 'sec-atw', ticker: 'SYN-ATW' },
];

const header =
  'ticker,period_end_date,publication_date,period_type,interim_period,currency,revenue,ebitda,ebit,net_income,eps,cash,total_debt,total_assets,total_equity,operating_cash_flow,capex,shares_outstanding,dividend_per_share';

describe('fundamentals CSV preview', () => {
  it('accepts a valid annual row, including negative net income and equity', () => {
    const csv = `${header}\nSYN-IAM,2025-12-31,2026-02-15,annual,,MAD,1000,300,250,-50,-0.5,120,400,900,-20,80,60,1000000,0`;
    const preview = previewFundamentalsCsv(csv, securities, []);
    expect(preview.totals).toEqual({
      total: 1,
      valid: 1,
      invalid: 0,
      warnings: 0,
      willInsert: 1,
      willUpdate: 0,
    });
    expect(preview.canConfirm).toBe(true);
    const candidate = preview.rows[0]?.candidate;
    expect(candidate?.netIncome).toBe('-50');
    expect(candidate?.totalEquity).toBe('-20');
    expect(candidate?.fiscalYear).toBe(2025);
    expect(candidate?.interimPeriod).toBeNull();
  });

  it('leaves blank optional fields as undefined rather than coercing to zero', () => {
    const csv = `${header}\nSYN-IAM,2025-12-31,,annual,,,,,,,,,,,,,,,`;
    const preview = previewFundamentalsCsv(csv, securities, []);
    expect(preview.canConfirm).toBe(true);
    const candidate = preview.rows[0]?.candidate;
    expect(candidate?.revenue).toBeUndefined();
    expect(candidate?.publicationDate).toBeNull();
    expect(candidate?.currency).toBe('MAD');
  });

  it('requires interim_period for interim rows and rejects it for annual rows', () => {
    const missingInterim = previewFundamentalsCsv(
      `${header}\nSYN-IAM,2025-06-30,,interim,,MAD,,,,,,,,,,,,,`,
      securities,
      [],
    );
    expect(missingInterim.rows[0]?.errors.some((e) => e.includes('interim_period'))).toBe(true);

    const strayInterim = previewFundamentalsCsv(
      `${header}\nSYN-IAM,2025-12-31,,annual,H1,MAD,,,,,,,,,,,,,`,
      securities,
      [],
    );
    expect(strayInterim.rows[0]?.errors.some((e) => e.includes('interim_period'))).toBe(true);
  });

  it('rejects unknown tickers and malformed dates without aborting the whole file', () => {
    const csv = [
      header,
      'SYN-IAM,2025-12-31,,annual,,MAD,1000,,,,,,,,,,,,',
      'GHOST,2025-12-31,,annual,,MAD,1000,,,,,,,,,,,,',
      'SYN-ATW,not-a-date,,annual,,MAD,1000,,,,,,,,,,,,',
    ].join('\n');
    const preview = previewFundamentalsCsv(csv, securities, []);
    expect(preview.totals).toEqual({
      total: 3,
      valid: 1,
      invalid: 2,
      warnings: 0,
      willInsert: 1,
      willUpdate: 0,
    });
    expect(preview.canConfirm).toBe(false);
    expect(preview.rows[1]?.errors.some((e) => e.includes('unknown ticker'))).toBe(true);
    expect(preview.rows[2]?.errors.some((e) => e.includes('invalid period_end_date'))).toBe(true);
  });

  it('rejects publication_date earlier than period_end_date', () => {
    const csv = `${header}\nSYN-IAM,2025-12-31,2025-01-01,annual,,MAD,,,,,,,,,,,,,`;
    const preview = previewFundamentalsCsv(csv, securities, []);
    expect(preview.rows[0]?.errors.some((e) => e.includes('publication_date'))).toBe(true);
  });

  it('rejects non-finite numeric values but accepts negative operating cash flow', () => {
    const csv = `${header}\nSYN-IAM,2025-12-31,,annual,,MAD,not-a-number,,,,,,,,,-40,,,`;
    const preview = previewFundamentalsCsv(csv, securities, []);
    expect(preview.rows[0]?.errors.some((e) => e.includes('invalid revenue'))).toBe(true);

    const negativeOcf = previewFundamentalsCsv(
      `${header}\nSYN-IAM,2025-12-31,,annual,,MAD,,,,,,,,,,-40,,,`,
      securities,
      [],
    );
    expect(negativeOcf.rows[0]?.errors).toEqual([]);
    expect(negativeOcf.rows[0]?.candidate?.operatingCashFlow).toBe('-40');
  });

  it('rejects negative shares_outstanding and negative capex', () => {
    const preview = previewFundamentalsCsv(
      `${header}\nSYN-IAM,2025-12-31,,annual,,MAD,,,,,,,,,,,-5,-100,`,
      securities,
      [],
    );
    expect(preview.rows[0]?.errors.some((e) => e.includes('capex cannot be negative'))).toBe(true);
    expect(
      preview.rows[0]?.errors.some((e) => e.includes('shares_outstanding cannot be negative')),
    ).toBe(true);
  });

  it('rejects duplicate ticker+period+type rows within the same file', () => {
    const csv = [
      header,
      'SYN-IAM,2025-12-31,,annual,,MAD,1000,,,,,,,,,,,,',
      'SYN-IAM,2025-12-31,,annual,,MAD,1100,,,,,,,,,,,,',
    ].join('\n');
    const preview = previewFundamentalsCsv(csv, securities, []);
    expect(preview.rows[1]?.errors.some((e) => e.includes('duplicate'))).toBe(true);
    expect(preview.canConfirm).toBe(false);
  });

  it('warns (not errors) when a row already has data in the database', () => {
    const csv = `${header}\nSYN-IAM,2025-12-31,,annual,,MAD,1000,,,,,,,,,,,,`;
    const preview = previewFundamentalsCsv(csv, securities, [
      { security_id: 'sec-iam', period_type: 'annual', period_end_date: '2025-12-31' },
    ]);
    expect(preview.rows[0]?.errors).toEqual([]);
    expect(preview.rows[0]?.warnings.some((w) => w.includes('will be updated'))).toBe(true);
    expect(preview.totals).toEqual({
      total: 1,
      valid: 1,
      invalid: 0,
      warnings: 1,
      willInsert: 0,
      willUpdate: 1,
    });
    expect(preview.canConfirm).toBe(true);
  });

  it('rejects a malformed CSV file and an empty file', () => {
    const malformed = previewFundamentalsCsv('"unterminated', securities, []);
    expect(malformed.canConfirm).toBe(false);
    expect(malformed.rows[0]?.errors[0]).toContain('malformed');

    const empty = previewFundamentalsCsv('', securities, []);
    expect(empty.canConfirm).toBe(false);
    expect(empty.rows[0]?.errors[0]).toContain('empty');
  });
});
