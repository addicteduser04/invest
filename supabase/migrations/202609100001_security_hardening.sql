begin;

-- Security/cost/abuse hardening milestone. Purely additive: no existing table dropped, no
-- existing column removed, no existing RLS/grant relaxed. Fixes three genuine Supabase Security
-- Advisor findings (function search_path, extension schema) and adds the infrastructure this
-- milestone's rate-limiting and expensive-job-concurrency requirements need. The dozen
-- "Security Definer View" advisor findings for public.security_fundamentals,
-- public.issuer_directory, public.market_price_history, etc. and the "RLS Enabled No Policy"
-- findings for market.* tables were reviewed and are intentional, not fixed here: every
-- market.* table has RLS enabled with zero policies and zero direct grants to anon/authenticated
-- by design (see docs/COMPANY_DOCUMENTS.md, docs/FUNDAMENTALS.md) -- the views are the *only*
-- sanctioned read path and must run as definer to see through that deliberate lockout, each
-- exposing an explicit, reviewed column list (never `select *`). Flipping them to
-- security_invoker=true would not tighten anything; it would return zero rows to every
-- anon/authenticated caller and break the public product surface. public.portfolio_replay_
-- transactions is the one definer view over private data in that list; its own `where
-- exists(... p.owner_id=auth.uid())` clause (added in 202608270001) is the compensating
-- authorization, since definer semantics mean the underlying RLS does not independently apply --
-- verified live and covered by a new regression test in this milestone.

-- === Advisor fix 2 first: extension in public schema ==========================================
-- unaccent was installed into public (WARN: extension_in_public) by 202609070001; every other
-- extension in this project already lives in the dedicated `extensions` schema. Moved here
-- rather than in that already-applied migration; the two functions below (fix 1) are updated in
-- this same transaction to reference extensions.unaccent instead of public.unaccent, so there is
-- no window where they resolve to nothing -- must run before those function bodies are compiled.
alter extension unaccent set schema extensions;

-- === Advisor fix 1: function search_path =====================================================
-- Three functions had no explicit search_path (WARN: function_search_path_mutable). None of the
-- three are SECURITY DEFINER, so this was not a privilege-escalation path, but every other
-- function in this codebase already sets search_path='' and these three should not be the odd
-- ones out. private.prevent_mutation's body resolves no schema-dependent object at all (it only
-- raises); the other two already schema-qualify unaccent explicitly.

create or replace function private.prevent_mutation() returns trigger
language plpgsql set search_path='' as $$ begin raise exception 'append-only relation'; end $$;

create or replace function private.normalize_company_name(p_name text) returns text
language sql immutable set search_path='' as $$
  select trim(regexp_replace(
    regexp_replace(
      upper(extensions.unaccent(coalesce(p_name,''))),
      '\y(SA|S\.A\.?|SARL|GROUPE|GROUP|\(EX[^)]*\)|EX)\y', ' ', 'g'
    ),
    '[^A-Z0-9]+', ' ', 'g'
  ))
$$;

create or replace function private.slugify(p_name text) returns text
language sql immutable set search_path='' as $$
  select trim(both '-' from regexp_replace(lower(extensions.unaccent(coalesce(p_name,''))), '[^a-z0-9]+', '-', 'g'))
$$;

-- === Expensive-job concurrency: durable backstop ==============================================
-- Mirrors the existing one_running_ingestion_run_per_date_provider_uq pattern (202609010001) for
-- the annual-reports sync: a partial unique index makes "two concurrent full syncs" a constraint
-- violation at the database level, not just an application-level check that a second caller could
-- race past. The route-level advisory lock (apps/web/lib/job-lock.ts) is the primary guard,
-- rejecting a duplicate trigger before any AMMC crawling starts; this index is the durable
-- backstop for any other caller of syncAnnualReports.
create unique index one_running_reports_sync_uq
  on market.document_sync_runs(source_provider_id)
  where status='running';

