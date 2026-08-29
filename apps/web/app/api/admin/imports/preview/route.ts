import { AdminCsvProvider } from '@bvc/market-data';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: role } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id)
    .eq('role', 'data_admin')
    .maybeSingle();
  if (!role) return Response.json({ error: 'Forbidden' }, { status: 403 });

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
