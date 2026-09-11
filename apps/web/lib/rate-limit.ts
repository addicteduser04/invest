import { createHash } from 'node:crypto';
import { Pool } from 'pg';

/**
 * Server-side rate limiting backed by private.check_rate_limit (Postgres, fixed-window, atomic --
 * see supabase/migrations/202609100001_security_hardening.sql and
 * 202609110001_rate_limit_server_only.sql). Deliberately not Redis/Upstash: a single atomic
 * upsert already gives correct, race-free counting at this scale, and adding a paid vendor for it
 * would be exactly the over-engineering this milestone avoids.
 *
 * Called over a direct WORKER_DATABASE_URL connection -- the same trusted, non-PostgREST path
 * apps/web/lib/job-lock.ts already uses -- never through a caller's own (anon/authenticated)
 * Supabase client. The limiter is an internal helper every protected route calls on the server's
 * own behalf, never a primitive a browser should be able to invoke directly; `private.
 * check_rate_limit` lives in a schema PostgREST never exposes (supabase/config.toml's
 * api.schemas), so no client, however privileged, can call it via supabase.rpc() at all. State
 * lives only in private.rate_limit_counters and self-prunes on every call; the identity this
 * milestone's callers pass (a user id, or a hashed IP for anonymous routes) is hashed here before
 * it ever reaches the database.
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

// Lazily created, process-wide singleton: a fresh connection per call (this runs on every
// protected request, far more often than the rare admin jobs job-lock.ts guards) would add
// per-request connect latency and risk exhausting the database's connection limit under load --
// the opposite of what a rate limiter should do. `max: 3` matches the small pools other
// direct-connection callers in this codebase use (e.g. packages/annual-reports/src/store.ts);
// never explicitly closed, by design -- a serverless instance recycles the process, not this pool.
let pool: Pool | undefined;
function getPool(): Pool | undefined {
  const databaseUrl = process.env['WORKER_DATABASE_URL'];
  if (!databaseUrl) return undefined;
  if (!pool) pool = new Pool({ connectionString: databaseUrl, max: 3 });
  return pool;
}

export async function checkRateLimit(options: RateLimitOptions): Promise<RateLimitResult> {
  const db = getPool();
  // Fails open: if the limiter itself is unreachable (pool not configured, connection error),
  // that is not a reason to reject otherwise legitimate traffic -- the limiter is defense-in-depth,
  // not the primary authorization check (requireDataAdmin's role check, RLS ownership, etc. still
  // apply independently).
  if (!db) return { allowed: true, count: 0, limit: options.maxCount, retryAfterSeconds: 0 };
  try {
    const { rows } = await db.query<{ check_rate_limit: RateLimitResult }>(
      'select private.check_rate_limit($1,$2,$3,$4) as check_rate_limit',
      [options.scope, hashIdentity(options.identity), options.maxCount, options.windowSeconds],
    );
    const result = rows[0]?.check_rate_limit;
    if (!result) return { allowed: true, count: 0, limit: options.maxCount, retryAfterSeconds: 0 };
    return result;
  } catch {
    return { allowed: true, count: 0, limit: options.maxCount, retryAfterSeconds: 0 };
  }
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
