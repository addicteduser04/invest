begin;

-- Expose issuer_id on the shared security overview (needed by Security Detail's "view company"
-- link and by admin fundamentals import's ticker->issuer resolution) and ammc_issuer_id on the
-- public issuer directory (a public regulator identifier, not sensitive -- same openness rule
-- already applied to source_provider_id on company documents).

drop view public.market_security_overview;
create or replace view public.market_security_overview with (security_invoker=false, security_barrier=true) as
select
  s.id,
  s.name,
  s.ticker,
  s.sector,
  s.listing_status,
  s.listed_on,
  s.is_synthetic,
  s.issuer_id,
  lp.market_date as latest_market_date,
  lp.close_price as latest_close_price,
  pp.market_date as previous_market_date,
  pp.close_price as previous_close_price,
  case
    when lp.close_price is null or pp.close_price is null or pp.close_price=0 then null
    else ((lp.close_price-pp.close_price)/pp.close_price)*100
  end as daily_change_percent,
  case when lp.status='provisional' then true else false end as latest_price_provisional,
  lp.provider_id as latest_provider_id,
  s.isin,
  s.issuer_name,
  s.instrument_type,
  s.market_segment,
  s.share_count,
  s.source_provider_id as security_source_provider_id
from market.securities s
left join lateral (
  select p.market_date,p.close_price,p.status,r.provider_id
  from market.prices p join market.ingestion_runs r on r.id=p.ingestion_run_id
  where p.security_id=s.id and p.status in ('published','provisional')
  order by p.market_date desc limit 1
) lp on true
left join lateral (
  select p.market_date,p.close_price
  from market.prices p
  where p.security_id=s.id and p.status in ('published','provisional') and p.market_date<lp.market_date
  order by p.market_date desc limit 1
) pp on true;

revoke all on public.market_security_overview from public;
grant select on public.market_security_overview to anon,authenticated;

drop view public.issuer_directory;
create view public.issuer_directory with (security_invoker=false, security_barrier=true) as
select
  i.id,
  i.name,
  i.slug,
  i.country_code,
  i.country_name,
  i.issuer_type,
  i.equity_listing_status,
  i.website,
  i.sector,
  i.ammc_issuer_id,
  s.id as security_id,
  s.ticker as security_ticker
from market.issuers i
left join market.securities s on s.issuer_id=i.id and not s.is_synthetic
where not i.is_synthetic;

revoke all on public.issuer_directory from public;
grant select on public.issuer_directory to anon,authenticated;

-- === document_sync_runs: issuer-aware metrics, no more "unmatched = bad" ====================
--
-- documents_matched is dropped (redundant now: a document is only ever fetched for an issuer
-- that already resolved, so "discovered" and "matched" coincide by construction). The old
-- unmatched_issuers jsonb blob is dropped too -- per-run ambiguous entries live durably in
-- market.ambiguous_document_issuers already; duplicating them here added nothing.

alter table market.document_sync_runs drop column documents_matched;
alter table market.document_sync_runs drop column unmatched_issuers;
alter table market.document_sync_runs add column issuers_discovered integer not null default 0;
alter table market.document_sync_runs add column issuers_existing integer not null default 0;
alter table market.document_sync_runs add column issuers_created integer not null default 0;
alter table market.document_sync_runs add column issuers_linked_to_security integer not null default 0;
alter table market.document_sync_runs add column issuers_unlisted integer not null default 0;
alter table market.document_sync_runs add column issuers_ambiguous integer not null default 0;
alter table market.document_sync_runs add column issuers_with_reports integer not null default 0;
alter table market.document_sync_runs add column issuers_without_reports integer not null default 0;

-- === Admin RPCs: issuer-centric replacements =================================================

drop function public.list_company_document_aliases();
drop function public.upsert_company_document_alias(uuid,text,text,text);
-- Both reference the table renamed to market.ambiguous_document_issuers in the prior migration
-- and are replaced by the issuer-centric functions below.
drop function public.list_unmatched_document_issuers(text);
drop function public.resolve_unmatched_document_issuer(uuid,text);
-- Signature is gaining p_issuer_id; the old 8-parameter overload must go, not just be shadowed.
drop function public.upsert_company_document_manual(uuid,uuid,text,integer,text,text,date,text);
drop function public.list_document_sync_runs(integer);
drop function public.list_fundamentals_periods(uuid[]);

-- Admin: set/correct an issuer's direct AMMC mapping (replaces the old alias-table RPCs -- see
-- the 202609070002 migration comment for why a separate join table became redundant).
create function public.upsert_issuer_ammc_link(
  p_issuer_id uuid,p_ammc_issuer_id text,p_ammc_issuer_name text
) returns uuid language plpgsql security definer set search_path='' as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null or not private.has_role('data_admin') then raise exception 'FORBIDDEN'; end if;
  if not exists(select 1 from market.issuers where id=p_issuer_id) then raise exception 'UNKNOWN_ISSUER'; end if;
  update market.issuers set
    ammc_issuer_id=nullif(trim(p_ammc_issuer_id),''),
    ammc_issuer_name=nullif(trim(coalesce(p_ammc_issuer_name,'')),''),
    updated_at=now()
  where id=p_issuer_id;
  return p_issuer_id;
