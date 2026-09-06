import { createClient } from '@/lib/supabase/server';

const jsonError = (message: string, status: number) =>
  Response.json({ error: message }, { status });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return jsonError('UNAUTHENTICATED', 401);
  const { data: role } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id)
    .eq('role', 'data_admin')
    .maybeSingle();
  if (!role) return jsonError('FORBIDDEN', 403);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError('INVALID_JSON', 400);
  }
  const input = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const status = String(input.status ?? '');
  if (!['resolved', 'ignored', 'open'].includes(status)) return jsonError('INVALID_STATUS', 400);

  const { error } = await supabase.rpc('resolve_unmatched_document_issuer', {
    p_id: id,
    p_status: status,
  });
  if (error) return jsonError(error.message, 422);
  return Response.json({ status });
}
