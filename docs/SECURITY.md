# Security

Security/cost/abuse hardening milestone. Covers what was audited, what was fixed, and what
residual risk was accepted rather than engineered away.

## Database access model

Unchanged by this milestone, restated because it is the basis for everything below: `market.*`
tables have RLS enabled with **zero policies** and **zero direct grants** to `anon`/`authenticated`
(revoked at the schema level). This is a deliberate total lockout, not an oversight — every read
goes through a curated public view (`security_fundamentals`, `issuer_directory`,
`market_price_history`, ...), every write through a `SECURITY DEFINER` RPC that independently
re-checks `private.has_role('data_admin')`. `public.portfolios`/`transactions`/`dcf_scenarios`/etc.
carry real RLS policies scoped to `owner_id=auth.uid()` / `user_id=auth.uid()` instead, since those
are per-row-owned, not globally-public data.

## Supabase Security Advisor

Ran `supabase db advisors --type security` against **both** local dev and the live staging
project — the two disagreed on one important finding (see below), so both were checked, not just
local. Findings and disposition:

| Finding                                                                                                          | Count | Disposition                                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `function_search_path_mutable` (`private.prevent_mutation`, `private.normalize_company_name`, `private.slugify`) | 3     | **Fixed** — `set search_path=''` added in `202609100001_security_hardening.sql`, matching every other function in the codebase. None were `SECURITY DEFINER`, so this was not a privilege-escalation path, just inconsistency.   |
| `extension_in_public` (`unaccent`)                                                                               | 1     | **Fixed** — moved to the `extensions` schema (where every other extension in this project already lives) in the same migration.                                                                                                  |
| `rls_enabled_no_policy` (8 `market.*` tables)                                                                    | 8     | **Reviewed, intentional** — this is the total-lockout-by-design pattern above. A table with RLS on and no policy denies all access by default; that is the point.                                                                |
| `security_definer_view` (11 `public.*` views)                                                                    | 11    | **Reviewed, intentional for 10; verified live for the 11th.** See below.                                                                                                                                                         |
| `anon_security_definer_function_executable` (**staging only** — not reproducible on local)                       | 16    | **Fixed** — see "Anon-executable admin RPCs (staging-only finding)" below.                                                                                                                                                       |
| `auth_leaked_password_protection` (staging project setting)                                                      | 1     | **Operator action, not a migration** — a Supabase Auth project setting (HaveIBeenPwned check on signup/password-change), not something a SQL migration configures. Enable in the dashboard when convenient; not a schema defect. |

### Anon-executable admin RPCs (staging-only finding)

The Security Advisor against **local** dev showed none of this; the same run against **live
staging** showed 17 `data_admin`-gated RPCs executable by the `anon` role via PostgREST
(`has_function_privilege('anon', '<fn>', 'execute')` confirmed `true` directly). Local Postgres
already defaults new functions to non-public-executable; staging evidently did not carry that
same default — root cause not fully traced (nothing in this repo's migration history explicitly
re-grants `PUBLIC` execute), but the live grant state was unambiguous and is what actually
matters. Two of the 17 are intentionally public and untouched: `get_market_data_health_summary()`
(mirrors the unauthenticated `/api/health` pattern by design, `202609010001`) and
`public.rls_auto_enable()` (a Supabase-platform-owned function, not defined in any migration in
this repo).