end $$;

-- Admin: explicitly create a new issuer (unlisted Moroccan issuer, foreign issuer, or fixing an
-- ambiguous-review case by creating a genuinely new one). Never called automatically for a
-- fuzzy/ambiguous match -- only for a deliberate admin action or an unambiguous AMMC discovery
-- (see @bvc/annual-reports's sync.ts, which uses the same insert path via a trusted worker
-- connection, not this RPC).
create function public.create_issuer_manual(
  p_name text,p_issuer_type text,p_equity_listing_status text,p_country_code text,
  p_country_name text,p_sector text,p_website text,p_ammc_issuer_id text,p_ammc_issuer_name text
) returns uuid language plpgsql security definer set search_path='' as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
  v_slug text;
  v_suffix integer := 1;
begin
  if v_user is null or not private.has_role('data_admin') then raise exception 'FORBIDDEN'; end if;
  if p_name is null or length(trim(p_name))=0 then raise exception 'INVALID_NAME'; end if;
  if p_equity_listing_status not in ('listed_bvc','no_listed_bvc_equity','historical_or_delisted','unknown') then
    raise exception 'INVALID_EQUITY_LISTING_STATUS';
  end if;

  v_slug:=private.slugify(p_name);
  while exists(select 1 from market.issuers where slug=v_slug) loop
    v_suffix:=v_suffix+1;
    v_slug:=private.slugify(p_name)||'-'||v_suffix;
  end loop;

  insert into market.issuers(
    name,normalized_name,slug,issuer_type,equity_listing_status,country_code,country_name,
    sector,website,ammc_issuer_id,ammc_issuer_name
  ) values(
    trim(p_name),private.normalize_company_name(p_name),v_slug,p_issuer_type,p_equity_listing_status,
    nullif(trim(coalesce(p_country_code,'')),''),nullif(trim(coalesce(p_country_name,'')),''),
    nullif(trim(coalesce(p_sector,'')),''),nullif(trim(coalesce(p_website,'')),''),
    nullif(trim(coalesce(p_ammc_issuer_id,'')),''),nullif(trim(coalesce(p_ammc_issuer_name,'')),'')
  ) returning id into v_id;
  return v_id;
end $$;

-- Admin: review/resolve ambiguous issuer mappings. Optionally links the AMMC issuer id straight
-- onto an existing SaifInvest issuer as part of resolving -- one action instead of two.
create or replace function public.resolve_ambiguous_document_issuer(
  p_id uuid,p_status text,p_link_issuer_id uuid default null
) returns void language plpgsql security definer set search_path='' as $$
declare
  v_user uuid := auth.uid();
  v_source_issuer_id text;
  v_source_issuer_name text;
