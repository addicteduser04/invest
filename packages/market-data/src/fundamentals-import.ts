import { createHash } from 'node:crypto';
import Decimal from 'decimal.js';
import { parse } from 'csv-parse/sync';

export interface KnownSecurity {
  id: string;
  ticker: string;
}

export interface ExistingFundamentalsPeriod {
  security_id: string;
  period_type: 'annual' | 'interim';
  period_end_date: string;
}

export interface FundamentalsCandidate {
  securityId: string;
  ticker: string;
  periodType: 'annual' | 'interim';
  interimPeriod: 'H1' | 'H2' | null;
  fiscalYear: number;
  periodEndDate: string;
  publicationDate: string | null;
  currency: string;
  revenue?: string;
  ebitda?: string;
  ebit?: string;
  netIncome?: string;
  eps?: string;
  cash?: string;
  totalDebt?: string;
  totalAssets?: string;
  totalEquity?: string;
  operatingCashFlow?: string;
  capex?: string;
  sharesOutstanding?: string;
  dividendPerShare?: string;
}

export interface FundamentalsPreviewRow {
  row: number;
  values: Record<string, string>;
  candidate?: FundamentalsCandidate;
  errors: string[];
  warnings: string[];
}

export interface FundamentalsImportPreview {
  sourceHash: string;
  rows: FundamentalsPreviewRow[];
  totals: {
    total: number;
    valid: number;
    invalid: number;
    warnings: number;
    willInsert: number;
    willUpdate: number;
  };
  canConfirm: boolean;
}

const isIsoCalendarDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month! - 1 && date.getUTCDate() === day
  );
};

const signedDecimal = (
  value: string,
  label: string,
  row: number,
  errors: string[],
): string | undefined => {
  if (value === '') return undefined;
  try {
    const parsed = new Decimal(value);
    if (!parsed.isFinite()) throw new Error('non-finite');
    return parsed.toFixed();
  } catch {
    errors.push(`Row ${row}: invalid ${label}`);
    return undefined;
  }
};

const nonNegativeDecimal = (
  value: string,
  label: string,
  row: number,
  errors: string[],
): string | undefined => {
  const parsed = signedDecimal(value, label, row, errors);
  if (parsed !== undefined && new Decimal(parsed).isNegative()) {
    errors.push(`Row ${row}: ${label} cannot be negative`);
    return undefined;
  }
  return parsed;
};

const emptyTotals = { total: 0, valid: 0, invalid: 0, warnings: 0, willInsert: 0, willUpdate: 0 };

/**
 * Parse an admin-supplied fundamentals CSV: one row per company/period, blanks stay null
 * (never coerced to 0), negative financial values are accepted (loss-making periods are real),
 * and any file containing at least one invalid row cannot be confirmed as a whole -- matching
 * the codebase's existing all-or-nothing admin-CSV convention.
 */
