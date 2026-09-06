import { createClient } from '@/lib/supabase/server';

const jsonError = (message: string, status: number) =>
  Response.json({ error: message }, { status });

export async function POST(request: Request) {
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
  const securityId = String(input.securityId ?? '');
  const sourceIssuerId = String(input.sourceIssuerId ?? '').trim();
  const sourceIssuerName = String(input.sourceIssuerName ?? '').trim();
  if (!securityId || !sourceIssuerId || !sourceIssuerName) {
    return jsonError('MISSING_FIELDS', 400);
  }

  const { data, error } = await supabase.rpc('upsert_company_document_alias', {
    p_security_id: securityId,
    p_source_provider_id: 'ammc_public_documents',
    p_source_issuer_id: sourceIssuerId,
    p_source_issuer_name: sourceIssuerName,
  });
  if (error) return jsonError(error.message, 422);
  return Response.json({ id: data });
}
