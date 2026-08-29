begin;

-- Preserve historical security metadata for holdings that later become delisted,
-- while keeping raw ingestion payloads private. Only normalized provider identity is exposed.
create or replace view public.market_security_overview with (security_invoker=false, security_barrier=true) as
select
  s.id,
  s.name,
  s.ticker,
  s.sector,
  s.listing_status,
  s.listed_on,
  s.is_synthetic,
  lp.market_date as latest_market_date,
  lp.close_price as latest_close_price,
  pp.market_date as previous_market_date,
  pp.close_price as previous_close_price,
  case
    when lp.close_price is null or pp.close_price is null or pp.close_price=0 then null
    else ((lp.close_price-pp.close_price)/pp.close_price)*100
  end as daily_change_percent,
  case when lp.status='provisional' then true else false end as latest_price_provisional,
  lp.provider_id as latest_provider_id
from market.securities s
left join lateral (
  select p.market_date,p.close_price,p.status,r.provider_id
  from market.prices p
  join market.ingestion_runs r on r.id=p.ingestion_run_id
  where p.security_id=s.id and p.status in ('published','provisional')
  order by p.market_date desc,p.published_at desc
  limit 1
) lp on true
left join lateral (
  select p.market_date,p.close_price
  from market.prices p
  where p.security_id=s.id and p.status in ('published','provisional')
    and (lp.market_date is null or p.market_date<lp.market_date)
  order by p.market_date desc,p.published_at desc
  limit 1
) pp on true
where s.listing_status in ('active','suspended','delisted');

create or replace view public.market_price_history with (security_invoker=false, security_barrier=true) as
select
  p.security_id,
  p.market_date,
  p.close_price,
  p.status,
  p.published_at,
  r.provider_id
from market.prices p
join market.securities s on s.id=p.security_id
join market.ingestion_runs r on r.id=p.ingestion_run_id
where s.listing_status in ('active','suspended','delisted')
  and p.status in ('published','provisional');

revoke all on public.market_security_overview,public.market_price_history from public;
grant select on public.market_security_overview,public.market_price_history to anon,authenticated;

commit;
