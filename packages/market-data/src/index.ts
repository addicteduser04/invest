import { createHash } from 'node:crypto';
import Decimal from 'decimal.js';
import { parse } from 'csv-parse/sync';

export interface CsvMapping {
  date: string;
  ticker: string;
  close: string;
  open?: string | undefined;
  high?: string | undefined;
  low?: string | undefined;
  volume?: string | undefined;
}
export interface CandidatePrice {
  row: number;
  ticker: string;
  marketDate: string;
  close: string;
  open?: string | undefined;
  high?: string | undefined;
  low?: string | undefined;
  volume?: string | undefined;
}
export interface CsvPreview {
  sourceHash: string;
  candidates: CandidatePrice[];
  errors: string[];
  warnings: string[];
}
export interface MarketDataProvider {
  providerId: string;
  preview(input: string, mapping: CsvMapping): Promise<CsvPreview>;
}

const decimal = (value: unknown, label: string, row: number, errors: string[]) => {
  if (value === undefined || value === '') return undefined;
  try {
    const parsed = new Decimal(String(value));
    if (parsed.isNegative()) throw new Error();
    return parsed.toFixed();
  } catch {
    errors.push(`Row ${row}: invalid ${label}`);
    return undefined;
  }
};

export class AdminCsvProvider implements MarketDataProvider {
  providerId = 'admin_csv';
  async preview(input: string, mapping: CsvMapping): Promise<CsvPreview> {
    const records = parse(input, { columns: true, skip_empty_lines: true, trim: true }) as Record<
      string,
      string
    >[];
    const errors: string[] = [];
    const warnings: string[] = [];
    const candidates: CandidatePrice[] = [];
    const seen = new Set<string>();
    const dates = new Set<string>();
    records.forEach((record, index) => {
      const row = index + 2;
      const rawDate = record[mapping.date] ?? '';
      const marketDate = rawDate.slice(0, 10);
      const ticker = (record[mapping.ticker] ?? '').trim().toUpperCase();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(marketDate)) errors.push(`Row ${row}: invalid date`);
      if (!ticker) errors.push(`Row ${row}: missing ticker`);
      const close = decimal(record[mapping.close], 'close', row, errors);
      if (!close || new Decimal(close).lte(0)) errors.push(`Row ${row}: close must be positive`);
      const key = `${ticker}:${marketDate}`;
      if (seen.has(key)) errors.push(`Row ${row}: duplicate ${key}`);
      seen.add(key);
      dates.add(marketDate);
      if (ticker && close && /^\d{4}-\d{2}-\d{2}$/.test(marketDate))
        candidates.push({
          row,
          ticker,
          marketDate,
          close,
          ...(mapping.open ? { open: decimal(record[mapping.open], 'open', row, errors) } : {}),
          ...(mapping.high ? { high: decimal(record[mapping.high], 'high', row, errors) } : {}),
          ...(mapping.low ? { low: decimal(record[mapping.low], 'low', row, errors) } : {}),
          ...(mapping.volume
            ? { volume: decimal(record[mapping.volume], 'volume', row, errors) }
            : {}),
        });
    });
    const orderedDates = [...dates].sort();
    if (orderedDates.length > 1)
      warnings.push('Confirm intentionally missing market dates before approval.');
    return {
      sourceHash: createHash('sha256').update(input).digest('hex'),
      candidates,
      errors,
      warnings,
    };
  }
}
