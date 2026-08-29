import { createHash } from 'node:crypto';
import Decimal from 'decimal.js';
import { parse } from 'csv-parse/sync';
import { z } from 'zod';

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

const isIsoCalendarDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month! - 1 && date.getUTCDate() === day
  );
};

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
    const sourceHash = createHash('sha256').update(input).digest('hex');
    let records: Record<string, string>[];
    try {
      records = parse(input, { columns: true, skip_empty_lines: true, trim: true }) as Record<
        string,
        string
      >[];
    } catch {
      return { sourceHash, candidates: [], errors: ['CSV file is malformed'], warnings: [] };
    }
    const errors: string[] = [];
    const warnings: string[] = [];
    const candidates: CandidatePrice[] = [];
    const seen = new Set<string>();
    const today = new Date().toISOString().slice(0, 10);

    records.forEach((record, index) => {
      const row = index + 2;
      const rawDate = record[mapping.date] ?? '';
      const marketDate = rawDate.slice(0, 10);
      const ticker = (record[mapping.ticker] ?? '').trim().toUpperCase();
      const validDate = isIsoCalendarDate(marketDate);
      if (!validDate) errors.push(`Row ${row}: invalid date`);
      else if (marketDate > today) errors.push(`Row ${row}: future market date`);
      if (!ticker) errors.push(`Row ${row}: missing ticker`);

      const close = decimal(record[mapping.close], 'close', row, errors);
      const open = mapping.open ? decimal(record[mapping.open], 'open', row, errors) : undefined;
      const high = mapping.high ? decimal(record[mapping.high], 'high', row, errors) : undefined;
      const low = mapping.low ? decimal(record[mapping.low], 'low', row, errors) : undefined;
      const volume = mapping.volume
        ? decimal(record[mapping.volume], 'volume', row, errors)
        : undefined;
      if (!close || new Decimal(close).lte(0)) errors.push(`Row ${row}: close must be positive`);

      if (high) {
        const highValue = new Decimal(high);
        for (const [label, value] of [
          ['open', open],
          ['close', close],
          ['low', low],
        ] as const) {
          if (value && highValue.lt(new Decimal(value)))
            errors.push(`Row ${row}: high is below ${label}`);
        }
      }
      if (low) {
        const lowValue = new Decimal(low);
        for (const [label, value] of [
          ['open', open],
          ['close', close],
          ['high', high],
        ] as const) {
          if (value && lowValue.gt(new Decimal(value)))
            errors.push(`Row ${row}: low is above ${label}`);
        }
      }

      const key = `${ticker}:${marketDate}`;
      if (seen.has(key)) errors.push(`Row ${row}: duplicate ${key}`);
      seen.add(key);
      if (ticker && close && validDate && marketDate <= today)
        candidates.push({
          row,
          ticker,
          marketDate,
          close,
          ...(open ? { open } : {}),
          ...(high ? { high } : {}),
          ...(low ? { low } : {}),
          ...(volume ? { volume } : {}),
        });
    });

    const byTicker = new Map<string, CandidatePrice[]>();
    for (const candidate of candidates) {
      const bucket = byTicker.get(candidate.ticker) ?? [];
      bucket.push(candidate);
      byTicker.set(candidate.ticker, bucket);
    }
    for (const [ticker, tickerRows] of byTicker) {
      const ordered = [...tickerRows].sort((a, b) => a.marketDate.localeCompare(b.marketDate));
      for (let index = 1; index < ordered.length; index += 1) {
        const previous = ordered[index - 1]!;
        const current = ordered[index]!;
        const previousClose = new Decimal(previous.close);
        const move = new Decimal(current.close).div(previousClose).minus(1).abs();
        if (move.gt('0.30'))
          warnings.push(
            `${ticker} ${current.marketDate}: close changed by more than 30%; verify corporate actions or source data.`,
          );
      }
    }
    if (byTicker.size > 1) {
      const counts = [...byTicker.values()].map((rows) => rows.length);
      if (Math.max(...counts) !== Math.min(...counts))
        warnings.push(
          'Ticker coverage is uneven across the uploaded period; verify missing rows intentionally.',
        );
    }
    if (!records.length) errors.push('CSV file is empty');

    return {
      sourceHash,
      candidates,
      errors,
      warnings,
    };
  }
}

export interface SecurityMasterCandidate {
  row: number;
  ticker: string;
  name: string;
  sector: string | null;
  listingStatus: 'pending' | 'active' | 'suspended' | 'delisted';
  listedOn: string | null;
  isin?: string | null;
  issuerName?: string | null;
  instrumentType?: string | null;
  marketSegment?: string | null;
  shareCount?: string | null;
  sourceId?: string | null;
}

export interface SecurityMasterPreview {
  candidates: SecurityMasterCandidate[];
  errors: string[];
  warnings: string[];
}

