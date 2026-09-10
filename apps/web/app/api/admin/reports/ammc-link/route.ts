import { isErrorResponse, requireDataAdmin } from '@/lib/admin-auth';

const jsonError = (message: string, status: number) =>
  Response.json({ error: message }, { status });

export async function POST(request: Request) {
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
  const issuerId = String(input.issuerId ?? '');
  const ammcIssuerId = String(input.ammcIssuerId ?? '').trim();
  const ammcIssuerName = String(input.ammcIssuerName ?? '').trim();
  if (!issuerId || !ammcIssuerId || !ammcIssuerName) return jsonError('MISSING_FIELDS', 400);

  const { data, error } = await supabase.rpc('upsert_issuer_ammc_link', {
    p_issuer_id: issuerId,
    p_ammc_issuer_id: ammcIssuerId,
    p_ammc_issuer_name: ammcIssuerName,
  });
  if (error) return jsonError(error.message, 422);
  return Response.json({ id: data });
}
