import { localizeError, type ErrorCode } from '@bvc/contracts';
import { createClient } from '@/lib/supabase/server';
import {
  IMPORT_MAPPING_VERSION,
  MAX_IMPORT_BYTES,
  previewTransactionCsv,
  transactionTypes,
  type ImportMapping,
} from '@/lib/transaction-import';

const safeCode = (message?: string): ErrorCode => {
  const codes: ErrorCode[] = [
    'UNAUTHENTICATED',
    'FORBIDDEN_PORTFOLIO',
    'DUPLICATE_IMPORT',
    'INVALID_FILE',
    'FILE_TOO_LARGE',
    'TOO_MANY_ROWS',
    'INVALID_MAPPING',
  ];
  return codes.includes(message as ErrorCode) ? (message as ErrorCode) : 'INTERNAL_FAILURE';
};
export async function POST(request: Request) {
  const form = await request.formData();
  const rawLocale = String(form.get('locale') ?? 'fr');
  const locale = rawLocale === 'en' || rawLocale === 'ar' ? rawLocale : 'fr';
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return Response.json(
      { code: 'UNAUTHENTICATED', message: localizeError({ code: 'UNAUTHENTICATED' }, locale) },
      { status: 401 },
    );
  const file = form.get('file');
  const acceptedTypes = new Set([
    'text/csv',
    'application/csv',
    'text/plain',
    'application/vnd.ms-excel',
    '',
  ]);
  if (!(file instanceof File) || file.size < 1 || file.size > MAX_IMPORT_BYTES)
    return Response.json(
      {
        code: 'INVALID_FILE',
        message: localizeError(
          {
            code:
              file instanceof File && file.size > MAX_IMPORT_BYTES
                ? 'FILE_TOO_LARGE'
                : 'INVALID_FILE',
          },
          locale,
        ),
      },
      { status: 400 },
    );
  if (!acceptedTypes.has(file.type))
    return Response.json(
      { code: 'INVALID_FILE', message: localizeError({ code: 'INVALID_FILE' }, locale) },
      { status: 400 },
    );
  const mapping = Object.fromEntries(
    [
      'date',
      'type',
      'security',
      'quantity',
      'unitPrice',
      'fees',
      'taxes',
      'currency',
      'externalReference',
      'description',
    ].map((key) => [key, String(form.get(key) ?? '')]),
  ) as ImportMapping;
  try {
    const content = await file.text();
    const { data: directory } = await supabase.from('security_directory').select('id,ticker');
    const securities = new Map(
      (directory ?? []).flatMap((item) => [
        [item.ticker.toUpperCase(), item.id],
        [item.id, item.id],
      ]),
    );
    const preview = previewTransactionCsv(content, mapping, securities);
    const { data: existing } = await supabase
      .from('transactions')
      .select('idempotency_key')
      .eq('portfolio_id', String(form.get('portfolioId')))
      .in(
        'idempotency_key',
        preview.rows.flatMap((row) => (row.transaction ? [row.transaction.externalReference] : [])),
      );
    const existingRefs = new Set((existing ?? []).map((row) => row.idempotency_key));
    for (const row of preview.rows)
      if (row.transaction && existingRefs.has(row.transaction.externalReference)) {
        row.errors.push({ code: 'EXISTING_TRANSACTION', field: 'externalReference', row: row.row });
        delete row.transaction;
      }
    preview.totals.valid = preview.rows.filter((row) => !row.errors.length).length;
    preview.totals.invalid = preview.rows.length - preview.totals.valid;
    preview.canConfirm = preview.totals.invalid === 0;
    const args = {
      p_portfolio_id: String(form.get('portfolioId')),
      p_filename: file.name,
      p_file_hash: preview.hash,
      p_file_size: file.size,
      p_content_type: file.type || 'text/csv',
      p_content: content,
      p_mapping: mapping,
      p_mapping_version: IMPORT_MAPPING_VERSION,
      p_preview_totals: preview.totals,
      p_rows: preview.rows.flatMap((row) => (row.transaction ? [row.transaction] : [])),
    };
    const supersedesImportId = String(form.get('supersedesImportId') ?? '');
    const { data: importId, error } = supersedesImportId
      ? await supabase.rpc('replace_transaction_import', {
          p_supersedes_import_id: supersedesImportId,
          ...args,
        })
      : await supabase.rpc('create_transaction_import', args);
    if (error) {
      const code = safeCode(error.message);
      const duplicate =
        code === 'DUPLICATE_IMPORT'
          ? await supabase
              .from('transaction_imports')
              .select('id,status')
              .eq('portfolio_id', String(form.get('portfolioId')))
              .eq('file_hash', preview.hash)
              .maybeSingle()
          : null;
      return Response.json(
        {
          code,
          message: localizeError({ code }, locale),
          existingImport: duplicate?.data ?? undefined,
        },
        { status: code === 'DUPLICATE_IMPORT' ? 409 : 400 },
      );
    }
    return Response.json(
      {
        importId,
        ...preview,
        filename: file.name,
        portfolioId: String(form.get('portfolioId')),
        typeSummary: Object.fromEntries(
          transactionTypes.map((type) => [
            type,
            preview.rows.filter((row) => row.transaction?.type === type).length,
          ]),
        ),
        expectedEffects: preview.rows.flatMap((row) =>
          row.transaction
            ? [
                {
                  row: row.row,
                  type: row.transaction.type,
                  cash:
                    row.transaction.type === 'deposit' || row.transaction.type === 'dividend'
                      ? `+${row.transaction.amount}`
                      : row.transaction.type === 'buy'
                        ? `-(${row.transaction.quantity} × ${row.transaction.unitPrice} + ${row.transaction.fees} + ${row.transaction.taxes})`
                        : row.transaction.type === 'sell'
                          ? `+(${row.transaction.quantity} × ${row.transaction.unitPrice} - ${row.transaction.fees} - ${row.transaction.taxes})`
                          : `-${row.transaction.amount}`,
                  holding: row.transaction.securityId
                    ? `${row.transaction.type === 'buy' ? '+' : '-'}${row.transaction.quantity} ${row.transaction.securityId}`
                    : null,
                },
              ]
            : [],
        ),
        existingTransactions: preview.rows.filter((row) =>
          row.errors.some((error) => error.code === 'EXISTING_TRANSACTION'),
        ).length,
        rows: preview.rows.map((row) => ({
          ...row,
          errors: row.errors.map((error) => ({ ...error, message: localizeError(error, locale) })),
          warnings: row.warnings.map((warning) => ({
            ...warning,
            message: localizeError(warning, locale),
          })),
        })),
      },
      { status: preview.canConfirm ? 200 : 422 },
    );
  } catch (error) {
    const code = safeCode(error instanceof Error ? error.message : undefined);
    return Response.json({ code, message: localizeError({ code }, locale) }, { status: 400 });
  }
}