-- === Rate limiting: Postgres-backed, atomic, self-cleaning =====================================
--
-- Fixed-window counter, not a new service: a Redis/Upstash-style dependency would be a paid
-- vendor added for a problem a single atomic upsert already solves at this scale. Called through
-- each caller's own Supabase client (apps/web/lib/rate-limit.ts), the same PostgREST path every
-- other read/write in these routes already uses -- no separate trusted connection needed.
-- `identity_hash` is a sha256 of the caller's own identity (auth.uid() for authenticated routes,
-- a hashed IP for anonymous ones -- see hashIdentity in rate-limit.ts), computed client-side
-- before the call, so no raw IP or other identifying value is ever transmitted or stored here.
-- window_start buckets requests into fixed windows (one bucket per window_seconds, not a sliding
-- log), the simplest correct approach at this scale. Old windows are deleted opportunistically
-- inside the same function call (no cron/pg_cron dependency needed), so the table never
-- accumulates unbounded rows and never permanently retains anything -- it is pure ephemeral
-- counter state.
--
-- Known residual risk (see docs/SECURITY.md "Rate limiting"): p_identity_hash is caller-supplied
-- rather than derived server-side from auth.uid(), because the same function also has to serve
-- anonymous callers (hashed IP), who have no auth.uid() to derive from. An authenticated user who
-- already knows another user's id (ids are opaque UUIDs, not otherwise exposed by this product)
-- could in principle call this RPC directly with that id's hash to pre-exhaust their quota for a
-- known route/scope -- a denial-of-service on rate-limited actions for one specific, already-
-- identified victim, never a data-read/write bypass, since the limiter is defense-in-depth
-- alongside requireDataAdmin's role check and RLS ownership, never the sole authorization gate.
-- Accepted for this milestone rather than splitting into a separate auth.uid()-only RPC.
create table private.rate_limit_counters (
  scope text not null,
  identity_hash text not null,
  window_start timestamptz not null,
  request_count integer not null default 0,
  primary key(scope,identity_hash,window_start)
);

revoke all on private.rate_limit_counters from anon,authenticated;

-- Returns {allowed,count,limit,retryAfterSeconds}. Atomic under concurrency: the upsert's
-- row-level lock serializes concurrent increments for the same scope/identity/window, so two
-- simultaneous requests cannot both observe "count was 0" and both proceed when the limit is 1.
create function public.check_rate_limit(
  p_scope text,p_identity_hash text,p_max_count integer,p_window_seconds integer
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  v_window_start timestamptz;
  v_count integer;
begin
  if p_scope is null or length(p_scope)=0 or length(p_scope)>100
    or p_identity_hash is null or length(p_identity_hash)=0 or length(p_identity_hash)>128
    or p_max_count is null or p_max_count<1
    or p_window_seconds is null or p_window_seconds<1 then
    raise exception 'INVALID_RATE_LIMIT_ARGS';
  end if;

  v_window_start := to_timestamp(floor(extract(epoch from now())/p_window_seconds)*p_window_seconds);

  insert into private.rate_limit_counters(scope,identity_hash,window_start,request_count)
    values(p_scope,p_identity_hash,v_window_start,1)
  on conflict(scope,identity_hash,window_start) do update
    set request_count=private.rate_limit_counters.request_count+1
  returning request_count into v_count;

  -- Opportunistic cleanup: any window more than 2 windows old for this same scope/identity is
  -- stale and safe to drop. Runs on every call rather than a scheduled job -- cheap (matches the
  -- primary key prefix) and keeps the table bounded without any external scheduler.
  delete from private.rate_limit_counters
    where scope=p_scope and identity_hash=p_identity_hash
      and window_start<v_window_start-make_interval(secs=>2*p_window_seconds);

  return jsonb_build_object(
    'allowed',v_count<=p_max_count,
    'count',v_count,
    'limit',p_max_count,
    'retryAfterSeconds',case when v_count<=p_max_count then 0
      else greatest(1,ceil(extract(epoch from (v_window_start+make_interval(secs=>p_window_seconds)-now())))::integer)
    end
  );
end $$;

revoke all on function public.check_rate_limit(text,text,integer,integer) from public,anon;
grant execute on function public.check_rate_limit(text,text,integer,integer) to authenticated;

commit;
