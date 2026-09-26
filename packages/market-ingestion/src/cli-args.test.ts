import { describe, expect, it } from 'vitest';
import { DEFAULT_CONCURRENCY, parseCliArgs } from './cli-args';

describe('parseCliArgs', () => {
  it('defaults to concurrency 2, no date, no dry-run, no retry-failed', () => {
    const options = parseCliArgs([]);
    expect(options).toEqual({
      dryRun: false,
      retryFailed: false,
      recoverStale: false,
      triggerSource: 'cli',
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
      recoverStale: false,
      triggerSource: 'cli',
      concurrency: 3,
    });
  });

  it('parses --retry-run, --recover-stale and --trigger-source', () => {
    const options = parseCliArgs([
      '--retry-run',
      '650B1586-07E1-45DA-8BCB-98366BCAF3DE',
      '--recover-stale',
      '--trigger-source',
      'manual',
    ]);
    expect(options).toMatchObject({
      retryRunId: '650b1586-07e1-45da-8bcb-98366bcaf3de',
      recoverStale: true,
      triggerSource: 'manual',
    });
  });

  it('rejects a malformed run id and an unknown trigger source', () => {
    expect(() => parseCliArgs(['--retry-run', "x'; drop table"])).toThrow(/Invalid run id/);
    expect(() => parseCliArgs(['--trigger-source', 'retry'])).toThrow(/--trigger-source/);
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
