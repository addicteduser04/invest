import {
  fetchBvcIndexHistoryPreview,
  fetchBvcIndexMasterPreview,
  fetchBvcLatestMarketPreview,
} from '@bvc/market-data';
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
  const mode = String(input.mode ?? 'history');
  const action = String(input.action ?? 'preview');
  if (!['preview', 'apply'].includes(action)) return jsonError('Invalid action', 400);

  try {
    if (mode === 'master') {
      const preview = await fetchBvcIndexMasterPreview();
      if (preview.errors.length)
        return Response.json({ ...preview, status: 'validation_failed' }, { status: 422 });
      if (action === 'apply') {
        const { data, error } = await supabase.rpc('upsert_market_indices', {
          p_rows: preview.candidates,
        });
        if (error) return jsonError(error.message, 422);
        return Response.json({
          ...preview,
          rowCount: preview.candidates.length,
          result: data,
          status: 'applied',
          notice:
            'BVC index master applied to this private testing environment. Nothing here implies commercial redistribution rights.',
        });
      }
      return Response.json({
        ...preview,
        rowCount: preview.candidates.length,
        status: 'preview',
        notice: 'Read-only index master preview. Nothing was persisted or published.',
      });
    }

    if (mode === 'latest') {
      if (action === 'apply') return jsonError('Latest snapshot apply is not supported', 400);
      const preview = await fetchBvcLatestMarketPreview();
      return Response.json({
        ...preview,
        rowCount: preview.snapshots.length,
        status: 'preview',
        notice:
          'Read-only latest available/delayed public-site snapshot preview. Nothing was persisted or published.',
      });
    }

    if (mode !== 'history') return jsonError('Invalid mode', 400);
    const historyInput = {
      code: String(input.code ?? 'MASI'),
      period: ['1m', '3m', '6m', '1y', '2y', '3y'].includes(String(input.period ?? '1m'))
        ? (String(input.period ?? '1m') as '1m' | '3m' | '6m' | '1y' | '2y' | '3y')
        : '1m',
      ...(input.startDate ? { startDate: String(input.startDate) } : {}),
      ...(input.endDate ? { endDate: String(input.endDate) } : {}),
    };
    const preview = await fetchBvcIndexHistoryPreview(historyInput);
    if (preview.errors.length)
      return Response.json(
        {
          ...preview,
          status: 'validation_failed',
          notice:
            'BVC index history was fetched read-only but failed normalization. Nothing was persisted.',
        },
        { status: 422 },
      );

    if (action === 'apply') {
      const { data, error } = await supabase.rpc('upsert_market_index_observations', {
        p_rows: preview.candidates,
      });
      if (error) return jsonError(error.message, 422);
      return Response.json({
        ...preview,
        rowCount: preview.candidates.length,
        filename: `bvc-public-test-index-${historyInput.code.toUpperCase()}-${historyInput.period}.csv`,
        result: data,
        status: 'applied',
        notice:
          'BVC index history applied to this private testing environment. Public/commercial use still requires appropriate data rights.',
      });
    }

    return Response.json({
      ...preview,
      rowCount: preview.candidates.length,
      filename: `bvc-public-test-index-${historyInput.code.toUpperCase()}-${historyInput.period}.csv`,
      status: 'preview',
      notice: 'Read-only index history testing preview. Nothing was persisted or published.',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'BVC_FETCH_FAILED';
    const status = message.startsWith('BVC_HTTP_') ? 502 : 400;
    return jsonError(message, status);
  }
}
