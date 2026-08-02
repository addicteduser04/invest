import { describe, expect, it } from 'vitest';
import { AdminCsvProvider } from './index';

describe('administrator CSV provider', () => {
  it('maps common TradingView-style columns without claiming a licensed source', async () => {
    const csv =
      'time,symbol,open,high,low,close,volume\n2026-01-02T00:00:00Z,IAM,100,102,99,101.5,2000';
    const preview = await new AdminCsvProvider().preview(csv, {
      date: 'time',
      ticker: 'symbol',
      close: 'close',
      open: 'open',
      high: 'high',
      low: 'low',
      volume: 'volume',
    });
    expect(preview.errors).toEqual([]);
    expect(preview.candidates[0]?.close).toBe('101.5');
    expect(preview.sourceHash).toHaveLength(64);
  });
  it('detects duplicate instrument dates', async () => {
    const csv = 'date,ticker,close\n2026-01-02,IAM,101\n2026-01-02,IAM,102';
    const preview = await new AdminCsvProvider().preview(csv, {
      date: 'date',
      ticker: 'ticker',
      close: 'close',
    });
    expect(preview.errors.some((error) => error.includes('duplicate'))).toBe(true);
  });
});