/** Parse administrator-supplied security reference data without inventing missing fields. */
export function previewSecurityMasterCsv(input: string): SecurityMasterPreview {
  let records: Record<string, string>[];
  try {
    records = parse(input, { columns: true, skip_empty_lines: true, trim: true }) as Record<
      string,
      string
    >[];
  } catch {
    return { candidates: [], errors: ['Security master CSV is malformed'], warnings: [] };
  }
  const errors: string[] = [];
  const warnings: string[] = [];
  const candidates: SecurityMasterCandidate[] = [];
  const seen = new Set<string>();

  records.forEach((record, index) => {
    const row = index + 2;
    const ticker = String(record['ticker'] ?? '')
      .trim()
      .toUpperCase();
    const name = String(record['name'] ?? '').trim();
    const sectorRaw = String(record['sector'] ?? '').trim();
    const statusRaw = String(record['listing_status'] ?? record['status'] ?? 'active')
      .trim()
      .toLowerCase();
    const listedOnRaw = String(record['listed_on'] ?? '').trim();

    if (!/^[A-Z0-9._-]{1,20}$/.test(ticker)) errors.push(`Row ${row}: invalid ticker`);
    if (!name || name.length > 200) errors.push(`Row ${row}: invalid name`);
    if (sectorRaw.length > 120) errors.push(`Row ${row}: sector is too long`);
    if (!['pending', 'active', 'suspended', 'delisted'].includes(statusRaw))
      errors.push(`Row ${row}: invalid listing status`);
    if (listedOnRaw && !isIsoCalendarDate(listedOnRaw))
      errors.push(`Row ${row}: invalid listed_on date`);
    if (seen.has(ticker)) errors.push(`Row ${row}: duplicate ticker ${ticker}`);
    seen.add(ticker);

    if (
      /^[A-Z0-9._-]{1,20}$/.test(ticker) &&
      name &&
      name.length <= 200 &&
      sectorRaw.length <= 120 &&
      ['pending', 'active', 'suspended', 'delisted'].includes(statusRaw) &&
      (!listedOnRaw || isIsoCalendarDate(listedOnRaw))
    ) {
      candidates.push({
        row,
        ticker,
        name,
        sector: sectorRaw || null,
        listingStatus: statusRaw as SecurityMasterCandidate['listingStatus'],
        listedOn: listedOnRaw || null,
      });
    }
  });
  if (!records.length) errors.push('Security master CSV is empty');
  if (candidates.some((candidate) => candidate.sector === null))
    warnings.push('Some securities have no sector and will appear as uncategorized.');
  return { candidates, errors, warnings };
}

export const BVC_PUBLIC_TESTING_PROVIDER_ID = 'bvc_public_testing' as const;
export const BVC_STOCK_HISTORY_ENDPOINT =
  'https://www.casablanca-bourse.com/api/boursenova/stock-historical';
export const BVC_SECURITY_MASTER_PAGE =
  'https://www.casablanca-bourse.com/en/marches-produits/actions';
export const BVC_INDICES_PAGE = 'https://www.casablanca-bourse.com/en/market-data/indices';
export const BVC_LIVE_INDICES_PAGE = 'https://www.casablanca-bourse.com/en/live-market/indices';
export const BVC_INDEX_HISTORY_ENDPOINT =
  'https://www.casablanca-bourse.com/api/boursenova/indices/historical';
export const BVC_INDEX_COMPOSITION_ENDPOINT =
  'https://www.casablanca-bourse.com/api/boursenova/indices/composition';
export const BVC_SUPPORTED_INDEX_CODES = ['MASI', 'MSI20', 'ESGI', 'MASIMS'] as const;

export type BvcSupportedIndexCode = (typeof BVC_SUPPORTED_INDEX_CODES)[number];

const bvcLocalizedTextSchema = z.object({
  fr: z.string().nullable().optional(),
  ar: z.string().nullable().optional(),
  en: z.string().nullable().optional(),
});

const bvcHistoricalRowSchema = z.object({
  seance: z.string(),
  timestamp: z.number().finite().nullable().optional(),
  symbol: z.string(),
  libelle: bvcLocalizedTextSchema.optional(),
  ouverture: z.number().finite().nullable().optional(),
  dernierCours: z.number().finite().nullable(),
  coursReference: z.number().finite().nullable().optional(),
  plusHaut: z.number().finite().nullable().optional(),
  plusBas: z.number().finite().nullable().optional(),
  titresEchanges: z.number().finite().nonnegative().nullable().optional(),
  volumeEchanges: z.number().finite().nonnegative().nullable().optional(),
  nbTransactions: z.number().int().nonnegative().nullable().optional(),
  capitalisation: z.number().finite().nonnegative().nullable().optional(),
  variation: z.number().finite().nullable().optional(),
  emetteur: z.string().nullable().optional(),
  statut: bvcLocalizedTextSchema.optional(),
  mode_cotation: bvcLocalizedTextSchema.optional(),
});

const bvcHistoricalResponseSchema = z.object({
  totalCount: z.number().int().nonnegative(),
  items: z.array(bvcHistoricalRowSchema),
});

const bvcActionSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  ticker: z.string(),
  codeISIN: z.string().nullable().optional(),
  emetteur: z.string().nullable().optional(),
  instrument: z.string().nullable().optional(),
  categorie: z.string().nullable().optional(),
  compartiment: z.string().nullable().optional(),
  nombreTitres: z.union([z.string(), z.number()]).nullable().optional(),
  secteur: z.string().nullable().optional(),
});