The remaining 15 were fixed in `202609100002_revoke_anon_admin_rpc_execute.sql` (explicit
`revoke execute ... from public,anon` + `grant ... to authenticated` for each, plus
`alter default privileges revoke execute on functions from public` for future migrations).
Verifying that fix immediately re-ran the advisor and found a 16th —
`get_market_data_operational_snapshot()` — still `anon`-executable on staging _despite_ already
having an explicit `revoke ... from public` in its own defining migration (`202609010001`); fixed
directly (re-asserting the grant, not chasing why the original revoke stopped holding) in
`202609100003_revoke_anon_operational_snapshot.sql`. Every one of these 16 functions already
independently checks `auth.uid()`/`private.has_role('data_admin')` in its own body — this was
never a live authorization bypass, an anonymous caller always got `FORBIDDEN` or `null`, never a
successful admin action — but it was needless pre-auth attack surface, now closed at the grant
layer and covered by a live regression test (`supabase/tests/live-database.test.ts`: _"never
grants anon EXECUTE on data_admin-gated RPCs"_). Verified on staging via
`has_function_privilege` and a full advisor re-run after each fix; row counts for
securities/issuers/fundamentals/documents/portfolios were checked unchanged before and after —
these three migrations are grant-only, no table or data touched.

### The 11 `security_definer_view` findings

`security_fundamentals`, `issuer_directory`, `market_price_history`, `market_index_history`,
`market_index_overview`, `market_security_overview`, `security_directory`,
`issuer_company_documents`, `issuer_fundamentals`, `security_company_documents`: all public market
data, all definer-by-design so the view can see through the `market.*` lockout above. Each exposes
an explicit, reviewed column list (never `select *`), so there is no admin/audit-field leak.
Flipping any of these to `security_invoker=true` would not tighten anything — it would return zero
rows to every `anon`/`authenticated` caller (they have no grant on the underlying table) and break
the product's public read surface. Not changed.

`portfolio_replay_transactions`: the one definer view over **private** data in that list. Its own
`where exists(select 1 from public.portfolios p where p.id=t.portfolio_id and
p.owner_id=auth.uid())` clause (added in `202608270001`) is the compensating authorization, since
definer semantics mean the underlying table's RLS does not independently apply to a view. This is
now covered by a live regression test
(`supabase/tests/live-database.test.ts`: _"portfolio_replay_transactions never exposes another
user's transactions, even to a definer view"_) that creates transactions for two real users and
asserts each only ever sees their own. Not changed, verified instead.

## Authorization

- **Admin routes**: consolidated onto `apps/web/lib/admin-auth.ts`'s `requireDataAdmin()` — checks
  `auth.getUser()` then an independent `user_roles` lookup for `data_admin`, every call, never
  trusting a client-sent flag or relying on RLS alone. All 16 admin API routes use it.
- **Role escalation**: `private.create_profile()` (the `auth.users` insert trigger) hardcodes the
  new row's role to `'investor'`, ignoring `raw_user_meta_data`/`raw_app_meta_data` entirely; the
  grant on `public.user_roles` to `authenticated` is `select`-only (`202608280006`), so there is no
  INSERT/UPDATE path for a client to grant itself (or anyone) `data_admin` even if RLS were
  misconfigured — this is enforced at the grant layer, a level below RLS. Both facts are now
  covered by live tests: a signup with `{role:'data_admin'}` in its metadata still gets `investor`,
  and a direct `insert`/`update` on `user_roles` by an authenticated investor is rejected with
  `permission denied`.
- **Cross-user isolation**: extensive existing coverage in `supabase/tests/live-database.test.ts`
  (portfolios, transactions, transaction imports, reversals, DCF scenarios) plus the new
  `portfolio_replay_transactions` test above.
- **Internal job signing** (`INTERNAL_JOB_SIGNING_SECRET`): audited and found **not currently
  wired to any HTTP endpoint** — it is declared as a required env var in
  `apps/worker/src/index.ts`'s schema but never read for signature verification anywhere in the
  codebase. The worker it gates is a DB-polling background process
  (`private.claim_portfolio_recalculation`), not an HTTP-triggered job, so there is no signed
  request path to protect yet. Left as-is (removing an unused required env var is not a security
  fix and risks breaking worker startup elsewhere); noted as a gap below, not fixed, since adding a
  new HTTP trigger endpoint is a feature this milestone does not build.

## Rate limiting

Postgres-backed, not Redis/Upstash — a single atomic upsert (`private.check_rate_limit`,
`202609100001_security_hardening.sql`, moved out of `public` and made server-only by
`202609110001_rate_limit_server_only.sql`) gives correct, race-free fixed-window counting at this
scale; a paid vendor for it would be exactly the over-engineering this milestone avoids. State
lives in `private.rate_limit_counters` (`scope`, `identity_hash`, `window_start`,
`request_count`), self-prunes on every call (no cron dependency), and never stores a raw IP —
`hashIdentity()` (`apps/web/lib/rate-limit.ts`) sha256-hashes the caller's identity (a user id, or
a hashed IP for the rare anonymous case) before it reaches the database.

**Server-only by construction, not just by grant.** The limiter is an internal helper every
protected route calls on its own behalf, never a primitive a browser should invoke directly.
Originally it was `public.check_rate_limit`, reachable by any `authenticated` PostgREST caller
with a self-chosen `p_identity_hash` — beyond the "grief another user's quota" risk that was
already documented here, a direct caller could spray arbitrary `scope`/`identity_hash` pairs and
manufacture rows in `private.rate_limit_counters` on demand, an unbounded client-driven write
surface gated by nothing but a role grant. Fixed structurally in
`202609110001_rate_limit_server_only.sql`: the function now lives in `private`, a schema
`supabase/config.toml`'s `api.schemas` never exposes to PostgREST (only
`public`/`storage`/`graphql_public` are), so `supabase.rpc('check_rate_limit', ...)` 404s for
every client regardless of grants — an explicit `revoke ... from public,anon,authenticated` is
kept anyway as defense-in-depth, matching this codebase's belt-and-suspenders convention.
`apps/web/lib/rate-limit.ts` now calls it over a direct `WORKER_DATABASE_URL` connection (the same
trusted, non-PostgREST path `apps/web/lib/job-lock.ts` already used for the advisory lock), and
every caller still passes its own server-derived identity (`auth.uid()` from that route's own
`supabase.auth.getUser()` call) — never a client-supplied value — closing the identity-spoofing
risk this section used to document as accepted, not just moving it out of reach of an anonymous
client.

