import { resolveIngestionProvider } from '@bvc/market-ingestion';
import { isErrorResponse, requireDataAdmin } from '@/lib/admin-auth';

export const runtime = 'nodejs';

const jsonError = (message: string, status: number) =>
  Response.json({ error: message }, { status });

export async function GET() {
  const auth = await requireDataAdmin();
  if (isErrorResponse(auth)) return auth;
  const { supabase } = auth;

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
