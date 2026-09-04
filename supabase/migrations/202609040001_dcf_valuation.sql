begin;

-- Minimal schema extension anticipated by the original fundamentals design: optional line items
-- needed to compute FCFF (EBIT * (1 - tax rate) + D&A - capex - change in NWC) without inventing
-- any of them from other fields. All nullable, same numeric(20,6) precision as the existing
-- income-statement/balance-sheet/cash-flow columns; blanks stay null, never coerced to 0.
alter table market.fundamentals
  add column depreciation_amortization numeric(20,6),
  add column tax_expense numeric(20,6),
  add column working_capital numeric(20,6),
  add column change_in_working_capital numeric(20,6);

-- Re-published to also carry the four new optional columns (same product-safe column set
-- otherwise: no created_by, no validation_report, no import-run linkage).
create or replace view public.security_fundamentals with (security_invoker=false, security_barrier=true) as
select
  f.id,
  f.security_id,
  f.period_type,
  f.interim_period,
  f.fiscal_year,
  f.period_end_date,
  f.publication_date,
  f.currency,
  f.revenue,
  f.ebitda,
  f.ebit,
  f.net_income,
  f.eps,
  f.cash_and_equivalents,
  f.total_debt,
  f.total_assets,
  f.total_equity,
  f.operating_cash_flow,
  f.capex,
  f.shares_outstanding,
  f.dividend_per_share,
  f.depreciation_amortization,
  f.tax_expense,
  f.working_capital,
  f.change_in_working_capital
from market.fundamentals f;

