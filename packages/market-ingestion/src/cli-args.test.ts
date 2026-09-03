import { describe, expect, it } from 'vitest';
import { DEFAULT_CONCURRENCY, parseCliArgs } from './cli-args';

describe('parseCliArgs', () => {
  it('defaults to concurrency 2, no date, no dry-run, no retry-failed', () => {
    const options = parseCliArgs([]);
    expect(options).toEqual({
      dryRun: false,
      retryFailed: false,
      concurrency: DEFAULT_CONCURRENCY,
    });
  });

  it('parses --date, --tickers, --dry-run, --retry-failed, --concurrency', () => {
    const options = parseCliArgs([
      '--date',
      '2026-09-01',
      '--tickers',
      'iam,atw, bcp',
      '--dry-run',
      '--retry-failed',
      '--concurrency',
      '3',
    ]);
    expect(options).toEqual({
      date: '2026-09-01',
      tickers: ['IAM', 'ATW', 'BCP'],
      dryRun: true,
      retryFailed: true,
      concurrency: 3,
    });
  });

  it('parses a single --ticker', () => {
    expect(parseCliArgs(['--ticker', 'iam']).tickers).toEqual(['IAM']);
  });

  it('rejects an invalid date', () => {
    expect(() => parseCliArgs(['--date', '09-01-2026'])).toThrow(/Invalid date/);
  });

  it('rejects concurrency above the cap', () => {
    expect(() => parseCliArgs(['--concurrency', '99'])).toThrow(/--concurrency must be between/);
  });

  it('rejects an unknown option', () => {
    expect(() => parseCliArgs(['--bogus'])).toThrow(/Unknown option/);
  });
});