export function previewFundamentalsCsv(
  input: string,
  knownSecurities: KnownSecurity[],
  existingPeriods: ExistingFundamentalsPeriod[],
): FundamentalsImportPreview {
  const sourceHash = createHash('sha256').update(input).digest('hex');
  let records: Record<string, string>[];
  try {
    records = parse(input, { columns: true, skip_empty_lines: true, trim: true }) as Record<
      string,
      string
    >[];
  } catch {
    return {
      sourceHash,
      rows: [{ row: 1, values: {}, errors: ['Fundamentals CSV is malformed'], warnings: [] }],
      totals: emptyTotals,
      canConfirm: false,
    };
  }
  if (!records.length) {
    return {
      sourceHash,
      rows: [{ row: 1, values: {}, errors: ['Fundamentals CSV is empty'], warnings: [] }],
      totals: emptyTotals,
      canConfirm: false,
    };
  }

  const tickerToId = new Map(knownSecurities.map((s) => [s.ticker.toUpperCase(), s.id]));
  const existingKeys = new Set(
    existingPeriods.map((p) => `${p.security_id}:${p.period_type}:${p.period_end_date}`),
  );
  const seenInFile = new Set<string>();

  const rows: FundamentalsPreviewRow[] = records.map((record, index) => {
    const row = index + 2;
    const errors: string[] = [];
    const warnings: string[] = [];

    const ticker = String(record['ticker'] ?? '')
      .trim()
      .toUpperCase();
    const securityId = ticker ? tickerToId.get(ticker) : undefined;
    if (!ticker) errors.push(`Row ${row}: missing ticker`);
    else if (!securityId) errors.push(`Row ${row}: unknown ticker ${ticker}`);

    const periodType = String(record['period_type'] ?? '')
      .trim()
      .toLowerCase();
    if (!['annual', 'interim'].includes(periodType)) errors.push(`Row ${row}: invalid period_type`);

    const interimPeriodRaw = String(record['interim_period'] ?? '')
      .trim()
      .toUpperCase();
    if (periodType === 'interim' && !['H1', 'H2'].includes(interimPeriodRaw))
      errors.push(`Row ${row}: interim_period must be H1 or H2 for interim periods`);
    if (periodType === 'annual' && interimPeriodRaw)
      errors.push(`Row ${row}: interim_period must be blank for annual periods`);

    const periodEndDateRaw = String(record['period_end_date'] ?? '').trim();
    const validPeriodEnd = isIsoCalendarDate(periodEndDateRaw);
    if (!validPeriodEnd) errors.push(`Row ${row}: invalid period_end_date`);

    const publicationDateRaw = String(record['publication_date'] ?? '').trim();
    const hasPublicationDate = publicationDateRaw !== '';
    const validPublicationDate = !hasPublicationDate || isIsoCalendarDate(publicationDateRaw);
    if (hasPublicationDate && !validPublicationDate)
      errors.push(`Row ${row}: invalid publication_date`);
    if (
      hasPublicationDate &&
      validPublicationDate &&
      validPeriodEnd &&
      publicationDateRaw < periodEndDateRaw
    )
      errors.push(`Row ${row}: publication_date cannot be before period_end_date`);

    const currencyRaw = String(record['currency'] ?? '')
      .trim()
      .toUpperCase();
    if (currencyRaw && !/^[A-Z]{3}$/.test(currencyRaw)) errors.push(`Row ${row}: invalid currency`);
    const currency = currencyRaw || 'MAD';

    const revenue = signedDecimal(String(record['revenue'] ?? '').trim(), 'revenue', row, errors);
    const ebitda = signedDecimal(String(record['ebitda'] ?? '').trim(), 'ebitda', row, errors);
    const ebit = signedDecimal(String(record['ebit'] ?? '').trim(), 'ebit', row, errors);
    const netIncome = signedDecimal(
      String(record['net_income'] ?? '').trim(),
      'net_income',
      row,
      errors,
    );
    const eps = signedDecimal(String(record['eps'] ?? '').trim(), 'eps', row, errors);
    const cash = signedDecimal(String(record['cash'] ?? '').trim(), 'cash', row, errors);
    const totalDebt = signedDecimal(
      String(record['total_debt'] ?? '').trim(),
      'total_debt',
      row,
      errors,
    );
    const totalAssets = signedDecimal(
      String(record['total_assets'] ?? '').trim(),
      'total_assets',
      row,
      errors,
    );
    const totalEquity = signedDecimal(
      String(record['total_equity'] ?? '').trim(),
      'total_equity',
      row,
      errors,
    );
    const operatingCashFlow = signedDecimal(
      String(record['operating_cash_flow'] ?? '').trim(),
      'operating_cash_flow',
      row,
      errors,
    );
    const capex = nonNegativeDecimal(String(record['capex'] ?? '').trim(), 'capex', row, errors);
    const sharesOutstanding = nonNegativeDecimal(
      String(record['shares_outstanding'] ?? '').trim(),
      'shares_outstanding',
      row,
      errors,
    );
    const dividendPerShare = signedDecimal(
      String(record['dividend_per_share'] ?? '').trim(),
      'dividend_per_share',
      row,
      errors,
    );

    let candidate: FundamentalsCandidate | undefined;
    if (securityId && validPeriodEnd && !errors.length) {
      const dedupeKey = `${securityId}:${periodType}:${periodEndDateRaw}`;
      if (seenInFile.has(dedupeKey)) {
        errors.push(
          `Row ${row}: duplicate ${ticker} ${periodType} ${periodEndDateRaw} in this file`,
        );
      } else {
        seenInFile.add(dedupeKey);
        if (existingKeys.has(dedupeKey))
          warnings.push(
            `Row ${row}: ${ticker} ${periodType} ${periodEndDateRaw} already has data and will be updated`,
          );
        candidate = {
          securityId,
          ticker,
          periodType: periodType as 'annual' | 'interim',
          interimPeriod: periodType === 'interim' ? (interimPeriodRaw as 'H1' | 'H2') : null,
          fiscalYear: Number(periodEndDateRaw.slice(0, 4)),
          periodEndDate: periodEndDateRaw,
          publicationDate: hasPublicationDate ? publicationDateRaw : null,
          currency,
          ...(revenue !== undefined ? { revenue } : {}),
          ...(ebitda !== undefined ? { ebitda } : {}),
          ...(ebit !== undefined ? { ebit } : {}),
          ...(netIncome !== undefined ? { netIncome } : {}),
          ...(eps !== undefined ? { eps } : {}),
          ...(cash !== undefined ? { cash } : {}),
          ...(totalDebt !== undefined ? { totalDebt } : {}),
          ...(totalAssets !== undefined ? { totalAssets } : {}),
          ...(totalEquity !== undefined ? { totalEquity } : {}),
          ...(operatingCashFlow !== undefined ? { operatingCashFlow } : {}),
          ...(capex !== undefined ? { capex } : {}),
          ...(sharesOutstanding !== undefined ? { sharesOutstanding } : {}),
          ...(dividendPerShare !== undefined ? { dividendPerShare } : {}),
        };
      }
    }

    return { row, values: record, ...(candidate ? { candidate } : {}), errors, warnings };
  });

  const total = rows.length;
  const invalid = rows.filter((r) => r.errors.length > 0).length;
  const valid = total - invalid;
  const warningsCount = rows.filter((r) => r.warnings.length > 0).length;
  const willUpdate = rows.filter(
    (r) =>
      r.candidate &&
      existingKeys.has(
        `${r.candidate.securityId}:${r.candidate.periodType}:${r.candidate.periodEndDate}`,
      ),
  ).length;
  const willInsert = valid - willUpdate;

  return {
    sourceHash,
    rows,
    totals: { total, valid, invalid, warnings: warningsCount, willInsert, willUpdate },
    canConfirm: valid > 0 && invalid === 0,
  };
}
