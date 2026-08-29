begin;

-- Preserve normalized OHLCV fields after publication so market pages can render
-- professional charts without reading private candidate rows.
alter table market.prices
  add column open_price numeric(20,6),
  add column high_price numeric(20,6),
  add column low_price numeric(20,6),
  add column volume numeric(24,6);

alter table market.prices
  add constraint market_prices_open_nonnegative check(open_price is null or open_price>=0),
  add constraint market_prices_high_nonnegative check(high_price is null or high_price>=0),
  add constraint market_prices_low_nonnegative check(low_price is null or low_price>=0),
  add constraint market_prices_volume_nonnegative check(volume is null or volume>=0),
  add constraint market_prices_high_consistent check(
    high_price is null
    or ((open_price is null or high_price>=open_price)
      and high_price>=close_price
      and (low_price is null or high_price>=low_price))
  ),
  add constraint market_prices_low_consistent check(
    low_price is null
    or ((open_price is null or low_price<=open_price)
      and low_price<=close_price
      and (high_price is null or low_price<=high_price))
  );

create or replace function public.publish_market_price_import(p_ingestion_run_id uuid,p_review_reason text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  v_user uuid:=auth.uid();
  v_run market.ingestion_runs%rowtype;
  v_count integer:=0;
begin
  if v_user is null or not private.has_role('data_admin') then raise exception 'FORBIDDEN'; end if;
  select * into v_run from market.ingestion_runs where id=p_ingestion_run_id for update;
  if not found then raise exception 'IMPORT_NOT_FOUND'; end if;
  if v_run.proposed_by=v_user then raise exception 'SECOND_ADMIN_REQUIRED'; end if;
  if v_run.status<>'previewed' then raise exception 'IMPORT_NOT_PUBLISHABLE'; end if;
  if exists(select 1 from market.price_candidates where ingestion_run_id=v_run.id and security_id is null) then raise exception 'UNKNOWN_SECURITY'; end if;

  update market.prices p set status='superseded'
  where p.status in ('published','provisional') and exists(
    select 1 from market.price_candidates c where c.ingestion_run_id=v_run.id and c.security_id=p.security_id and c.market_date=p.market_date
  );

  insert into market.prices(
    security_id,market_date,open_price,high_price,low_price,close_price,volume,status,ingestion_run_id
  )
  select
    security_id,market_date,open_price,high_price,low_price,close_price,volume,'published',v_run.id
  from market.price_candidates
  where ingestion_run_id=v_run.id;
  get diagnostics v_count=row_count;

  update market.ingestion_runs
  set status='published',reviewed_by=v_user,review_reason=left(coalesce(p_review_reason,'Approved'),1000),
      reviewed_at=now(),published_at=now(),
      market_date=(select max(market_date) from market.price_candidates where ingestion_run_id=v_run.id)
  where id=v_run.id;

  insert into audit.events(actor_id,actor_type,action,entity_type,entity_id,reason,after_state)
  values(v_user,'admin','market_prices.published','ingestion_run',v_run.id,p_review_reason,
    jsonb_build_object('publishedRows',v_count,'ohlcv',true));
  return jsonb_build_object('status','published','ingestionRunId',v_run.id,'publishedRows',v_count);
end $$;

create or replace view public.market_price_history with (security_invoker=false, security_barrier=true) as
select
  p.security_id,
  p.market_date,
  p.close_price,
  p.status,
  p.published_at,
  r.provider_id,
  p.open_price,
  p.high_price,
  p.low_price,
  p.volume
from market.prices p
join market.securities s on s.id=p.security_id
join market.ingestion_runs r on r.id=p.ingestion_run_id
where s.listing_status in ('active','suspended','delisted')
  and p.status in ('published','provisional');

revoke all on public.market_price_history from public;
grant select on public.market_price_history to anon,authenticated;

commit;
