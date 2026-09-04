begin;

-- Normalized, point-in-time-capable financial statement data per security x period.
-- One row per (security_id, period_type, period_end_date); explicit numeric columns, not a
-- JSON blob, so future valuation work can query/aggregate individual line items directly.
create table market.fundamentals (
  id uuid primary key default gen_random_uuid(),
  security_id uuid not null references market.securities(id),
  period_type text not null check(period_type in ('annual','interim')),
  interim_period text check(interim_period in ('H1','H2')),
  fiscal_year integer not null check(fiscal_year between 1990 and 2100),
  period_end_date date not null,
  -- Nullable and never backfilled from period_end_date: an unknown publication date must stay
  -- unknown, so future backtests never assume data was public before it actually was.
  publication_date date,
  currency text not null default 'MAD' check(currency ~ '^[A-Z]{3}$'),
  source_provider_id text not null check(source_provider_id in ('admin_csv','licensed_api','licensed_sftp')),
  -- Income statement
  revenue numeric(20,6),
  ebitda numeric(20,6),
  ebit numeric(20,6),
  net_income numeric(20,6),
  eps numeric(20,6),
  -- Balance sheet
  cash_and_equivalents numeric(20,6),
  total_debt numeric(20,6),
  total_assets numeric(20,6),
  total_equity numeric(20,6),
  -- Cash flow (capex stored as a non-negative magnitude of cash spent; FCF = operating_cash_flow - capex)
  operating_cash_flow numeric(20,6),
  capex numeric(20,6) check(capex is null or capex>=0),
  -- Capital
  shares_outstanding numeric(24,0) check(shares_outstanding is null or shares_outstanding>=0),
  dividend_per_share numeric(20,6),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check((period_type='interim' and interim_period is not null) or (period_type='annual' and interim_period is null)),
  check(publication_date is null or publication_date>=period_end_date),
  unique(security_id,period_type,period_end_date)
);

create index market_fundamentals_security_period_idx
  on market.fundamentals(security_id,period_end_date desc);

-- Durable import audit trail, mirroring market.ingestion_runs' role but sized down: fundamentals
-- import is a single-admin validate-then-confirm workflow, not the two-admin price-import flow.
create table market.fundamentals_import_runs (
  id uuid primary key default gen_random_uuid(),
  status text not null check(status in ('validated','applied','rejected')),
  source_hash text not null,
  original_filename text not null,
  row_count integer not null default 0,
  inserted_count integer not null default 0,
  updated_count integer not null default 0,
  noop_count integer not null default 0,
  rejected_count integer not null default 0,
  validation_report jsonb not null default '{}'::jsonb,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  applied_at timestamptz
);

create index market_fundamentals_import_runs_created_at_idx
  on market.fundamentals_import_runs(created_at desc);

create trigger fundamentals_import_runs_no_delete
  before delete on market.fundamentals_import_runs
  for each row execute function private.prevent_mutation();

alter table market.fundamentals enable row level security;
alter table market.fundamentals_import_runs enable row level security;

-- Apply a validated CSV import: upsert every row and report exact insert/update/no-op counts
-- in one statement via "on conflict ... where <changed> returning (xmax = 0)" -- a row that
-- hits the conflict but fails the WHERE clause is silently skipped (a true no-op) and never
-- appears in RETURNING, so row_count - inserted - updated is the no-op count.
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
      nullif(r->>'dividendPerShare','')::numeric as dividend_per_share
    from jsonb_array_elements(p_rows) as r
  ),
  applied as (
    insert into market.fundamentals as f(
      security_id,period_type,interim_period,fiscal_year,period_end_date,publication_date,
      currency,source_provider_id,revenue,ebitda,ebit,net_income,eps,
      cash_and_equivalents,total_debt,total_assets,total_equity,
      operating_cash_flow,capex,shares_outstanding,dividend_per_share
    )
    select
      security_id,period_type,interim_period,fiscal_year,period_end_date,publication_date,
      currency,source_provider_id,revenue,ebitda,ebit,net_income,eps,
      cash_and_equivalents,total_debt,total_assets,total_equity,
      operating_cash_flow,capex,shares_outstanding,dividend_per_share
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
      f.dividend_per_share is distinct from excluded.dividend_per_share
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

-- Read existing period keys for a set of securities, so the preview step can warn "N periods
-- will be updated" instead of guessing at insert-vs-update ahead of the actual apply.
create function public.list_fundamentals_periods(p_security_ids uuid[])
returns table(security_id uuid,period_type text,period_end_date date)
language sql stable security definer set search_path='' as $$
  select f.security_id,f.period_type,f.period_end_date
  from market.fundamentals f
  where auth.uid() is not null and private.has_role('data_admin') and f.security_id=any(p_security_ids)
$$;

create function public.list_fundamentals_import_runs(p_limit integer default 50)
returns table(
  id uuid,status text,source_hash text,original_filename text,row_count integer,
  inserted_count integer,updated_count integer,noop_count integer,rejected_count integer,
  created_by uuid,created_at timestamptz,applied_at timestamptz
)
language sql stable security definer set search_path='' as $$
  select r.id,r.status,r.source_hash,r.original_filename,r.row_count,
    r.inserted_count,r.updated_count,r.noop_count,r.rejected_count,
    r.created_by,r.created_at,r.applied_at
  from market.fundamentals_import_runs r
  where auth.uid() is not null and private.has_role('data_admin')
  order by r.created_at desc
  limit least(coalesce(p_limit,50),200)
$$;

-- Product-safe read model: no created_by, no validation_report, no import-run linkage.
create view public.security_fundamentals with (security_invoker=false, security_barrier=true) as
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
  f.dividend_per_share
from market.fundamentals f;

revoke all on public.security_fundamentals from public;
grant select on public.security_fundamentals to anon,authenticated;

revoke all on function public.apply_fundamentals_import(text,text,jsonb,jsonb) from public;
revoke all on function public.list_fundamentals_periods(uuid[]) from public;
revoke all on function public.list_fundamentals_import_runs(integer) from public;
grant execute on function public.apply_fundamentals_import(text,text,jsonb,jsonb) to authenticated;
grant execute on function public.list_fundamentals_periods(uuid[]) to authenticated;
grant execute on function public.list_fundamentals_import_runs(integer) to authenticated;

commit;
