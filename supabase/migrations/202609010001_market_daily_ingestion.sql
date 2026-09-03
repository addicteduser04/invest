begin;

-- Daily automated market-data ingestion: extend market.ingestion_runs to support an
-- unattended pipeline (running/succeeded/partial/failed) alongside the existing
-- CSV two-admin review workflow (uploaded/previewed/quarantined/approved/rejected/published/failed),
-- which is untouched. Structured metrics/failures are kept as JSON per-run rather than
-- proliferating new tables.

alter table market.ingestion_runs drop constraint ingestion_runs_provider_id_check;
alter table market.ingestion_runs add constraint ingestion_runs_provider_id_check
  check(provider_id in ('synthetic','admin_csv','licensed_api','licensed_sftp','bvc_public_testing'));

alter table market.ingestion_runs drop constraint ingestion_runs_status_check;
alter table market.ingestion_runs add constraint ingestion_runs_status_check
  check(status in ('uploaded','previewed','quarantined','approved','rejected','published','failed','running','succeeded','partial'));

alter table market.ingestion_runs
  add column trigger_source text not null default 'manual'
    check(trigger_source in ('schedule','manual','retry','cli')),
  add column started_at timestamptz not null default now(),
  add column finished_at timestamptz,
  add column metrics jsonb not null default '{}'::jsonb,
  add column instrument_failures jsonb not null default '[]'::jsonb,
  add column parent_run_id uuid references market.ingestion_runs(id);

-- Hard guard against two concurrent daily runs for the same market date/provider
-- (double-clicked "Run Now", overlapping schedule + manual trigger, etc.).
create unique index one_running_ingestion_run_per_date_provider_uq
  on market.ingestion_runs(market_date, provider_id)
  where status = 'running';

-- Read RPCs for the admin market-data operations page. All data_admin-gated except the
-- minimal health summary, which mirrors the existing unauthenticated /api/health pattern.

create function public.list_market_ingestion_runs(p_limit integer default 20)
returns table(
  id uuid, provider_id text, market_date date, status text, trigger_source text,
  started_at timestamptz, finished_at timestamptz, metrics jsonb,
  instrument_failures jsonb, parent_run_id uuid, created_at timestamptz
)
language sql stable security definer set search_path=''
as $$
  select r.id, r.provider_id, r.market_date, r.status, r.trigger_source,
    r.started_at, r.finished_at, r.metrics, r.instrument_failures, r.parent_run_id, r.created_at
  from market.ingestion_runs r
  where auth.uid() is not null and private.has_role('data_admin')
    and r.status in ('running','succeeded','partial','failed')
  order by r.started_at desc
  limit greatest(1, least(coalesce(p_limit, 20), 100))
$$;
revoke all on function public.list_market_ingestion_runs(integer) from public;
grant execute on function public.list_market_ingestion_runs(integer) to authenticated;

create function public.get_market_ingestion_run(p_run_id uuid)
returns table(
  id uuid, provider_id text, market_date date, status text, trigger_source text,
  started_at timestamptz, finished_at timestamptz, metrics jsonb,
  instrument_failures jsonb, parent_run_id uuid, created_at timestamptz
)
language sql stable security definer set search_path=''
as $$
  select r.id, r.provider_id, r.market_date, r.status, r.trigger_source,
    r.started_at, r.finished_at, r.metrics, r.instrument_failures, r.parent_run_id, r.created_at
  from market.ingestion_runs r
  where auth.uid() is not null and private.has_role('data_admin')
    and r.id = p_run_id
    and r.status in ('running','succeeded','partial','failed')
$$;
revoke all on function public.get_market_ingestion_run(uuid) from public;
grant execute on function public.get_market_ingestion_run(uuid) to authenticated;

create function public.get_market_data_operational_snapshot()
returns jsonb
language sql stable security definer set search_path=''
as $$
  with last_run as (
    select r.id, r.provider_id, r.market_date, r.status, r.trigger_source,
      r.started_at, r.finished_at, r.metrics, r.instrument_failures
    from market.ingestion_runs r
    where r.status in ('running','succeeded','partial','failed')
    order by r.started_at desc
    limit 1
  ),
  failed_tickers as (
    select coalesce(jsonb_agg(elem.value ->> 'ticker'), '[]'::jsonb) as tickers
    from last_run, jsonb_array_elements(last_run.instrument_failures) as elem(value)
  )
  select case when auth.uid() is null or not private.has_role('data_admin') then null else jsonb_build_object(
    'latestEquityDate', (
      select max(p.market_date) from market.prices p where p.status in ('published','provisional')
    ),
    'latestIndexDate', (
      select max(o.market_date) from market.index_observations o where o.status in ('published','provisional')
    ),
    'lastRun', (
      select jsonb_build_object(
        'id', last_run.id, 'providerId', last_run.provider_id, 'marketDate', last_run.market_date,
        'status', last_run.status, 'triggerSource', last_run.trigger_source,
        'startedAt', last_run.started_at, 'finishedAt', last_run.finished_at, 'metrics', last_run.metrics
      )
      from last_run
    ),
    'coverage', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'securityId', s.id, 'ticker', s.ticker, 'name', s.name,
        'latestMarketDate', lp.market_date,
        'failedLastRun', coalesce((select tickers from failed_tickers) ? s.ticker, false)
      ) order by s.ticker), '[]'::jsonb)
      from market.securities s
      left join lateral (
        select p.market_date from market.prices p
        where p.security_id = s.id and p.status in ('published','provisional')
        order by p.market_date desc limit 1
      ) lp on true
      where s.listing_status in ('active','suspended')
    ),
    'indices', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'code', i.source_code, 'name', i.name, 'latestMarketDate', lo.market_date, 'latestCloseValue', lo.close_value
      ) order by i.source_code), '[]'::jsonb)
      from market.indices i
      left join lateral (
        select o.market_date, o.close_value from market.index_observations o
        where o.index_id = i.id and o.status in ('published','provisional')
        order by o.market_date desc limit 1
      ) lo on true
      where i.status = 'active'
    )
  ) end
$$;
revoke all on function public.get_market_data_operational_snapshot() from public;
grant execute on function public.get_market_data_operational_snapshot() to authenticated;

create function public.get_market_data_health_summary()
returns jsonb
language sql stable security definer set search_path=''
as $$
  select jsonb_build_object(
    'latestEquityDate', (
      select max(p.market_date) from market.prices p where p.status in ('published','provisional')
    ),
    'latestIndexDate', (
      select max(o.market_date) from market.index_observations o where o.status in ('published','provisional')
    ),
    'lastRunStatus', (
      select r.status from market.ingestion_runs r
      where r.status in ('running','succeeded','partial','failed')
      order by r.started_at desc limit 1
    ),
    'lastRunAt', (
      select coalesce(r.finished_at, r.started_at) from market.ingestion_runs r
      where r.status in ('running','succeeded','partial','failed')
      order by r.started_at desc limit 1
    ),
    'failedInstruments', (
      select jsonb_array_length(r.instrument_failures) from market.ingestion_runs r
      where r.status in ('running','succeeded','partial','failed')
      order by r.started_at desc limit 1
    )
  )
$$;
revoke all on function public.get_market_data_health_summary() from public;
grant execute on function public.get_market_data_health_summary() to anon, authenticated;

commit;