Tiers (`RATE_LIMIT_TIERS` in `apps/web/lib/rate-limit.ts`):

| Tier             | Limit  | Applied to                                                                                       |
| ---------------- | ------ | ------------------------------------------------------------------------------------------------ |
| `veryRestricted` | 1/60s  | Full AMMC sync, daily market ingestion, CSV/BVC/fundamentals/securities import **confirm** steps |
| `restricted`     | 20/60s | DCF scenario writes, transaction-import confirmation, transaction recording, portfolio creation  |
| `moderate`       | 60/60s | _(reserved; no current endpoint needed it — see Remaining gaps)_                                 |

`checkRateLimit` **fails open**: if the RPC call itself errors (network blip, etc.), the request is
allowed rather than rejected — the limiter is defense-in-depth alongside `requireDataAdmin`'s role
check and RLS ownership, never the sole authorization gate, so an unavailable limiter should not
turn into an outage.

**Formerly accepted residual risk, now closed**: earlier in this milestone, `p_identity_hash` was
caller-supplied to a PostgREST-reachable function, so an authenticated user who knew another
user's id could in principle grief that user's quota. Once the limiter became server-only (see
above), that path no longer exists — no client, of any privilege level, can call the limiter with
an arbitrary identity at all.

## Expensive-job concurrency

Two whole-system jobs that must never run twice concurrently:

- **Full AMMC sync** (`/api/admin/reports/sync`): `syncAnnualReports()` only creates its
  `market.document_sync_runs` row near the end of a run, so the pre-existing
  `one_running_reports_sync_uq` partial unique index alone would not stop a second trigger from
  starting a whole separate multi-minute crawl before either reached that point. Fixed with a
  session-scoped Postgres advisory lock at the route level (`apps/web/lib/job-lock.ts`,
  `pg_try_advisory_lock`/`pg_advisory_unlock` on a dedicated connection) that rejects a duplicate
  trigger **before any crawling starts**, returning `409`. The unique index remains as a durable
  backstop for any other caller of `syncAnnualReports`. `packages/annual-reports/src/sync.ts`
  itself was not touched — the issuer/annual-reports milestone is frozen; this is a route-level
  guard, not a change to that package.
- **Daily market ingestion** (`/api/admin/market-data/run`): already protected —
  `one_running_ingestion_run_per_date_provider_uq` (pre-existing) is effective here because
  `runDailyIngestion` creates its run row and calls back (`onRunCreated`) before the ingestion work
  itself runs. The route now also translates a `23505` (unique violation) into a clean `409
ALREADY_RUNNING` response instead of a raw Postgres error leaking as a `502`.

## Input limits

- CSV/file imports: byte-size caps already existed (imports/preview 5MB, securities import 1MB,
  fundamentals import 5MB, transaction imports `MAX_IMPORT_BYTES`). Row-count caps added where
  missing this milestone: `MAX_FUNDAMENTALS_IMPORT_ROWS = 5,000` and `MAX_PRICE_IMPORT_ROWS =
5,000` (`packages/market-data`), mirroring the existing `MAX_IMPORT_ROWS = 5,000` in
  `apps/web/lib/transaction-import.ts`. Every bulk-import RPC already independently bounds
  `jsonb_array_length(p_rows)` (100–5,000 depending on the table) at the database layer too.
