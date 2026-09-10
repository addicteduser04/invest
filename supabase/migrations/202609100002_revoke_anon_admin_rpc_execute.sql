begin;

-- Supabase Security Advisor, run against the LIVE staging project as part of the security/cost/
-- abuse hardening milestone, flagged 17 SECURITY DEFINER functions as executable by `anon` via
-- PostgREST -- not visible on the local dev database, which already defaults new functions to
-- non-public-executable. Two are intentionally public
-- (public.get_market_data_health_summary -- mirrors the unauthenticated /api/health pattern by
-- design, see 202609010001) and public.rls_auto_enable -- a Supabase-platform-owned function,
-- not defined in any migration in this repo, left untouched. The remaining 15 are all
-- data_admin-gated RPCs added across 202608280009/202609010001/202609030001/202609070003 that
-- should never have been anon-executable.
--
-- Each of these functions already independently checks auth.uid()/private.has_role('data_admin')
-- in its own body, so this was never a live authorization bypass -- an anonymous caller invoking
-- one of these got a clean FORBIDDEN, never a successful admin action. It is still fixed here:
-- needless pre-auth attack surface, and the same belt-and-suspenders grant-layer lockdown every
-- other admin RPC in this codebase already follows (e.g. 202608280006, 202609070003's own
-- revoke/grant footers for issuer RPCs). Revoking a grant nothing legitimate depends on is safe
-- to do immediately; verified that `authenticated` access (used by every one of these routes)
-- is preserved.

revoke execute on function public.apply_fundamentals_import(text,text,jsonb,jsonb) from public,anon;
revoke execute on function public.company_documents_coverage_stats() from public,anon;
revoke execute on function public.create_issuer_manual(text,text,text,text,text,text,text,text,text) from public,anon;
revoke execute on function public.get_market_ingestion_run(uuid) from public,anon;
revoke execute on function public.list_ambiguous_document_issuers(text) from public,anon;
revoke execute on function public.list_document_sync_runs(integer) from public,anon;
revoke execute on function public.list_fundamentals_import_runs(integer) from public,anon;
revoke execute on function public.list_fundamentals_periods(uuid[]) from public,anon;
revoke execute on function public.list_market_ingestion_runs(integer) from public,anon;
revoke execute on function public.resolve_ambiguous_document_issuer(uuid,text,uuid) from public,anon;
revoke execute on function public.upsert_company_document_manual(uuid,uuid,uuid,text,integer,text,text,date,text) from public,anon;
revoke execute on function public.upsert_issuer_ammc_link(uuid,text,text) from public,anon;
revoke execute on function public.upsert_market_index_observations(jsonb) from public,anon;
revoke execute on function public.upsert_market_indices(jsonb) from public,anon;

grant execute on function public.apply_fundamentals_import(text,text,jsonb,jsonb) to authenticated;
grant execute on function public.company_documents_coverage_stats() to authenticated;
grant execute on function public.create_issuer_manual(text,text,text,text,text,text,text,text,text) to authenticated;
grant execute on function public.get_market_ingestion_run(uuid) to authenticated;
grant execute on function public.list_ambiguous_document_issuers(text) to authenticated;
grant execute on function public.list_document_sync_runs(integer) to authenticated;
grant execute on function public.list_fundamentals_import_runs(integer) to authenticated;
grant execute on function public.list_fundamentals_periods(uuid[]) to authenticated;
grant execute on function public.list_market_ingestion_runs(integer) to authenticated;
grant execute on function public.resolve_ambiguous_document_issuer(uuid,text,uuid) to authenticated;
grant execute on function public.upsert_company_document_manual(uuid,uuid,uuid,text,integer,text,text,date,text) to authenticated;
grant execute on function public.upsert_issuer_ammc_link(uuid,text,text) to authenticated;
grant execute on function public.upsert_market_index_observations(jsonb) to authenticated;
grant execute on function public.upsert_market_indices(jsonb) to authenticated;

-- Defense for future migrations run under this same role: a newly created function no longer
-- defaults to PUBLIC-executable, matching what local dev already had.
alter default privileges revoke execute on functions from public;

commit;
