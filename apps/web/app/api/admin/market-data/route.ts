import { resolveIngestionProvider } from '@bvc/market-ingestion';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

const jsonError = (message: string, status: number) =>
  Response.json({ error: message }, { status });

export async function GET() {
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

  const [{ data: snapshot, error: snapshotError }, { data: runs, error: runsError }] =
    await Promise.all([
      supabase.rpc('get_market_data_operational_snapshot'),
      supabase.rpc('list_market_ingestion_runs', { p_limit: 20 }),
    ]);
  if (snapshotError) return jsonError(snapshotError.message, 422);
  if (runsError) return jsonError(runsError.message, 422);

  let provider: { id: string | null; error: string | null } = { id: null, error: null };
  try {
    provider = { id: resolveIngestionProvider(process.env).providerId, error: null };
  } catch (error) {
    provider = { id: null, error: error instanceof Error ? error.message : 'PROVIDER_UNAVAILABLE' };
  }

  return Response.json({ snapshot, runs: runs ?? [], provider });
}