-- Re-published apply_fundamentals_import to accept and upsert the four new optional fields.
-- Identical shape/semantics to the original function otherwise (see
-- 202609030001_market_fundamentals.sql for the "WHERE ... IS DISTINCT FROM ... RETURNING
-- (xmax = 0)" insert/update/no-op accounting idiom this reuses unchanged).
create or replace function public.apply_fundamentals_import(
  p_source_hash text,
  p_original_filename text,
  p_rows jsonb,
  p_validation_report jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_user uuid := auth.uid();
  v_import_run_id uuid;
  v_inserted integer := 0;
  v_updated integer := 0;
  v_noop integer := 0;
  v_row_count integer;
begin
  if v_user is null or not private.has_role('data_admin') then raise exception 'FORBIDDEN'; end if;
  if p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)=0 or jsonb_array_length(p_rows)>2000 then
    raise exception 'INVALID_FUNDAMENTALS_FILE';
  end if;
  v_row_count:=jsonb_array_length(p_rows);

  with incoming as (
    select
      (r->>'securityId')::uuid as security_id,
      r->>'periodType' as period_type,
      nullif(r->>'interimPeriod','') as interim_period,
      (r->>'fiscalYear')::integer as fiscal_year,
      (r->>'periodEndDate')::date as period_end_date,
      nullif(r->>'publicationDate','')::date as publication_date,
      coalesce(nullif(r->>'currency',''),'MAD') as currency,
      coalesce(nullif(r->>'sourceProviderId',''),'admin_csv') as source_provider_id,
      nullif(r->>'revenue','')::numeric as revenue,
      nullif(r->>'ebitda','')::numeric as ebitda,
      nullif(r->>'ebit','')::numeric as ebit,
      nullif(r->>'netIncome','')::numeric as net_income,
      nullif(r->>'eps','')::numeric as eps,
      nullif(r->>'cash','')::numeric as cash_and_equivalents,
      nullif(r->>'totalDebt','')::numeric as total_debt,
      nullif(r->>'totalAssets','')::numeric as total_assets,
      nullif(r->>'totalEquity','')::numeric as total_equity,
      nullif(r->>'operatingCashFlow','')::numeric as operating_cash_flow,
      nullif(r->>'capex','')::numeric as capex,
      nullif(r->>'sharesOutstanding','')::numeric as shares_outstanding,
      nullif(r->>'dividendPerShare','')::numeric as dividend_per_share,
      nullif(r->>'depreciationAmortization','')::numeric as depreciation_amortization,
      nullif(r->>'taxExpense','')::numeric as tax_expense,
      nullif(r->>'workingCapital','')::numeric as working_capital,
      nullif(r->>'changeInWorkingCapital','')::numeric as change_in_working_capital
    from jsonb_array_elements(p_rows) as r
  ),
  applied as (
    insert into market.fundamentals as f(
      security_id,period_type,interim_period,fiscal_year,period_end_date,publication_date,
      currency,source_provider_id,revenue,ebitda,ebit,net_income,eps,
      cash_and_equivalents,total_debt,total_assets,total_equity,
      operating_cash_flow,capex,shares_outstanding,dividend_per_share,
      depreciation_amortization,tax_expense,working_capital,change_in_working_capital
    )
    select
      security_id,period_type,interim_period,fiscal_year,period_end_date,publication_date,
      currency,source_provider_id,revenue,ebitda,ebit,net_income,eps,
      cash_and_equivalents,total_debt,total_assets,total_equity,
      operating_cash_flow,capex,shares_outstanding,dividend_per_share,
      depreciation_amortization,tax_expense,working_capital,change_in_working_capital
    from incoming
    on conflict(security_id,period_type,period_end_date) do update set
      interim_period=excluded.interim_period,
      fiscal_year=excluded.fiscal_year,
      publication_date=excluded.publication_date,
      currency=excluded.currency,
      source_provider_id=excluded.source_provider_id,
      revenue=excluded.revenue,
      ebitda=excluded.ebitda,
      ebit=excluded.ebit,
      net_income=excluded.net_income,
      eps=excluded.eps,
      cash_and_equivalents=excluded.cash_and_equivalents,
      total_debt=excluded.total_debt,
      total_assets=excluded.total_assets,
      total_equity=excluded.total_equity,
      operating_cash_flow=excluded.operating_cash_flow,
      capex=excluded.capex,
      shares_outstanding=excluded.shares_outstanding,
      dividend_per_share=excluded.dividend_per_share,
      depreciation_amortization=excluded.depreciation_amortization,
      tax_expense=excluded.tax_expense,
      working_capital=excluded.working_capital,
      change_in_working_capital=excluded.change_in_working_capital,
      updated_at=now()
    where
      f.interim_period is distinct from excluded.interim_period or
      f.fiscal_year is distinct from excluded.fiscal_year or
      f.publication_date is distinct from excluded.publication_date or
      f.currency is distinct from excluded.currency or
      f.source_provider_id is distinct from excluded.source_provider_id or
      f.revenue is distinct from excluded.revenue or
      f.ebitda is distinct from excluded.ebitda or
      f.ebit is distinct from excluded.ebit or
      f.net_income is distinct from excluded.net_income or
      f.eps is distinct from excluded.eps or
      f.cash_and_equivalents is distinct from excluded.cash_and_equivalents or
      f.total_debt is distinct from excluded.total_debt or
      f.total_assets is distinct from excluded.total_assets or
      f.total_equity is distinct from excluded.total_equity or
      f.operating_cash_flow is distinct from excluded.operating_cash_flow or
      f.capex is distinct from excluded.capex or
      f.shares_outstanding is distinct from excluded.shares_outstanding or
      f.dividend_per_share is distinct from excluded.dividend_per_share or
      f.depreciation_amortization is distinct from excluded.depreciation_amortization or
      f.tax_expense is distinct from excluded.tax_expense or
      f.working_capital is distinct from excluded.working_capital or
      f.change_in_working_capital is distinct from excluded.change_in_working_capital
    returning(xmax=0) as inserted
  )
  select count(*) filter(where inserted),count(*) filter(where not inserted)
    into v_inserted,v_updated
  from applied;

  v_noop:=v_row_count-v_inserted-v_updated;

  insert into market.fundamentals_import_runs(
    status,source_hash,original_filename,row_count,inserted_count,updated_count,noop_count,
    rejected_count,validation_report,created_by,applied_at
  ) values(
    'applied',p_source_hash,p_original_filename,v_row_count,v_inserted,v_updated,v_noop,
    0,coalesce(p_validation_report,'{}'::jsonb),v_user,now()
  ) returning id into v_import_run_id;

  insert into audit.events(actor_id,actor_type,action,entity_type,after_state)
  values(v_user,'admin','market_fundamentals.upserted','fundamentals',
    jsonb_build_object('inserted',v_inserted,'updated',v_updated,'noop',v_noop,'importRunId',v_import_run_id));

  return jsonb_build_object(
    'insertedCount',v_inserted,'updatedCount',v_updated,'noopCount',v_noop,'importRunId',v_import_run_id
  );
end $$;

-- DCF scenarios: user-authored model configuration (assumption sets), not canonical financial
-- statements -- JSONB is acceptable here for exactly that reason. Owner-scoped via a direct RLS
-- policy (the same simple pattern as public.portfolios), not a SECURITY DEFINER RPC layer: this
-- is private per-user data with no cross-user read path and no admin governance step, unlike the
-- market schema's admin-gated writes.
create table public.dcf_scenarios (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  security_id uuid not null references market.securities(id),
  name text not null check(length(trim(name)) between 1 and 100),
  assumptions jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,security_id,name)
);

create index dcf_scenarios_user_security_idx on public.dcf_scenarios(user_id,security_id);

alter table public.dcf_scenarios enable row level security;

create policy dcf_scenarios_owner_all on public.dcf_scenarios
  for all using(user_id=auth.uid()) with check(user_id=auth.uid());

revoke all on public.dcf_scenarios from anon;
revoke all on public.dcf_scenarios from authenticated;
grant select,insert,update,delete on public.dcf_scenarios to authenticated;

commit;
