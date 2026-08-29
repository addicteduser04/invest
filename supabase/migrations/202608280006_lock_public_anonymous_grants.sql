begin;

-- Local Supabase grants broad default privileges on public objects. Keep public market
-- read models open, but make account and portfolio data authenticated-only.
revoke all on
  public.profiles,
  public.user_roles,
  public.portfolios,
  public.transactions,
  public.transaction_imports,
  public.transaction_import_attempts
from anon;

revoke all on
  public.profiles,
  public.user_roles,
  public.portfolios,
  public.transactions,
  public.transaction_imports,
  public.transaction_import_attempts
from authenticated;

grant select, update on public.profiles to authenticated;
grant select on public.user_roles to authenticated;
grant select, insert, update on public.portfolios to authenticated;
grant select, insert on public.transactions to authenticated;
grant select on public.transaction_imports, public.transaction_import_attempts to authenticated;

revoke all on function public.record_transaction(uuid,text,date,text,numeric,uuid,numeric,numeric,numeric,numeric) from anon;
revoke all on function public.create_transaction_import(uuid,text,text,bigint,text,text,jsonb,integer,jsonb,jsonb) from anon;
revoke all on function public.confirm_transaction_import(uuid) from anon;
revoke all on function public.supersede_transaction_import(uuid) from anon;
revoke all on function public.replace_transaction_import(uuid,uuid,text,text,bigint,text,text,jsonb,integer,jsonb,jsonb) from anon;
revoke all on function public.reverse_transaction(uuid,uuid,text,text,jsonb) from anon;
revoke all on function public.propose_market_price_import(text,text,jsonb,jsonb,text,jsonb) from anon;
revoke all on function public.publish_market_price_import(uuid,text) from anon;
revoke all on function public.list_market_price_imports() from anon;
revoke all on function public.upsert_market_security_master(jsonb) from anon;
revoke all on function public.list_market_security_master_admin() from anon;

grant execute on function public.record_transaction(uuid,text,date,text,numeric,uuid,numeric,numeric,numeric,numeric) to authenticated;
grant execute on function public.create_transaction_import(uuid,text,text,bigint,text,text,jsonb,integer,jsonb,jsonb) to authenticated;
grant execute on function public.confirm_transaction_import(uuid) to authenticated;
grant execute on function public.supersede_transaction_import(uuid) to authenticated;
grant execute on function public.replace_transaction_import(uuid,uuid,text,text,bigint,text,text,jsonb,integer,jsonb,jsonb) to authenticated;
grant execute on function public.reverse_transaction(uuid,uuid,text,text,jsonb) to authenticated;
grant execute on function public.propose_market_price_import(text,text,jsonb,jsonb,text,jsonb) to authenticated;
grant execute on function public.publish_market_price_import(uuid,text) to authenticated;
grant execute on function public.list_market_price_imports() to authenticated;
grant execute on function public.upsert_market_security_master(jsonb) to authenticated;
grant execute on function public.list_market_security_master_admin() to authenticated;

commit;
