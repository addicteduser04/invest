import { fetchBvcHistoricalPreview } from '@bvc/market-data';
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

  try {
    const preview = await fetchBvcHistoricalPreview({
      instrument: String(input.instrument ?? ''),
      startDate: String(input.startDate ?? ''),
      endDate: String(input.endDate ?? ''),
      market: input.market === 'terme' ? 'terme' : 'comptant',
      adjusted: input.adjusted === true,
    });
    if (preview.errors.length)
      return Response.json(
        {
          ...preview,
          notice: 'BVC data was fetched read-only but failed normalization. Nothing was persisted.',
        },
        { status: 422 },
      );

    return Response.json({
      ...preview,
      rowCount: preview.candidates.length,
      filename: `bvc-public-test-${String(input.instrument ?? '').toUpperCase()}-${String(input.startDate ?? '')}-${String(input.endDate ?? '')}.csv`,
      notice:
        'Read-only testing export only. Nothing was persisted or published. Review the CSV, then use the existing two-admin import workflow in private staging if appropriate.',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'BVC_FETCH_FAILED';
    const status = message.startsWith('BVC_HTTP_') ? 502 : 400;
    return jsonError(message, status);
  }
}
