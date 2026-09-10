import { createClient } from '@/lib/supabase/server';
import { checkRateLimit, RATE_LIMIT_TIERS, rateLimitResponse } from '@/lib/rate-limit';

// DCF assumptions are a handful of flat numeric fields (docs/DCF.md) -- this is a generous
// ceiling against an oversized/abusive payload, not a tight fit to the real shape.
const MAX_ASSUMPTIONS_JSON_BYTES = 8_192;

interface ScenarioRow {
  id: string;
  name: string;
  security_id: string;
  assumptions: unknown;
  updated_at: string;
}

/**
 * Minimal DCF scenario persistence: authenticated users can list and save their own scenarios
 * for a given security. Ownership is enforced by public.dcf_scenarios' RLS policy
 * (user_id = auth.uid()), not by application logic here -- this route never needs to check
 * "does this row belong to the caller" itself.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const securityId = url.searchParams.get('securityId');
  if (!securityId) return Response.json({ error: 'MISSING_SECURITY_ID' }, { status: 400 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'UNAUTHENTICATED' }, { status: 401 });

  const { data, error } = await supabase
    .from('dcf_scenarios')
    .select('id,name,security_id,assumptions,updated_at')
    .eq('security_id', securityId)
    .order('updated_at', { ascending: false });
  if (error) return Response.json({ error: 'INTERNAL_FAILURE' }, { status: 500 });

  return Response.json({ scenarios: (data ?? []) as ScenarioRow[] });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'UNAUTHENTICATED' }, { status: 401 });

  const rateLimit = await checkRateLimit(supabase, {
    scope: 'dcf.scenarios.save',
    identity: user.id,
    ...RATE_LIMIT_TIERS.restricted,
  });
  if (!rateLimit.allowed) return rateLimitResponse(rateLimit);

  const body = (await request.json().catch(() => null)) as {
    securityId?: string;
    name?: string;
    assumptions?: unknown;
  } | null;
  const securityId = body?.securityId;
  const name = body?.name?.trim();
  const assumptions = body?.assumptions;
  if (!securityId || !name || name.length > 100 || assumptions === undefined) {
    return Response.json({ error: 'INVALID_SCENARIO' }, { status: 400 });
  }
  if (Buffer.byteLength(JSON.stringify(assumptions), 'utf8') > MAX_ASSUMPTIONS_JSON_BYTES) {
    return Response.json({ error: 'ASSUMPTIONS_TOO_LARGE' }, { status: 413 });
  }

  const { data, error } = await supabase
    .from('dcf_scenarios')
    .upsert(
      { user_id: user.id, security_id: securityId, name, assumptions },
      { onConflict: 'user_id,security_id,name' },
    )
    .select('id,name,security_id,assumptions,updated_at')
    .single();
  if (error) return Response.json({ error: 'INTERNAL_FAILURE' }, { status: 500 });

  return Response.json({ scenario: data as ScenarioRow });
}