begin
  if v_user is null or not private.has_role('data_admin') then raise exception 'FORBIDDEN'; end if;
  if p_status not in ('resolved','ignored','open') then raise exception 'INVALID_STATUS'; end if;

  select source_issuer_id,source_issuer_name into v_source_issuer_id,v_source_issuer_name
  from market.ambiguous_document_issuers where id=p_id;
  if not found then raise exception 'NOT_FOUND'; end if;

  if p_link_issuer_id is not null then
    if not exists(select 1 from market.issuers where id=p_link_issuer_id) then
      raise exception 'UNKNOWN_ISSUER';
    end if;
    update market.issuers set ammc_issuer_id=v_source_issuer_id,ammc_issuer_name=v_source_issuer_name,updated_at=now()
    where id=p_link_issuer_id;
  end if;

  update market.ambiguous_document_issuers
    set status=p_status,
        candidate_issuer_id=coalesce(p_link_issuer_id,candidate_issuer_id),
        resolved_at=case when p_status='open' then null else now() end,
        resolved_by=case when p_status='open' then null else v_user end
    where id=p_id;
end $$;

create function public.list_ambiguous_document_issuers(p_status text default 'open')
returns table(
  id uuid,source_provider_id text,source_issuer_id text,source_issuer_name text,
  candidate_issuer_id uuid,status text,first_seen_at timestamptz,last_seen_at timestamptz
)
language sql stable security definer set search_path='' as $$
  select u.id,u.source_provider_id,u.source_issuer_id,u.source_issuer_name,
    u.candidate_issuer_id,u.status,u.first_seen_at,u.last_seen_at
  from market.ambiguous_document_issuers u
  where auth.uid() is not null and private.has_role('data_admin')
    and (p_status is null or u.status=p_status)
  order by u.last_seen_at desc
$$;

-- Admin: manual fallback document entry -- now issuer-first. p_security_id stays as a
-- convenience: when given (and p_issuer_id is not), it resolves to that security's issuer,
-- covering the common "I'm looking at this ticker's admin page" case without forcing every
-- admin to know the issuer id.
create or replace function public.upsert_company_document_manual(
  p_id uuid,p_issuer_id uuid,p_security_id uuid,p_document_type text,p_fiscal_year integer,p_title text,
  p_source_url text,p_publication_date date,p_language text
) returns uuid language plpgsql security definer set search_path='' as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
  v_issuer_id uuid;
begin
  if v_user is null or not private.has_role('data_admin') then raise exception 'FORBIDDEN'; end if;

  v_issuer_id:=p_issuer_id;
  if v_issuer_id is null and p_security_id is not null then
    select issuer_id into v_issuer_id from market.securities where id=p_security_id;
  end if;
  if v_issuer_id is null or not exists(select 1 from market.issuers where id=v_issuer_id) then
    raise exception 'UNKNOWN_ISSUER';
  end if;

  if p_document_type not in ('annual_report','half_year_report','financial_statements','earnings_release','presentation','other') then
    raise exception 'INVALID_DOCUMENT_TYPE';
  end if;
  if p_source_url !~ '^https://' then raise exception 'INVALID_SOURCE_URL'; end if;
  if p_fiscal_year is null or p_fiscal_year<1990 or p_fiscal_year>2100 then raise exception 'INVALID_FISCAL_YEAR'; end if;
  if p_title is null or length(trim(p_title))=0 then raise exception 'INVALID_TITLE'; end if;

  if p_id is not null then
    update market.company_documents set
      issuer_id=v_issuer_id,document_type=p_document_type,fiscal_year=p_fiscal_year,
      title=trim(p_title),source_url=p_source_url,publication_date=p_publication_date,
      language=nullif(trim(coalesce(p_language,'')),''),updated_at=now()
    where id=p_id and source_provider_id='admin_manual'
    returning id into v_id;
    if not found then raise exception 'NOT_FOUND'; end if;
    return v_id;
  end if;

  insert into market.company_documents(
    issuer_id,document_type,fiscal_year,title,source_provider_id,source_url,
    publication_date,language,status
  ) values(
    v_issuer_id,p_document_type,p_fiscal_year,trim(p_title),'admin_manual',p_source_url,
    p_publication_date,nullif(trim(coalesce(p_language,'')),''),'published'
  )
  on conflict(source_provider_id,source_url) do update set
    issuer_id=excluded.issuer_id,document_type=excluded.document_type,
    fiscal_year=excluded.fiscal_year,title=excluded.title,
    publication_date=excluded.publication_date,language=excluded.language,updated_at=now()
  returning id into v_id;
  return v_id;
