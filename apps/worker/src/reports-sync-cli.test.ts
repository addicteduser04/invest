import { describe, expect, it } from 'vitest';
import { parseReportsCliArgs } from './reports-sync-cli';

describe('parseReportsCliArgs', () => {
  it('defaults to a full, non-dry-run scope with no flags', () => {
    expect(parseReportsCliArgs([])).toEqual({ dryRun: false });
  });

  it('parses --dry-run', () => {
    expect(parseReportsCliArgs(['--dry-run'])).toEqual({ dryRun: true });
  });

  it('parses --year', () => {
    expect(parseReportsCliArgs(['--year', '2025'])).toEqual({ dryRun: false, year: 2025 });
  });

  it('parses --ticker and upper-cases it', () => {
    expect(parseReportsCliArgs(['--ticker', 'iam'])).toEqual({ dryRun: false, ticker: 'IAM' });
  });

  it('parses --all', () => {
    expect(parseReportsCliArgs(['--all'])).toEqual({ dryRun: false, all: true });
  });

  it('combines --ticker with --dry-run', () => {
    expect(parseReportsCliArgs(['--ticker', 'ATW', '--dry-run'])).toEqual({
      dryRun: true,
      ticker: 'ATW',
    });
  });

  it('rejects a malformed --year value', () => {
    expect(() => parseReportsCliArgs(['--year', 'abc'])).toThrow('INVALID_YEAR');
  });

  it('rejects --ticker with no value', () => {
    expect(() => parseReportsCliArgs(['--ticker'])).toThrow('INVALID_TICKER');
  });

  it('rejects combining --ticker and --year', () => {
    expect(() => parseReportsCliArgs(['--ticker', 'IAM', '--year', '2024'])).toThrow(
      'INVALID_SCOPE',
    );
  });

  it('ignores a stray "--" separator, e.g. from `pnpm reports:sync -- --ticker IAM`', () => {
    expect(parseReportsCliArgs(['--', '--ticker', 'IAM'])).toEqual({
      dryRun: false,
      ticker: 'IAM',
    });
  });

  it('rejects an unknown flag', () => {
    expect(() => parseReportsCliArgs(['--bogus'])).toThrow('UNKNOWN_ARGUMENT');
  });
});