- DCF scenario `assumptions` JSON: `MAX_ASSUMPTIONS_JSON_BYTES = 8,192` — the real shape is a
  handful of flat numeric fields (see `docs/DCF.md`), so this is a generous ceiling against an
  oversized payload, not a tight fit. Rejects with `413`.
- `/compare`: already bounded by `MAX_COMPARE_SECURITIES` applied before any DB round-trip.
- `/companies`, `/stocks` search/filter: no server-side query at all — both fetch the full (small,
  fixed-size: 81–187 rows) directory once and filter client-side in the browser, so there is no
  dynamic SQL, no injection surface, and no unbounded-search-string concern to bound.

## Web security headers

`apps/web/next.config.ts` sets a CSP plus the standard hardening headers
(`X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
`X-Frame-Options: DENY`, `Permissions-Policy`, HSTS) on every route. `connect-src 'self'` is safe
because this app has **no client-side Supabase calls at all** — every Supabase interaction
(auth, reads, writes) happens server-side in Server Components/Actions/Route Handlers; the browser
only ever talks to the Next.js server itself. `script-src` allows `https://unpkg.com` for the
TradingView Lightweight Charts bundle, pinned with a verified SRI hash
(`sha384-q1KYLSKHgBnW5tWYGGR8+6YV4/iPy31dILoF2I1OD7XiVUvHEp/TaxIQVmB0j3R2`, recomputed and
confirmed against the live file during this milestone) and `crossorigin="anonymous"`; no
`unsafe-eval` anywhere. `script-src`/`style-src` need `'unsafe-inline'` because Next.js emits its
own hydration bootstrap inline — removing it would need a nonce threaded through every page, a
larger refactor this milestone does not do.

## External links / secret scan

- Every `target="_blank"` link (AMMC PDF downloads, TradingView attribution) already carries
  `rel="noopener noreferrer"` (or the equivalent `rel="noreferrer"`, which implies `noopener` in
  every modern browser). No open-redirect or arbitrary-URL-proxy behavior exists.
- Repo scan for committed secrets: `.env`/`.env.*` are gitignored (`.env.example` is the only
  tracked `.env*` file, and it contains no real values); `git diff origin/main..HEAD` for this
  branch's whole commit range was checked for `SUPABASE_SERVICE_ROLE_KEY`, `INTERNAL_JOB_SIGNING_
SECRET`, `sb_secret_`, and JWT-shaped strings — clean. No `NEXT_PUBLIC_*` variable carries a
  server-only credential (`NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are the
  only ones, both meant to be public).

## Test coverage added this milestone

- `apps/web/lib/admin-auth.test.ts`, `apps/web/lib/rate-limit.test.ts`,
  `apps/web/lib/job-lock.test.ts` — unit tests for the new auth/rate-limit/lock helpers, including
  a test that the raw identity is never sent over the limiter's DB connection, only its hash.
- `apps/web/app/api/dcf/scenarios/route.test.ts` — oversized-payload (413) and rate-limited (429)
  cases.
- `supabase/tests/live-database.test.ts` — `portfolio_replay_transactions` cross-user isolation,
  role-escalation-via-signup-metadata, direct `user_roles` write rejection, no anon EXECUTE on a
  sample of `data_admin`-gated RPCs (the staging-only finding above).

## Remaining gaps (genuine, unresolved)

- **`INTERNAL_JOB_SIGNING_SECRET` is unused** — no HTTP endpoint currently needs it; if a future
  milestone adds an HTTP-triggered internal job, it must implement signature verification then
  (constant-time comparison, e.g. `crypto.timingSafeEqual`), not assume this env var already
  protects anything.
- **`moderate` rate-limit tier is unused** — no current endpoint does per-request DB computation
  cheap enough to warrant it over `restricted`; reserved for a future read-heavy computed endpoint
  (e.g. if `/api/portfolios/*/valuation` ever needs it).
- **No query/index changes were made** — see `docs/OPERATIONS.md` "Query and index notes"; nothing
  found warranted one at current data volumes.
