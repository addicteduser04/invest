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
  const name = String(input.name ?? '').trim();
  if (!name) return jsonError('MISSING_NAME', 400);

  const { data, error } = await supabase.rpc('create_issuer_manual', {
    p_name: name,
    p_issuer_type: input.issuerType ? String(input.issuerType) : null,
    p_equity_listing_status: String(input.equityListingStatus ?? 'unknown'),
    p_country_code: input.countryCode ? String(input.countryCode) : null,
    p_country_name: input.countryName ? String(input.countryName) : null,
    p_sector: input.sector ? String(input.sector) : null,
    p_website: input.website ? String(input.website) : null,
    p_ammc_issuer_id: input.ammcIssuerId ? String(input.ammcIssuerId) : null,
    p_ammc_issuer_name: input.ammcIssuerName ? String(input.ammcIssuerName) : null,
  });
  if (error) return jsonError(error.message, 422);
  return Response.json({ id: data });
}
