import { AdminCsvProvider } from '@bvc/market-data';
import { isErrorResponse, requireDataAdmin } from '@/lib/admin-auth';
import { RATE_LIMIT_TIERS } from '@/lib/rate-limit';

export async function POST(request: Request) {
  const auth = await requireDataAdmin({
    scope: 'admin.imports.preview',
    ...RATE_LIMIT_TIERS.veryRestricted,
  });
  if (isErrorResponse(auth)) return auth;
  const { supabase } = auth;

  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File) || file.size > 5_000_000)
    return Response.json({ error: 'A CSV file under 5 MB is required' }, { status: 400 });

  const text = await file.text();
  const mapping = {
    date: String(form.get('date') || 'time'),
    ticker: String(form.get('ticker') || 'symbol'),
    close: String(form.get('close') || 'close'),
    open: 'open',
    high: 'high',
    low: 'low',
    volume: 'volume',
  };
  const preview = await new AdminCsvProvider().preview(text, mapping);
  if (preview.errors.length) {
    return Response.json(
      {
        ...preview,
        originalFileName: file.name,
        publicationStatus: 'validation_failed',
        notice: 'Validation failed. Nothing was persisted or published.',
      },
      { status: 422 },
    );
  }

  const { data: runId, error } = await supabase.rpc('propose_market_price_import', {
    p_source_hash: preview.sourceHash,
    p_original_filename: file.name,
    p_mapping: mapping,
    p_validation_report: { errors: preview.errors, warnings: preview.warnings },
    p_source_text: text,
    p_candidates: preview.candidates,
  });
  if (error) {
    const status = error.message === 'DUPLICATE_IMPORT' ? 409 : 400;
    return Response.json({ error: error.message }, { status });
  }
  return Response.json({
    ...preview,
    ingestionRunId: runId,
    originalFileName: file.name,
    publicationStatus: 'awaiting_second_admin',
    notice: 'Persisted privately. A distinct data administrator must approve before publication.',
  });
}
