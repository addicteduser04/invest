begin;

-- 202609010001 already defines public.get_market_data_operational_snapshot() with
-- `revoke all ... from public; grant execute ... to authenticated;`, and its own body returns
-- null to any non-data_admin caller -- yet the Security Advisor re-run against the live staging
-- project after 202609100002 still showed `anon` able to execute it
-- (has_function_privilege('anon', ..., 'execute') = true), yet its sibling
-- get_market_data_health_summary() in the same file (intentionally public, not touched here)
-- and every function this migration set's predecessor (202609100002) explicitly revoked are now
-- correctly locked down. Root cause not fully traced (nothing in this repo's migration history
-- re-grants it); fixed at the grant layer directly since that is what is actually enforced,
-- rather than left relying on a revoke statement that evidently stopped holding at some point
-- after it originally ran.
revoke execute on function public.get_market_data_operational_snapshot() from public,anon;
grant execute on function public.get_market_data_operational_snapshot() to authenticated;

commit;
