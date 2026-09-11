begin;

-- Follow-up to 202609100001's rate limiter. public.check_rate_limit was reachable by any
-- PostgREST client (anon or authenticated) that already held the `authenticated` grant, with
-- p_identity_hash caller-supplied rather than server-derived -- documented as an accepted
-- "quota grief" risk in docs/SECURITY.md, but on review that framing was too narrow: a direct
-- PostgREST caller could also spray arbitrary scope/identity_hash pairs and manufacture rows in
-- private.rate_limit_counters, an unbounded write surface the caller-supplied identity was never
-- meant to expose. The counters are ephemeral and self-pruning, but "the DB accepts writes driven
-- entirely by client input, gated by nothing but a role grant" is exactly the kind of primitive
-- this milestone's authorization work is otherwise removing.
--
-- The limiter is meant to be an internal helper every protected route calls on the server's own
-- behalf, never a primitive a browser calls directly -- so it does not belong in PostgREST's
-- exposed surface (`public`) at all. Moved to `private`, which supabase/config.toml's
-- `api.schemas` never lists (only public/storage/graphql_public), so PostgREST returns 404 for
-- any supabase.rpc('check_rate_limit', ...) call regardless of grants -- the fix is structural,
-- not just another revoke. apps/web/lib/rate-limit.ts now calls it over a direct WORKER_DATABASE_
-- URL connection (the same trusted, non-PostgREST path apps/web/lib/job-lock.ts already uses for
-- the advisory lock), which authenticates as the project's postgres role and needs no grant at
-- all -- the revoke below is defense-in-depth in case api.schemas is ever widened, matching this
-- codebase's existing belt-and-suspenders convention rather than relying on schema exposure alone.
drop function public.check_rate_limit(text,text,integer,integer);

create function private.check_rate_limit(
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

revoke all on function private.check_rate_limit(text,text,integer,integer) from public,anon,authenticated;

commit;
