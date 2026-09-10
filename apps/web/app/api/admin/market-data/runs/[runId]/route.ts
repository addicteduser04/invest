import { isErrorResponse, requireDataAdmin } from '@/lib/admin-auth';

export const runtime = 'nodejs';

const jsonError = (message: string, status: number) =>
  Response.json({ error: message }, { status });

export async function GET(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const auth = await requireDataAdmin();
  if (isErrorResponse(auth)) return auth;
  const { supabase } = auth;

  const { runId } = await params;
  const { data, error } = await supabase.rpc('get_market_ingestion_run', { p_run_id: runId });
  if (error) return jsonError(error.message, 422);
  const run = Array.isArray(data) ? data[0] : data;
  if (!run) return jsonError('Run not found', 404);
  return Response.json({ run });
}