const bvcIndexDefinitionSchema = z.object({
  code: z.string(),
  value: z.number().finite().nullable().optional(),
  previous_close: z.number().finite().nullable().optional(),
  change_pct: z.number().finite().nullable().optional(),
  change_ytd: z.number().finite().nullable().optional(),
  high: z.number().finite().nullable().optional(),
  low: z.number().finite().nullable().optional(),
  label: bvcLocalizedTextSchema.optional(),
  type_label: bvcLocalizedTextSchema.optional(),
  display_label: z.string().nullable().optional(),
  display_type: z.string().nullable().optional(),
});

const bvcIndexValueSchema = z.object({
  code: z.string(),
  libelle: bvcLocalizedTextSchema.optional(),
  valeur: z.number().finite().nullable(),
  variation: z.number().finite().nullable().optional(),
  plusHaut: z.number().finite().nullable().optional(),
  plusBas: z.number().finite().nullable().optional(),
  variationYTD: z.number().finite().nullable().optional(),
});

const bvcIndexHistoryRowSchema = z.object({
  seance: z.string(),
  timestamp: z.number().finite().nullable().optional(),
  indices: z.record(z.string(), bvcIndexValueSchema),
  volume: z.number().finite().nonnegative().nullable().optional(),
  transactions: z.number().int().nonnegative().nullable().optional(),
});

const bvcIndexHistoryResponseSchema = z.object({
  totalCount: z.number().int().nonnegative(),
  items: z.array(bvcIndexHistoryRowSchema),
});

const bvcTickerSnapshotSchema = z.object({
  symbol: z.string(),
  price: z.number().finite().nullable().optional(),
  change_pct: z.number().finite().nullable().optional(),
  volume: z.number().finite().nonnegative().nullable().optional(),
  label: bvcLocalizedTextSchema.optional(),
  currency: z.string().nullable().optional(),
});

const bvcLiveMarketSchema = z.object({
  indices: z
    .object({
      principaux: z.array(bvcIndexDefinitionSchema).optional(),
      all: z.array(bvcIndexDefinitionSchema).optional(),
    })
    .passthrough()
    .optional(),
  ticker: z
    .object({
      items: z.array(bvcTickerSnapshotSchema).optional(),
    })
    .passthrough()
    .optional(),
  session: z
    .object({
      status: z.string().nullable().optional(),
      timestamp: z.number().finite().nullable().optional(),
      label: bvcLocalizedTextSchema.optional(),
    })
    .passthrough()
    .optional(),
});

export interface BvcHistoricalFetchInput {
  instrument: string;
  startDate: string;
  endDate: string;
  market?: 'comptant' | 'terme';
  adjusted?: boolean;
}

export interface BvcHistoricalCandidate extends CandidatePrice {
  companyName: { fr: string | null; ar: string | null; en: string | null };
  sourceTimestamp: number | null;
  tradedValue: string | null;
  transactionCount: number | null;
  marketCap: string | null;
}

export interface BvcHistoricalPreview {
  providerId: typeof BVC_PUBLIC_TESTING_PROVIDER_ID;
  sourceUrl: string;
  sourceHash: string;
  candidates: BvcHistoricalCandidate[];
  csv: string;
  errors: string[];
  warnings: string[];
}

const bvcSessionDateToIso = (value: string) => {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (!match) return null;
  const iso = `${match[3]}-${match[2]}-${match[1]}`;
  return isIsoCalendarDate(iso) ? iso : null;
};

const bvcOptionalDecimal = (value: number | null | undefined) =>
  value === null || value === undefined ? undefined : new Decimal(value).toFixed();

const bvcOptionalPositiveDecimal = (value: number | null | undefined) => {
  const parsed = bvcOptionalDecimal(value);
  return parsed && new Decimal(parsed).gt(0) ? parsed : undefined;
};

const normalizedWhitespace = (value: unknown) =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();

const bvcHeaders = (referer: string) => ({
  accept: 'application/json,text/plain,*/*',
  referer,
  'user-agent':
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
});

const assertBvcIndexCode = (code: string): BvcSupportedIndexCode => {
  const normalized = code.trim().toUpperCase();
  if (!BVC_SUPPORTED_INDEX_CODES.includes(normalized as BvcSupportedIndexCode))
    throw new Error('UNSUPPORTED_BVC_INDEX');
  return normalized as BvcSupportedIndexCode;
};

