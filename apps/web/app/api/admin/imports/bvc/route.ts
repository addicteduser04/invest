import { fetchBvcHistoricalPreview, fetchBvcHistoricalRangePreview } from '@bvc/market-data';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

const jsonError = (message: string, status: number) =>
  Response.json({ error: message }, { status });

export async function POST(request: Request) {
  if (process.env.BVC_PUBLIC_TESTING_ENABLED !== 'true')
    return jsonError('BVC public testing connector is disabled', 404);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return jsonError('Unauthorized', 401);
  const { data: role } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id)
    .eq('role', 'data_admin')
    .maybeSingle();
  if (!role) return jsonError('Forbidden', 403);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid JSON body', 400);
  }
  if (!body || typeof body !== 'object') return jsonError('Invalid request body', 400);
  const input = body as Record<string, unknown>;
  const action = String(input.action ?? 'preview');
  if (!['preview', 'stage'].includes(action)) return jsonError('Invalid action', 400);

  const historyInput = {
    instrument: String(input.instrument ?? ''),
    startDate: String(input.startDate ?? ''),
    endDate: String(input.endDate ?? ''),
    market: input.market === 'terme' ? ('terme' as const) : ('comptant' as const),
    adjusted: input.adjusted === true,
  };

  try {
    const extended = input.extended === true;
    const preview = extended
      ? await fetchBvcHistoricalRangePreview(historyInput)
      : await fetchBvcHistoricalPreview(historyInput);
    if (preview.errors.length)
      return Response.json(
        {
          ...preview,
          status: 'validation_failed',
          notice: 'BVC data was fetched read-only but failed normalization. Nothing was persisted.',
        },
        { status: 422 },
      );

    const filename = `bvc-public-test-${historyInput.instrument.toUpperCase()}-${historyInput.startDate}-${historyInput.endDate}.csv`;

    if (action === 'stage') {
      const mapping = {
        date: 'time',
        ticker: 'symbol',
        close: 'close',
        open: 'open',
        high: 'high',
        low: 'low',
        volume: 'volume',
      };
      const { data: runId, error } = await supabase.rpc('propose_market_price_import', {
        p_source_hash: preview.sourceHash,
        p_original_filename: filename,
        p_mapping: mapping,
        p_validation_report: { errors: preview.errors, warnings: preview.warnings },
        p_source_text: preview.csv,
        p_candidates: preview.candidates,
      });
      if (error) {
        const status = error.message === 'DUPLICATE_IMPORT' ? 409 : 422;
        return jsonError(error.message, status);
      }
      return Response.json({
        ...preview,
        rowCount: preview.candidates.length,
        filename,
        ingestionRunId: runId,
        status: 'staged',
        notice:
          'BVC price history was staged privately. A distinct second data administrator must approve it before publication.',
      });
    }

    return Response.json({
      ...preview,
      rowCount: preview.candidates.length,
      filename,
      status: 'preview',
      notice:
        'Read-only testing preview only. Review the rows, then stage them for the existing two-admin publication workflow.',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'BVC_FETCH_FAILED';
    const status = message.startsWith('BVC_HTTP_') ? 502 : 400;
    return jsonError(message, status);
  }
}
