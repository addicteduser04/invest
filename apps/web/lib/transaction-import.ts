import { createHash } from 'node:crypto';
import { decimalSchema, type AppError } from '@bvc/contracts';

export const MAX_IMPORT_BYTES = 5_000_000;
export const MAX_IMPORT_ROWS = 5_000;
export const IMPORT_MAPPING_VERSION = 1;
export const transactionTypes = [
  'deposit',
  'withdrawal',
  'buy',
  'sell',
  'dividend',
  'fee',
  'tax',
] as const;
export type TransactionType = (typeof transactionTypes)[number];
export type ImportField =
  | 'date'
  | 'type'
  | 'security'
  | 'quantity'
  | 'unitPrice'
  | 'fees'
  | 'taxes'
  | 'currency'
  | 'externalReference'
  | 'description';
export type ImportMapping = Record<ImportField, string>;
export interface ImportRow {
  row: number;
  date: string;
  type: TransactionType;
  securityId?: string;
  quantity?: string;
  unitPrice?: string;
  amount?: string;
  fees: string;
  taxes: string;
  currency: 'MAD';
  externalReference: string;
  description?: string;
}
export interface PreviewRow {
  row: number;
  values: Record<string, string>;
  transaction?: ImportRow;
  errors: AppError[];
  warnings: AppError[];
}
export interface ImportPreview {
  hash: string;
  headers: string[];
  rows: PreviewRow[];
  totals: { total: number; valid: number; invalid: number; warnings: number; duplicates: number };
  canConfirm: boolean;
}

function csv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (quoted && char === '"' && text[i + 1] === '"') {
      value += '"';
      i++;
    } else if (char === '"') quoted = !quoted;
    else if (!quoted && char === ',') {
      row.push(value.trim());
      value = '';
    } else if (!quoted && (char === '\n' || char === '\r')) {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(value.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      value = '';
    } else value += char;
  }
  if (quoted) throw new Error('INVALID_FILE');
  row.push(value.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

const isoDate = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (value: string) => {
  if (!isoDate.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month! - 1 && date.getUTCDate() === day
  );
};
const positiveDecimal = (value: string) =>
  decimalSchema.safeParse(value).success && /[1-9]/.test(value);
export function previewTransactionCsv(
  content: string,
  mapping: ImportMapping,
  securities: Map<string, string>,
): ImportPreview {
  if (Buffer.byteLength(content, 'utf8') > MAX_IMPORT_BYTES) throw new Error('FILE_TOO_LARGE');
  if (content.includes('\0') || content.includes('\uFFFD')) throw new Error('INVALID_FILE');
  const parsed = csv(content.replace(/^\uFEFF/, ''));
  if (parsed.length < 2) throw new Error('INVALID_FILE');
  if (parsed.length - 1 > MAX_IMPORT_ROWS) throw new Error('TOO_MANY_ROWS');
  const headers = parsed[0]!;
  for (const required of ['date', 'type', 'externalReference'] as const)
    if (!mapping[required] || !headers.includes(mapping[required]))
      throw new Error('INVALID_MAPPING');
  const seenRows = new Set<string>();
  const seenRefs = new Set<string>();
  let duplicates = 0;
  const rows = parsed.slice(1).map((cells, index): PreviewRow => {
    const values = Object.fromEntries(headers.map((header, i) => [header, cells[i] ?? '']));
    const get = (field: ImportField) => values[mapping[field]] ?? '';
    const errors: AppError[] = [];
    const warnings: AppError[] = [];
    const rawType = get('type').toLowerCase();
    if (!transactionTypes.includes(rawType as TransactionType))
      errors.push({ code: 'INVALID_TRANSACTION_TYPE', field: 'type', row: index + 2 });
    if (!validDate(get('date')))
      errors.push({ code: 'INVALID_DATE', field: 'date', row: index + 2 });
    const decimalFields = ['quantity', 'unitPrice', 'fees', 'taxes'] as const;
    for (const field of decimalFields)
      if (get(field) && !decimalSchema.safeParse(get(field)).success)
        errors.push({ code: 'INVALID_DECIMAL', field, row: index + 2 });
    const type = rawType as TransactionType;
    const security = get('security');
    const securityId = security
      ? (securities.get(security.toUpperCase()) ?? securities.get(security))
      : undefined;
    if ((type === 'buy' || type === 'sell') && !securityId)
      errors.push({ code: 'UNKNOWN_SECURITY', field: 'security', row: index + 2 });
    if ((type === 'buy' || type === 'sell') && (!get('quantity') || !get('unitPrice')))
      errors.push({ code: 'IMPORT_VALIDATION_FAILED', field: 'quantity', row: index + 2 });
    if ((type === 'buy' || type === 'sell') && get('quantity') && !positiveDecimal(get('quantity')))
      errors.push({ code: 'INVALID_DECIMAL', field: 'quantity', row: index + 2 });
    if (!['buy', 'sell'].includes(type) && (get('quantity') || security))
      errors.push({ code: 'IMPORT_VALIDATION_FAILED', field: 'security', row: index + 2 });
    if (get('currency') && get('currency') !== 'MAD')
      errors.push({ code: 'IMPORT_VALIDATION_FAILED', field: 'currency', row: index + 2 });
    const amount = !['buy', 'sell'].includes(type)
      ? get('unitPrice') || get('quantity')
      : undefined;
    if (!['buy', 'sell'].includes(type) && (!amount || !positiveDecimal(amount)))
      errors.push({ code: 'INVALID_DECIMAL', field: 'amount', row: index + 2 });
    const fingerprint = JSON.stringify(values);
    const reference = get('externalReference');
    if (seenRows.has(fingerprint)) {
      errors.push({ code: 'DUPLICATE_ROW', row: index + 2 });
      duplicates++;
    }
    seenRows.add(fingerprint);
    if (!reference || seenRefs.has(reference))
      errors.push({
        code: 'DUPLICATE_EXTERNAL_REFERENCE',
        field: 'externalReference',
        row: index + 2,
      });
    seenRefs.add(reference);
    const transaction = errors.length
      ? undefined
      : {
          row: index + 2,
          date: get('date'),
          type,
          ...(securityId ? { securityId } : {}),
          ...(type === 'buy' || type === 'sell'
            ? { quantity: get('quantity'), unitPrice: get('unitPrice') }
            : {}),
          ...(amount ? { amount } : {}),
          fees: get('fees') || '0',
          taxes: get('taxes') || '0',
          currency: 'MAD' as const,
          externalReference: reference,
          ...(get('description') ? { description: get('description') } : {}),
        };
    return { row: index + 2, values, ...(transaction ? { transaction } : {}), errors, warnings };
  });
  const totals = {
    total: rows.length,
    valid: rows.filter((r) => !r.errors.length).length,
    invalid: rows.filter((r) => r.errors.length > 0).length,
    warnings: rows.reduce((n, r) => n + r.warnings.length, 0),
    duplicates,
  };
  return {
    hash: createHash('sha256').update(content).digest('hex'),
    headers,
    rows,
    totals,
    canConfirm: totals.invalid === 0,
  };
}