const extractDrupalSettings = (html: string) => {
  const scriptPattern =
    /<script[^>]+data-drupal-selector=["']drupal-settings-json["'][^>]*>([\s\S]*?)<\/script>/i;
  const match = scriptPattern.exec(html);
  if (!match) throw new Error('BVC_DRUPAL_SETTINGS_NOT_FOUND');
  try {
    return JSON.parse(match[1]!) as Record<string, unknown>;
  } catch {
    throw new Error('BVC_INVALID_DRUPAL_SETTINGS');
  }
};

const canonicalHash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

const csvCell = (value: string | number | null | undefined) => {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

export function bvcHistoricalPreviewToCsv(candidates: BvcHistoricalCandidate[]) {
  const header = 'time,symbol,open,high,low,close,volume';
  const lines = candidates
    .slice()
    .sort((a, b) => a.marketDate.localeCompare(b.marketDate))
    .map((candidate) =>
      [
        candidate.marketDate,
        candidate.ticker,
        candidate.open ?? '',
        candidate.high ?? '',
        candidate.low ?? '',
        candidate.close,
        candidate.volume ?? '',
      ]
        .map(csvCell)
        .join(','),
    );
  return [header, ...lines].join('\n');
}

export function previewBvcHistoricalPayload(
  payload: unknown,
  expectedInstrument?: string,
  sourceUrl = BVC_STOCK_HISTORY_ENDPOINT,
): BvcHistoricalPreview {
  const parsed = bvcHistoricalResponseSchema.safeParse(payload);
  const errors: string[] = [];
  const warnings: string[] = [
    'BVC public website data is enabled for private/staging testing only. Do not treat this connector as a redistribution licence.',
  ];
  if (!parsed.success) {
    return {
      providerId: BVC_PUBLIC_TESTING_PROVIDER_ID,
      sourceUrl,
      sourceHash: createHash('sha256').update(JSON.stringify(payload)).digest('hex'),
      candidates: [],
      csv: 'time,symbol,open,high,low,close,volume',
      errors: ['BVC historical response did not match the expected schema'],
      warnings,
    };
  }

  const expectedTicker = expectedInstrument?.trim().toUpperCase();
  const seen = new Set<string>();
  const candidates: BvcHistoricalCandidate[] = [];

  parsed.data.items.forEach((item, index) => {
    const row = index + 2;
    const ticker = item.symbol.trim().toUpperCase();
    const marketDate = bvcSessionDateToIso(item.seance);
    if (!marketDate) {
      errors.push(`Row ${row}: invalid BVC session date`);
      return;
    }
    if (!/^[A-Z0-9._-]{1,30}$/.test(ticker)) {
      errors.push(`Row ${row}: invalid BVC symbol`);
      return;
    }
    if (expectedTicker && ticker !== expectedTicker) {
      errors.push(`Row ${row}: BVC returned ${ticker} while ${expectedTicker} was requested`);
      return;
    }
    if (item.dernierCours === null || item.dernierCours <= 0) {
      warnings.push(
        `${ticker} ${marketDate}: session has no positive closing price and was skipped.`,
      );
      return;
    }

    const key = `${ticker}:${marketDate}`;
    if (seen.has(key)) {
      warnings.push(`${key}: duplicate overlapping BVC session was deduplicated.`);
      return;
    }
    seen.add(key);

    const close = new Decimal(item.dernierCours).toFixed();
    const open = bvcOptionalDecimal(item.ouverture);
    const high = bvcOptionalDecimal(item.plusHaut);
    const low = bvcOptionalDecimal(item.plusBas);
    const volume = bvcOptionalDecimal(item.titresEchanges);

    if (high) {
      const highValue = new Decimal(high);
      for (const [label, value] of [
        ['open', open],
        ['close', close],
        ['low', low],
      ] as const) {
        if (value && highValue.lt(new Decimal(value)))
          errors.push(`Row ${row}: BVC high is below ${label}`);
      }
    }
    if (low) {
      const lowValue = new Decimal(low);
      for (const [label, value] of [
        ['open', open],
        ['close', close],
        ['high', high],
      ] as const) {
        if (value && lowValue.gt(new Decimal(value)))
          errors.push(`Row ${row}: BVC low is above ${label}`);
      }
    }

    candidates.push({
      row,
      ticker,
      marketDate,
      close,
      ...(open ? { open } : {}),
      ...(high ? { high } : {}),
      ...(low ? { low } : {}),
      ...(volume ? { volume } : {}),
      companyName: {
        fr: item.libelle?.fr ?? null,
        ar: item.libelle?.ar ?? null,
        en: item.libelle?.en ?? null,
      },
      sourceTimestamp: item.timestamp ?? null,
      tradedValue: bvcOptionalDecimal(item.volumeEchanges) ?? null,
      transactionCount: item.nbTransactions ?? null,
      marketCap: bvcOptionalDecimal(item.capitalisation) ?? null,
    });
  });

  if (parsed.data.totalCount !== parsed.data.items.length)
    warnings.push(
      `BVC reported ${parsed.data.totalCount} sessions but returned ${parsed.data.items.length}; verify pagination before using the file.`,
    );

  const ordered = candidates.slice().sort((a, b) => a.marketDate.localeCompare(b.marketDate));
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1]!;
    const current = ordered[index]!;
    const move = new Decimal(current.close).div(previous.close).minus(1).abs();
    if (move.gt('0.30'))
      warnings.push(
        `${current.ticker} ${current.marketDate}: close changed by more than 30%; verify a corporate action or source anomaly.`,
      );
  }

  const canonical = JSON.stringify(parsed.data);
  const sourceHash = createHash('sha256').update(canonical).digest('hex');
  return {
    providerId: BVC_PUBLIC_TESTING_PROVIDER_ID,
    sourceUrl,
    sourceHash,
    candidates,
    csv: bvcHistoricalPreviewToCsv(candidates),
    errors,
    warnings,
  };
}

