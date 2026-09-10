import { isErrorResponse, requireDataAdmin } from '@/lib/admin-auth';

const jsonError = (message: string, status: number) =>
  Response.json({ error: message }, { status });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireDataAdmin();
  if (isErrorResponse(auth)) return auth;
  const { supabase } = auth;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError('INVALID_JSON', 400);
  }
  const input = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const status = String(input.status ?? '');
  if (!['resolved', 'ignored', 'open'].includes(status)) return jsonError('INVALID_STATUS', 400);
  const linkIssuerId = input.linkIssuerId ? String(input.linkIssuerId) : null;

  const { error } = await supabase.rpc('resolve_ambiguous_document_issuer', {
    p_id: id,
    p_status: status,
    p_link_issuer_id: linkIssuerId,
  });
  if (error) return jsonError(error.message, 422);
  return Response.json({ status });
}
