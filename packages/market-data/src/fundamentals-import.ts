import { createHash } from 'node:crypto';
import Decimal from 'decimal.js';
import { parse } from 'csv-parse/sync';
import { normalizeAmmcIssuerName } from './ammc-reports';

// Mirrors apps/web/lib/transaction-import.ts's MAX_IMPORT_ROWS: the 5MB file-size cap alone does
// not bound row count for a file of very short rows, and per-row processing below (Decimal
// parsing, issuer/security resolution, dedupe) has real per-row cost.
export const MAX_FUNDAMENTALS_IMPORT_ROWS = 5_000;

export interface KnownSecurity {
  id: string;
  ticker: string;
  issuerId: string;
}

export interface KnownIssuer {
  id: string;
  name: string;
  ammcIssuerId: string | null;
}

export interface ExistingFundamentalsPeriod {
  issuer_id: string;
  period_type: 'annual' | 'interim';
  period_end_date: string;
}

export interface FundamentalsCandidate {
  issuerId: string;
  /** Present only when resolved via the ticker column -- informational, not used for
   * persistence (market.fundamentals is issuer-owned; see docs/COMPANY_DOCUMENTS.md). */
  ticker?: string;
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
  depreciationAmortization?: string;
  taxExpense?: string;
  workingCapital?: string;
  changeInWorkingCapital?: string;
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
 * Resolves a CSV row's issuer, in order (see docs/COMPANY_DOCUMENTS.md section "Fundamentals
 * admin import"): (1) an explicit issuer_id column -- trusted as-is if it names a known issuer;
 * (2) ticker -> known security -> its issuer_id, preserving the original ticker-only CSV
 * contract; (3) ammc_issuer_id -> a known issuer carrying that id; (4) issuer_name, matched only
 * on an EXACT normalized-name hit against exactly one known issuer -- never fuzzy. Returns null
 * (never guesses) when nothing resolves.
 */
function resolveIssuerId(
  record: Record<string, string>,
  tickerToSecurity: Map<string, KnownSecurity>,
  issuerById: Map<string, KnownIssuer>,
  issuerByAmmcId: Map<string, KnownIssuer>,
  issuersByNormalizedName: Map<string, KnownIssuer[]>,
): { issuerId: string | null; ticker: string | undefined; error: string | null } {
  const explicitIssuerId = String(record['issuer_id'] ?? '').trim();
  if (explicitIssuerId) {
    if (!issuerById.has(explicitIssuerId))
      return { issuerId: null, ticker: undefined, error: 'unknown issuer_id' };
    return { issuerId: explicitIssuerId, ticker: undefined, error: null };
  }

  const ticker = String(record['ticker'] ?? '')
    .trim()
    .toUpperCase();
  if (ticker) {
    const security = tickerToSecurity.get(ticker);
    if (!security) return { issuerId: null, ticker, error: `unknown ticker ${ticker}` };
    return { issuerId: security.issuerId, ticker, error: null };
  }

  const ammcIssuerId = String(record['ammc_issuer_id'] ?? '').trim();
  if (ammcIssuerId) {
    const issuer = issuerByAmmcId.get(ammcIssuerId);
    if (!issuer) return { issuerId: null, ticker: undefined, error: 'unknown ammc_issuer_id' };
    return { issuerId: issuer.id, ticker: undefined, error: null };
  }

  const issuerName = String(record['issuer_name'] ?? '').trim();
  if (issuerName) {
    const matches = issuersByNormalizedName.get(normalizeAmmcIssuerName(issuerName)) ?? [];
    if (matches.length === 1) return { issuerId: matches[0]!.id, ticker: undefined, error: null };
    if (matches.length > 1)
      return { issuerId: null, ticker: undefined, error: 'ambiguous issuer_name' };
    return { issuerId: null, ticker: undefined, error: 'unknown issuer_name' };
  }

  return {
    issuerId: null,
    ticker: undefined,
    error: 'missing ticker, issuer_id, ammc_issuer_id, or issuer_name',
  };
}

/**
 * Parse an admin-supplied fundamentals CSV: one row per issuer/period, blanks stay null
 * (never coerced to 0), negative financial values are accepted (loss-making periods are real),
 * and any file containing at least one invalid row cannot be confirmed as a whole -- matching
 * the codebase's existing all-or-nothing admin-CSV convention. Backward compatible with the
 * original ticker-only CSV shape; issuer_id/ammc_issuer_id/issuer_name are optional additions
 * for issuers that have no listed BVC security (see docs/COMPANY_DOCUMENTS.md).
 */
export function previewFundamentalsCsv(
  input: string,
  knownSecurities: KnownSecurity[],
  knownIssuers: KnownIssuer[],
  existingPeriods: ExistingFundamentalsPeriod[],
): FundamentalsImportPreview {
  const sourceHash = createHash('sha256').update(input).digest('hex');
  let records: Record<string, string>[];
  try {
    // relax_column_count: a CSV uploaded before newer optional columns existed has fewer
    // fields than the current header and must keep working -- missing trailing fields simply
    // read as undefined below, handled the same as any other blank optional cell.
    records = parse(input, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    }) as Record<string, string>[];
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
  if (records.length > MAX_FUNDAMENTALS_IMPORT_ROWS) {
    return {
      sourceHash,
      rows: [
        {
          row: 1,
          values: {},
          errors: [`Fundamentals CSV exceeds the ${MAX_FUNDAMENTALS_IMPORT_ROWS}-row limit`],
          warnings: [],
        },
      ],
      totals: emptyTotals,
      canConfirm: false,
    };
  }

  const tickerToSecurity = new Map(knownSecurities.map((s) => [s.ticker.toUpperCase(), s]));
  const issuerById = new Map(knownIssuers.map((i) => [i.id, i]));
  const issuerByAmmcId = new Map(
    knownIssuers.filter((i) => i.ammcIssuerId).map((i) => [i.ammcIssuerId as string, i]),
  );
  const issuersByNormalizedName = new Map<string, KnownIssuer[]>();
  for (const issuer of knownIssuers) {
    const key = normalizeAmmcIssuerName(issuer.name);
    issuersByNormalizedName.set(key, [...(issuersByNormalizedName.get(key) ?? []), issuer]);
  }

  const existingKeys = new Set(
    existingPeriods.map((p) => `${p.issuer_id}:${p.period_type}:${p.period_end_date}`),
  );
  const seenInFile = new Set<string>();

  const rows: FundamentalsPreviewRow[] = records.map((record, index) => {
    const row = index + 2;
    const errors: string[] = [];
    const warnings: string[] = [];

    const resolution = resolveIssuerId(
      record,
      tickerToSecurity,
      issuerById,
      issuerByAmmcId,
      issuersByNormalizedName,
    );
    if (resolution.error) errors.push(`Row ${row}: ${resolution.error}`);

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
    // DCF-only optional fields: same blank-stays-null, negatives-accepted convention as every
    // other income/balance/cash-flow figure above -- none of them are structurally constrained
    // to be non-negative (D&A, tax expense, working capital and its change can all be negative).
    const depreciationAmortization = signedDecimal(
      String(record['depreciation_amortization'] ?? '').trim(),
      'depreciation_amortization',
      row,
      errors,
    );
    const taxExpense = signedDecimal(
      String(record['tax_expense'] ?? '').trim(),
      'tax_expense',
      row,
      errors,
    );
    const workingCapital = signedDecimal(
      String(record['working_capital'] ?? '').trim(),
      'working_capital',
      row,
      errors,
    );
    const changeInWorkingCapital = signedDecimal(
      String(record['change_in_working_capital'] ?? '').trim(),
      'change_in_working_capital',
      row,
      errors,
    );

    let candidate: FundamentalsCandidate | undefined;
    if (resolution.issuerId && validPeriodEnd && !errors.length) {
      const dedupeKey = `${resolution.issuerId}:${periodType}:${periodEndDateRaw}`;
      if (seenInFile.has(dedupeKey)) {
        errors.push(`Row ${row}: duplicate issuer ${periodType} ${periodEndDateRaw} in this file`);
      } else {
        seenInFile.add(dedupeKey);
        if (existingKeys.has(dedupeKey))
          warnings.push(
            `Row ${row}: ${periodType} ${periodEndDateRaw} already has data and will be updated`,
          );
        candidate = {
          issuerId: resolution.issuerId,
          ...(resolution.ticker ? { ticker: resolution.ticker } : {}),
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
          ...(depreciationAmortization !== undefined ? { depreciationAmortization } : {}),
          ...(taxExpense !== undefined ? { taxExpense } : {}),
          ...(workingCapital !== undefined ? { workingCapital } : {}),
          ...(changeInWorkingCapital !== undefined ? { changeInWorkingCapital } : {}),
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
        `${r.candidate.issuerId}:${r.candidate.periodType}:${r.candidate.periodEndDate}`,
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