export async function fetchBvcHistoricalPreview(
  input: BvcHistoricalFetchInput,
  fetchImpl: typeof fetch = fetch,
): Promise<BvcHistoricalPreview> {
  const instrument = input.instrument.trim().toUpperCase();
  if (!/^[A-Z0-9._-]{1,30}$/.test(instrument)) throw new Error('INVALID_BVC_INSTRUMENT');
  if (!isIsoCalendarDate(input.startDate) || !isIsoCalendarDate(input.endDate))
    throw new Error('INVALID_BVC_DATE');
  if (input.startDate > input.endDate) throw new Error('INVALID_BVC_DATE_RANGE');

  const start = new Date(`${input.startDate}T00:00:00Z`).getTime();
  const end = new Date(`${input.endDate}T00:00:00Z`).getTime();
  const days = Math.round((end - start) / 86_400_000);
  if (days > 400) throw new Error('BVC_DATE_RANGE_TOO_LARGE');

  const url = new URL(BVC_STOCK_HISTORY_ENDPOINT);
  url.searchParams.set('instrument', instrument);
  url.searchParams.set('market', input.market ?? 'comptant');
  url.searchParams.set('type', 'actions');
  url.searchParams.set('startDate', input.startDate);
  url.searchParams.set('endDate', input.endDate);
  url.searchParams.set('pageNumber', '1');
  url.searchParams.set('pageSize', '1000');
  if (input.adjusted) {
    url.searchParams.set('isCoursAjuste', 'true');
    url.searchParams.set('target', 'tv');
  }

  const response = await fetchImpl(url, {
    method: 'GET',
    cache: 'no-store',
    headers: {
      accept: 'application/json',
      referer: 'https://www.casablanca-bourse.com/en/market-data/Cours',
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`BVC_HTTP_${response.status}`);

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error('BVC_INVALID_RESPONSE');
  }

  return previewBvcHistoricalPayload(payload, instrument, url.toString());
}

export interface BvcSecurityMasterPreview extends SecurityMasterPreview {
  providerId: typeof BVC_PUBLIC_TESTING_PROVIDER_ID;
  sourceUrl: string;
  sourceHash: string;
  csv: string;
}

export interface BvcIndexCandidate {
  row: number;
  code: BvcSupportedIndexCode;
  name: { fr: string | null; ar: string | null; en: string | null };
  family: { fr: string | null; ar: string | null; en: string | null };
  latestValue: string | null;
  previousClose: string | null;
  changePercent: string | null;
  changeYtd: string | null;
  high: string | null;
  low: string | null;
}

export interface BvcIndexMasterPreview {
  providerId: typeof BVC_PUBLIC_TESTING_PROVIDER_ID;
  sourceUrl: string;
  sourceHash: string;
  candidates: BvcIndexCandidate[];
  errors: string[];
  warnings: string[];
}

export interface BvcIndexHistoryFetchInput {
  code: string;
  period?: '1m' | '3m' | '6m' | '1y' | '2y' | '3y';
  startDate?: string;
  endDate?: string;
}

export interface BvcIndexObservationCandidate {
  row: number;
  code: BvcSupportedIndexCode;
  marketDate: string;
  close: string;
  high: string | null;
  low: string | null;
  changePercent: string | null;
  changeYtd: string | null;
  sourceTimestamp: number | null;
  volume: string | null;
  transactionCount: number | null;
}

export interface BvcIndexHistoryPreview {
  providerId: typeof BVC_PUBLIC_TESTING_PROVIDER_ID;
  sourceUrl: string;
  sourceHash: string;
  candidates: BvcIndexObservationCandidate[];
  csv: string;
  errors: string[];
  warnings: string[];
}

export interface BvcLatestMarketPreview {
  providerId: typeof BVC_PUBLIC_TESTING_PROVIDER_ID;
  sourceUrl: string;
  sourceHash: string;
  session: {
    status: string | null;
    timestamp: number | null;
  };
  indices: BvcIndexCandidate[];
  snapshots: Array<{
    ticker: string;
    price: string | null;
    changePercent: string | null;
    volume: string | null;
    currency: string | null;
    label: { fr: string | null; ar: string | null; en: string | null };
  }>;
  errors: string[];
  warnings: string[];
}

const bvcSecurityMasterPreviewToCsv = (candidates: SecurityMasterCandidate[]) => {
  const header =
    'ticker,name,sector,listing_status,listed_on,isin,issuer_name,instrument_type,market_segment,share_count,source_id';
  const lines = candidates.map((candidate) =>
    [
      candidate.ticker,
      candidate.name,
      candidate.sector,
      candidate.listingStatus,
      candidate.listedOn,
      candidate.isin,
      candidate.issuerName,
      candidate.instrumentType,
      candidate.marketSegment,
      candidate.shareCount,
      candidate.sourceId,
    ]
      .map(csvCell)
      .join(','),
  );
  return [header, ...lines].join('\n');
};

export function previewBvcSecurityMasterSettings(
  settings: unknown,
  sourceUrl = BVC_SECURITY_MASTER_PAGE,
): BvcSecurityMasterPreview {
  const sourceHash = canonicalHash(settings);
  const warnings = [
    'BVC public website data is enabled for private/staging testing only. Technical accessibility does not imply commercial redistribution rights.',
  ];
  const actions = (settings as { boursenova?: { actions?: unknown } } | null)?.boursenova?.actions;
  const parsed = z.array(bvcActionSchema).safeParse(actions);
  if (!parsed.success) {
    return {
      providerId: BVC_PUBLIC_TESTING_PROVIDER_ID,
      sourceUrl,
      sourceHash,
      candidates: [],
      csv: bvcSecurityMasterPreviewToCsv([]),
      errors: ['BVC security master settings did not match the expected schema'],
      warnings,
    };
  }

  const errors: string[] = [];
  const candidates: SecurityMasterCandidate[] = [];
  const seen = new Set<string>();

  parsed.data.forEach((action, index) => {
    const row = index + 2;
    const ticker = normalizedWhitespace(action.ticker).toUpperCase();
    const issuerName = normalizedWhitespace(action.emetteur);
    const instrumentName = normalizedWhitespace(action.instrument);
    const name = instrumentName || issuerName || ticker;
    const sector = normalizedWhitespace(action.secteur) || null;
    const shareCountRaw = normalizedWhitespace(action.nombreTitres).replaceAll(' ', '');
    let shareCount: string | null = null;
    try {
      shareCount = shareCountRaw ? new Decimal(shareCountRaw).toFixed() : null;
    } catch {
      errors.push(`Row ${row}: invalid BVC share count`);
    }
    const sourceId = action.id === undefined ? null : normalizedWhitespace(action.id);

    if (!/^[A-Z0-9._-]{1,20}$/.test(ticker)) errors.push(`Row ${row}: invalid BVC ticker`);
    if (!name || name.length > 200) errors.push(`Row ${row}: invalid BVC security name`);
    if (sector && sector.length > 120) errors.push(`Row ${row}: BVC sector is too long`);
    if (shareCount && new Decimal(shareCount).isNegative())
      errors.push(`Row ${row}: invalid BVC share count`);
    if (seen.has(ticker)) errors.push(`Row ${row}: duplicate BVC ticker ${ticker}`);
    seen.add(ticker);

    if (/^[A-Z0-9._-]{1,20}$/.test(ticker) && name && name.length <= 200) {
      candidates.push({
        row,
        ticker,
        name,
        sector,
        listingStatus: 'active',
        listedOn: null,
        isin: normalizedWhitespace(action.codeISIN) || null,
        issuerName: issuerName || null,
        instrumentType: normalizedWhitespace(action.categorie) || null,
        marketSegment: normalizedWhitespace(action.compartiment) || null,
        shareCount,
        sourceId,
      });
    }
  });

  if (!candidates.length) errors.push('BVC security master is empty');
  return {
    providerId: BVC_PUBLIC_TESTING_PROVIDER_ID,
    sourceUrl,
    sourceHash,
    candidates,
    csv: bvcSecurityMasterPreviewToCsv(candidates),
    errors,
    warnings,
  };
}

export function previewBvcSecurityMasterHtml(html: string, sourceUrl = BVC_SECURITY_MASTER_PAGE) {
  return previewBvcSecurityMasterSettings(extractDrupalSettings(html), sourceUrl);
}

const collectIndexDefinitions = (settings: unknown) => {
  const boursenova = (settings as { boursenova?: { indices?: unknown } } | null)?.boursenova
    ?.indices as
    | {
        main?: unknown;
        grouped_others?: unknown;
      }
    | undefined;
  const main = z.array(bvcIndexDefinitionSchema).catch([]).parse(boursenova?.main);
  const groups = z
    .record(z.string(), z.array(bvcIndexDefinitionSchema))
    .catch({})
    .parse(boursenova?.grouped_others);
  return [...main, ...Object.values(groups).flat()];
};

const toBvcIndexCandidate = (
  item: z.infer<typeof bvcIndexDefinitionSchema>,
  index: number,
): BvcIndexCandidate | null => {
  const code = item.code.trim().toUpperCase();
  if (!BVC_SUPPORTED_INDEX_CODES.includes(code as BvcSupportedIndexCode)) return null;
  return {
    row: index + 2,
    code: code as BvcSupportedIndexCode,
    name: {
      fr: item.label?.fr ? normalizedWhitespace(item.label.fr) : null,
      ar: item.label?.ar ? normalizedWhitespace(item.label.ar) : null,
      en: item.label?.en ? normalizedWhitespace(item.label.en) : null,
    },
    family: {
      fr: item.type_label?.fr ? normalizedWhitespace(item.type_label.fr) : null,
      ar: item.type_label?.ar ? normalizedWhitespace(item.type_label.ar) : null,
      en: item.type_label?.en ? normalizedWhitespace(item.type_label.en) : null,
    },
    latestValue: bvcOptionalDecimal(item.value) ?? null,
    previousClose: bvcOptionalDecimal(item.previous_close) ?? null,
    changePercent: bvcOptionalDecimal(item.change_pct) ?? null,
    changeYtd: bvcOptionalDecimal(item.change_ytd) ?? null,
    high: bvcOptionalDecimal(item.high) ?? null,
    low: bvcOptionalDecimal(item.low) ?? null,
  };
};

export function previewBvcIndexSettings(
  settings: unknown,
  sourceUrl = BVC_INDICES_PAGE,
): BvcIndexMasterPreview {
  const definitions = collectIndexDefinitions(settings);
  const candidates = definitions
    .map((item, index) => toBvcIndexCandidate(item, index))
    .filter((candidate): candidate is BvcIndexCandidate => Boolean(candidate));
  const seen = new Set<string>();
  const unique = candidates.filter((candidate) => {
    if (seen.has(candidate.code)) return false;
    seen.add(candidate.code);
    return true;
  });
  return {
    providerId: BVC_PUBLIC_TESTING_PROVIDER_ID,
    sourceUrl,
    sourceHash: canonicalHash(settings),
    candidates: unique,
    errors: unique.length ? [] : ['BVC index settings did not include supported MASI indices'],
    warnings: [
      'BVC public website data is enabled for private/staging testing only. Technical accessibility does not imply commercial redistribution rights.',
    ],
  };
}

export function previewBvcIndexHtml(html: string, sourceUrl = BVC_INDICES_PAGE) {
  return previewBvcIndexSettings(extractDrupalSettings(html), sourceUrl);
}

export function bvcIndexHistoryPreviewToCsv(candidates: BvcIndexObservationCandidate[]) {
  const header = 'time,index_code,high,low,close,change_percent,change_ytd,volume,transactions';
  const lines = candidates
    .slice()
    .sort((a, b) => a.marketDate.localeCompare(b.marketDate))
    .map((candidate) =>
      [
        candidate.marketDate,
        candidate.code,
        candidate.high,
        candidate.low,
        candidate.close,
        candidate.changePercent,
        candidate.changeYtd,
        candidate.volume,
        candidate.transactionCount,
      ]
        .map(csvCell)
        .join(','),
    );
  return [header, ...lines].join('\n');
}

export function previewBvcIndexHistoryPayload(
  payload: unknown,
  expectedCode: string,
  sourceUrl = BVC_INDEX_HISTORY_ENDPOINT,
): BvcIndexHistoryPreview {
  const code = assertBvcIndexCode(expectedCode);
  const parsed = bvcIndexHistoryResponseSchema.safeParse(payload);
  const warnings = [
    'BVC public website data is enabled for private/staging testing only. Technical accessibility does not imply commercial redistribution rights.',
  ];
  if (!parsed.success) {
    return {
      providerId: BVC_PUBLIC_TESTING_PROVIDER_ID,
      sourceUrl,
      sourceHash: canonicalHash(payload),
      candidates: [],
      csv: bvcIndexHistoryPreviewToCsv([]),
      errors: ['BVC index historical response did not match the expected schema'],
      warnings,
    };
  }

  const errors: string[] = [];
  const candidates: BvcIndexObservationCandidate[] = [];
  const seen = new Set<string>();

  parsed.data.items.forEach((row, index) => {
    const marketDate = bvcSessionDateToIso(row.seance);
    const value = row.indices[code];
    const candidateRow = index + 2;
    if (!marketDate) {
      errors.push(`Row ${candidateRow}: invalid BVC index session date`);
      return;
    }
    if (!value || value.code.trim().toUpperCase() !== code) {
      errors.push(`Row ${candidateRow}: BVC index row is missing ${code}`);
      return;
    }
    const close = bvcOptionalPositiveDecimal(value.valeur);
    if (!close) {
      warnings.push(`${code} ${marketDate}: index row has no positive value and was skipped.`);
      return;
    }
    const key = `${code}:${marketDate}`;
    if (seen.has(key)) {
      warnings.push(`${key}: duplicate overlapping BVC index session was deduplicated.`);
      return;
    }
    seen.add(key);

    candidates.push({
      row: candidateRow,
      code,
      marketDate,
      close,
      high: bvcOptionalDecimal(value.plusHaut) ?? null,
      low: bvcOptionalDecimal(value.plusBas) ?? null,
      changePercent: bvcOptionalDecimal(value.variation) ?? null,
      changeYtd: bvcOptionalDecimal(value.variationYTD) ?? null,
      sourceTimestamp: row.timestamp ?? null,
      volume: bvcOptionalDecimal(row.volume) ?? null,
      transactionCount: row.transactions ?? null,
    });
  });

  if (parsed.data.totalCount !== parsed.data.items.length)
    warnings.push(
      `BVC reported ${parsed.data.totalCount} index sessions but returned ${parsed.data.items.length}; verify pagination before using the file.`,
    );

  return {
    providerId: BVC_PUBLIC_TESTING_PROVIDER_ID,
    sourceUrl,
    sourceHash: canonicalHash(parsed.data),
    candidates,
    csv: bvcIndexHistoryPreviewToCsv(candidates),
    errors,
    warnings,
  };
}

export async function fetchBvcIndexHistoryPreview(
  input: BvcIndexHistoryFetchInput,
  fetchImpl: typeof fetch = fetch,
): Promise<BvcIndexHistoryPreview> {
  const code = assertBvcIndexCode(input.code);
  const period = input.period ?? '1m';
  if (!['1m', '3m', '6m', '1y', '2y', '3y'].includes(period))
    throw new Error('INVALID_BVC_INDEX_PERIOD');
  if ((input.startDate && !input.endDate) || (!input.startDate && input.endDate))
    throw new Error('INVALID_BVC_INDEX_DATE_RANGE');
  if (input.startDate && input.endDate) {
    if (!isIsoCalendarDate(input.startDate) || !isIsoCalendarDate(input.endDate))
      throw new Error('INVALID_BVC_INDEX_DATE');
    if (input.startDate > input.endDate) throw new Error('INVALID_BVC_INDEX_DATE_RANGE');
    const start = new Date(`${input.startDate}T00:00:00Z`).getTime();
    const end = new Date(`${input.endDate}T00:00:00Z`).getTime();
    const days = Math.round((end - start) / 86_400_000);
    if (days > 1100) throw new Error('BVC_INDEX_DATE_RANGE_TOO_LARGE');
  }

  const url = new URL(BVC_INDEX_HISTORY_ENDPOINT);
  url.searchParams.set('code', code);
  if (input.startDate && input.endDate) {
    url.searchParams.set('startDate', input.startDate);
    url.searchParams.set('endDate', input.endDate);
  }
  url.searchParams.set('period', period);

  const response = await fetchImpl(url, {
    method: 'GET',
    cache: 'no-store',
    headers: bvcHeaders(BVC_INDICES_PAGE),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`BVC_HTTP_${response.status}`);

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error('BVC_INVALID_RESPONSE');
  }

  return previewBvcIndexHistoryPayload(payload, code, url.toString());
}

export async function fetchBvcSecurityMasterPreview(
  fetchImpl: typeof fetch = fetch,
): Promise<BvcSecurityMasterPreview> {
  const response = await fetchImpl(BVC_SECURITY_MASTER_PAGE, {
    method: 'GET',
    cache: 'no-store',
    headers: bvcHeaders(BVC_SECURITY_MASTER_PAGE),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`BVC_HTTP_${response.status}`);
  return previewBvcSecurityMasterHtml(await response.text(), BVC_SECURITY_MASTER_PAGE);
}

export async function fetchBvcIndexMasterPreview(
  fetchImpl: typeof fetch = fetch,
): Promise<BvcIndexMasterPreview> {
  const response = await fetchImpl(BVC_INDICES_PAGE, {
    method: 'GET',
    cache: 'no-store',
    headers: bvcHeaders(BVC_INDICES_PAGE),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`BVC_HTTP_${response.status}`);
  return previewBvcIndexHtml(await response.text(), BVC_INDICES_PAGE);
}

export function previewBvcLatestMarketHtml(
  html: string,
  sourceUrl = BVC_LIVE_INDICES_PAGE,
): BvcLatestMarketPreview {
  const settings = extractDrupalSettings(html);
  const liveMarket = (settings as { live_market?: unknown }).live_market;
  const parsed = bvcLiveMarketSchema.safeParse(liveMarket);
  const warnings = [
    'Latest BVC website snapshots are treated as latest available/delayed public-site values for private testing only, not real-time licensed market data.',
    'Technical accessibility does not imply commercial redistribution rights.',
  ];
  if (!parsed.success) {
    return {
      providerId: BVC_PUBLIC_TESTING_PROVIDER_ID,
      sourceUrl,
      sourceHash: canonicalHash(settings),
      session: { status: null, timestamp: null },
      indices: [],
      snapshots: [],
      errors: ['BVC live market settings did not match the expected schema'],
      warnings,
    };
  }
  const indexDefinitions = [
    ...(parsed.data.indices?.principaux ?? []),
    ...(parsed.data.indices?.all ?? []),
  ];
  const seenIndices = new Set<string>();
  const indices = indexDefinitions
    .map((item, index) => toBvcIndexCandidate(item, index))
    .filter((candidate): candidate is BvcIndexCandidate => Boolean(candidate))
    .filter((candidate) => {
      if (seenIndices.has(candidate.code)) return false;
      seenIndices.add(candidate.code);
      return true;
    });
  const snapshots = (parsed.data.ticker?.items ?? [])
    .map((item) => ({
      ticker: normalizedWhitespace(item.symbol).toUpperCase(),
      price: bvcOptionalDecimal(item.price) ?? null,
      changePercent: bvcOptionalDecimal(item.change_pct) ?? null,
      volume: bvcOptionalDecimal(item.volume) ?? null,
      currency: normalizedWhitespace(item.currency) || null,
      label: {
        fr: item.label?.fr ? normalizedWhitespace(item.label.fr) : null,
        ar: item.label?.ar ? normalizedWhitespace(item.label.ar) : null,
        en: item.label?.en ? normalizedWhitespace(item.label.en) : null,
      },
    }))
    .filter((item) => /^[A-Z0-9._-]{1,20}$/.test(item.ticker));
  return {
    providerId: BVC_PUBLIC_TESTING_PROVIDER_ID,
    sourceUrl,
    sourceHash: canonicalHash(settings),
    session: {
      status: parsed.data.session?.status ?? null,
      timestamp: parsed.data.session?.timestamp ?? null,
    },
    indices,
    snapshots,
    errors: [],
    warnings,
  };
}

export async function fetchBvcLatestMarketPreview(
  fetchImpl: typeof fetch = fetch,
): Promise<BvcLatestMarketPreview> {
  const response = await fetchImpl(BVC_LIVE_INDICES_PAGE, {
    method: 'GET',
    cache: 'no-store',
    headers: bvcHeaders(BVC_LIVE_INDICES_PAGE),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`BVC_HTTP_${response.status}`);
  return previewBvcLatestMarketHtml(await response.text(), BVC_LIVE_INDICES_PAGE);
}
