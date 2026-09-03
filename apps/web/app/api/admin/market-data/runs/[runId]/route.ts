import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

const jsonError = (message: string, status: number) =>
  Response.json({ error: message }, { status });

export async function GET(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
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

  const { runId } = await params;
  const { data, error } = await supabase.rpc('get_market_ingestion_run', { p_run_id: runId });
  if (error) return jsonError(error.message, 422);
  const run = Array.isArray(data) ? data[0] : data;
  if (!run) return jsonError('Run not found', 404);
  return Response.json({ run });
}