end $$;

-- Admin: issuer-level coverage dashboard (section 26). "Ambiguous" is a small honest review
-- queue, not an error count; no-report issuers are not conflated with sync failures.
create or replace function public.company_documents_coverage_stats()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_user uuid := auth.uid();
  v_result jsonb;
begin
  if v_user is null or not private.has_role('data_admin') then raise exception 'FORBIDDEN'; end if;
  select jsonb_build_object(
    'totalIssuers',(select count(*) from market.issuers where not is_synthetic),
    'listedIssuers',(select count(*) from market.issuers where not is_synthetic and equity_listing_status='listed_bvc'),
    'unlistedIssuers',(select count(*) from market.issuers where not is_synthetic and equity_listing_status='no_listed_bvc_equity'),
    'foreignIssuers',(select count(*) from market.issuers where not is_synthetic and issuer_type='foreign_issuer'),
    'historicalIssuers',(select count(*) from market.issuers where not is_synthetic and equity_listing_status='historical_or_delisted'),
    'issuersWithReports',(
      select count(distinct issuer_id) from market.company_documents d join market.issuers i on i.id=d.issuer_id
      where d.document_type='annual_report' and d.status='published' and not i.is_synthetic
    ),
    'issuersWithoutReports',(
      select count(*) from market.issuers i
      where not i.is_synthetic and not exists(
        select 1 from market.company_documents d
        where d.issuer_id=i.id and d.document_type='annual_report' and d.status='published'
      )
    ),
    'totalReports',(
      select count(*) from market.company_documents d join market.issuers i on i.id=d.issuer_id
      where d.document_type='annual_report' and d.status='published' and not i.is_synthetic
    ),
    'earliestYear',(
      select min(fiscal_year) from market.company_documents d join market.issuers i on i.id=d.issuer_id
      where d.document_type='annual_report' and d.status='published' and not i.is_synthetic
    ),
    'latestYear',(
      select max(fiscal_year) from market.company_documents d join market.issuers i on i.id=d.issuer_id
      where d.document_type='annual_report' and d.status='published' and not i.is_synthetic
    ),
    'ambiguousIssuers',(select count(*) from market.ambiguous_document_issuers where status='open'),
    'lastSync',(
      select jsonb_build_object('id',id,'status',status,'startedAt',started_at,'finishedAt',finished_at)
      from market.document_sync_runs order by started_at desc limit 1
    )
  ) into v_result;
  return v_result;
end $$;

