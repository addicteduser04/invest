import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';

export type AdminContext = { supabase: SupabaseClient; userId: string };

const jsonError = (message: string, status: number) =>
  Response.json({ error: message }, { status });

/**
 * Verifies the caller is signed in and holds the data_admin role, re-checking both server-side
 * on every call -- never trusts a client-sent flag or relies solely on RLS. Optionally also
 * enforces a rate limit scoped to this admin's user id (see apps/web/lib/rate-limit.ts).
 *
 * Returns either the authorized context or a ready-to-return Response (401/403/429) that the
 * caller should return as-is.
 */
export async function requireDataAdmin(rateLimit?: {
  scope: string;
  maxCount: number;
  windowSeconds: number;
}): Promise<AdminContext | Response> {
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

  if (rateLimit) {
    const result = await checkRateLimit(supabase, {
      scope: rateLimit.scope,
      identity: user.id,
      maxCount: rateLimit.maxCount,
      windowSeconds: rateLimit.windowSeconds,
    });
    if (!result.allowed) return rateLimitResponse(result);
  }

  return { supabase, userId: user.id };
}

export function isErrorResponse(value: AdminContext | Response): value is Response {
  return value instanceof Response;
}
