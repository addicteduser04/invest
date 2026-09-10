import { createHash } from 'node:crypto';

/**
 * Server-side rate limiting backed by public.check_rate_limit (Postgres, fixed-window, atomic --
 * see supabase/migrations/202609100001_security_hardening.sql). Deliberately not Redis/Upstash:
 * a single atomic upsert already gives correct, race-free counting at this scale, and adding a
 * paid vendor for it would be the exact over-engineering this milestone avoids. Called through
 * the caller's own Supabase client (PostgREST), same as every other read/write in these routes --
 * no separate trusted connection needed. State lives only in private.rate_limit_counters and
 * self-prunes on every call; the identity this milestone's callers pass (a user id, or a hashed
 * IP for anonymous routes) is hashed here before it ever reaches the database.
 */

export interface RateLimitOptions {
  /** A fixed, route-specific name, e.g. 'admin.reports.sync' -- distinguishes limiter buckets
   * per action so a limit on one endpoint never bleeds into another. */
  scope: string;
  /** The caller's own identity: auth.uid() for an authenticated route, or hashIdentity(ip) for
   * an anonymous one. Hashed internally -- pass the raw value. */
  identity: string;
  maxCount: number;
  windowSeconds: number;
}

export interface RateLimitResult {
  allowed: boolean;
  count: number;
  limit: number;
  retryAfterSeconds: number;
}

/** sha256 hex digest -- deterministic (same input always hashes the same, so repeat callers
 * still hit the same counter bucket) but never reversible to the original value. Used both for
 * user ids (defense in depth) and for IP addresses (required -- see docs/SECURITY.md, never
 * store a raw IP even ephemerally). */
export function hashIdentity(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

// Deliberately not `Pick<SupabaseClient, 'rpc'>`: the real SDK type overloads rpc() to return a
// PostgrestFilterBuilder (thenable but not a literal Promise), which is not assignable to a
// `Promise<...>` return type. PromiseLike is the common structural shape both the real client and
// every test double (which just return a plain awaited object) actually satisfy.
interface MinimalSupabase {
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}

export async function checkRateLimit(
  supabase: MinimalSupabase,
  options: RateLimitOptions,
): Promise<RateLimitResult> {
  const { data, error } = await supabase.rpc('check_rate_limit', {
    p_scope: options.scope,
    p_identity_hash: hashIdentity(options.identity),
    p_max_count: options.maxCount,
    p_window_seconds: options.windowSeconds,
  });
  // Fails open: if the limiter itself is unreachable, that is not a reason to reject otherwise
  // legitimate traffic -- the limiter is a defense-in-depth control, not the primary authorization
  // check (requireDataAdmin's role check, RLS ownership, etc. still apply independently).
  if (error || !data) {
    return { allowed: true, count: 0, limit: options.maxCount, retryAfterSeconds: 0 };
  }
  return data as RateLimitResult;
}

export function rateLimitResponse(result: RateLimitResult): Response {
  return Response.json(
    { error: 'RATE_LIMITED', retryAfterSeconds: result.retryAfterSeconds },
    { status: 429, headers: { 'Retry-After': String(Math.max(1, result.retryAfterSeconds)) } },
  );
}

/**
 * Concrete thresholds, chosen per-endpoint by cost and expected legitimate usage rather than one
 * arbitrary global number (see docs/SECURITY.md "Rate limiting" for the full reasoning).
 */
export const RATE_LIMIT_TIERS = {
  /** Full AMMC sync, daily market ingestion trigger, controlled CSV/fundamentals publish: a
   * minutes-long crawl or a durable-write admin action. A legitimate admin never needs to
   * trigger the same job twice within a minute -- for the two long-running crawls this is a
   * cheap backstop behind the job lock (apps/web/lib/job-lock.ts) and the durable
   * one_running_reports_sync_uq / one_running_ingestion_run_per_date_provider_uq indexes; for
   * the single-shot publish/import routes it is the primary defense against a scripted loop. */
  veryRestricted: { maxCount: 1, windowSeconds: 60 },
  /** Portfolio/transaction mutation, DCF scenario writes, transaction-import confirmation:
   * normal interactive use (a person entering trades, adjusting DCF assumptions) is well under
   * this; a script replaying the same call in a loop is not. */
  restricted: { maxCount: 20, windowSeconds: 60 },
  /** Endpoints that do real DB computation per request (valuation/insights/performance) but are
   * read-only and individually cheap. */
  moderate: { maxCount: 60, windowSeconds: 60 },
} as const;