create or replace function public.list_document_sync_runs(p_limit integer default 20)
returns table(
  id uuid,status text,dry_run boolean,scope jsonb,started_at timestamptz,finished_at timestamptz,
  issuers_discovered integer,issuers_existing integer,issuers_created integer,
  issuers_linked_to_security integer,issuers_unlisted integer,issuers_ambiguous integer,
  issuers_with_reports integer,issuers_without_reports integer,
  documents_discovered integer,documents_inserted integer,documents_updated integer,
  documents_unchanged integer,failures jsonb
)
language sql stable security definer set search_path='' as $$
  select r.id,r.status,r.dry_run,r.scope,r.started_at,r.finished_at,
    r.issuers_discovered,r.issuers_existing,r.issuers_created,
    r.issuers_linked_to_security,r.issuers_unlisted,r.issuers_ambiguous,
    r.issuers_with_reports,r.issuers_without_reports,
    r.documents_discovered,r.documents_inserted,r.documents_updated,
    r.documents_unchanged,r.failures
  from market.document_sync_runs r
  where auth.uid() is not null and private.has_role('data_admin')
  order by r.started_at desc
  limit least(coalesce(p_limit,20),100)
$$;

-- === apply_fundamentals_import: issuer-owned, ticker/issuer-id resolved in TypeScript =======
--
-- Resolution precedence (issuer_id > ticker->security->issuer > ammc_issuer_id > issuer_name)
-- happens in @bvc/market-data's previewFundamentalsCsv, same architectural split as before
-- (parsing/validation in TS, this RPC just persists already-resolved rows) -- each incoming row
-- now carries a resolved issuerId instead of a securityId.
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
      (r->>'issuerId')::uuid as issuer_id,
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
      issuer_id,period_type,interim_period,fiscal_year,period_end_date,publication_date,
      currency,source_provider_id,revenue,ebitda,ebit,net_income,eps,
      cash_and_equivalents,total_debt,total_assets,total_equity,
      operating_cash_flow,capex,shares_outstanding,dividend_per_share,
      depreciation_amortization,tax_expense,working_capital,change_in_working_capital
    )
    select
      issuer_id,period_type,interim_period,fiscal_year,period_end_date,publication_date,
      currency,source_provider_id,revenue,ebitda,ebit,net_income,eps,
      cash_and_equivalents,total_debt,total_assets,total_equity,
      operating_cash_flow,capex,shares_outstanding,dividend_per_share,
      depreciation_amortization,tax_expense,working_capital,change_in_working_capital
    from incoming
    on conflict(issuer_id,period_type,period_end_date) do update set
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

-- Read existing period keys for a set of issuers, so the preview step can warn "N periods will
-- be updated" instead of guessing at insert-vs-update ahead of the actual apply.
create or replace function public.list_fundamentals_periods(p_issuer_ids uuid[])
returns table(issuer_id uuid,period_type text,period_end_date date)
language sql stable security definer set search_path='' as $$
  select f.issuer_id,f.period_type,f.period_end_date
  from market.fundamentals f
  where auth.uid() is not null and private.has_role('data_admin') and f.issuer_id=any(p_issuer_ids)
$$;

revoke all on function public.upsert_issuer_ammc_link(uuid,text,text) from public;
revoke all on function public.create_issuer_manual(text,text,text,text,text,text,text,text,text) from public;
revoke all on function public.resolve_ambiguous_document_issuer(uuid,text,uuid) from public;
revoke all on function public.list_ambiguous_document_issuers(text) from public;
revoke all on function public.upsert_company_document_manual(uuid,uuid,uuid,text,integer,text,text,date,text) from public;
revoke all on function public.company_documents_coverage_stats() from public;
revoke all on function public.list_document_sync_runs(integer) from public;

grant execute on function public.upsert_issuer_ammc_link(uuid,text,text) to authenticated;
grant execute on function public.create_issuer_manual(text,text,text,text,text,text,text,text,text) to authenticated;
grant execute on function public.resolve_ambiguous_document_issuer(uuid,text,uuid) to authenticated;
grant execute on function public.list_ambiguous_document_issuers(text) to authenticated;
grant execute on function public.upsert_company_document_manual(uuid,uuid,uuid,text,integer,text,text,date,text) to authenticated;
grant execute on function public.company_documents_coverage_stats() to authenticated;
grant execute on function public.list_document_sync_runs(integer) to authenticated;

commit;
