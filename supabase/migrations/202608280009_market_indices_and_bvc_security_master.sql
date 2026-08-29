begin;

alter table market.securities
  add column if not exists isin text,
  add column if not exists issuer_name text,
  add column if not exists instrument_type text,
  add column if not exists market_segment text,
  add column if not exists share_count numeric(24,0),
  add column if not exists source_provider_id text,
  add column if not exists source_identifier text,
  add column if not exists source_fetched_at timestamptz;

alter table market.securities
  add constraint market_securities_isin_format check(isin is null or isin ~ '^[A-Z]{2}[A-Z0-9]{10}$'),
  add constraint market_securities_share_count_nonnegative check(share_count is null or share_count>=0),
  add constraint market_securities_source_provider_known check(
    source_provider_id is null
    or source_provider_id in ('admin_csv','licensed_api','licensed_sftp','bvc_public_testing')
  );

create unique index market_securities_source_identifier_uq
  on market.securities(source_provider_id,source_identifier)
  where source_provider_id is not null and source_identifier is not null;

create table market.indices (
  id uuid primary key default gen_random_uuid(),
  source_provider_id text not null check(source_provider_id in ('licensed_api','licensed_sftp','bvc_public_testing')),
  source_code text not null check(source_code ~ '^[A-Z0-9._-]{1,30}$'),
  name text not null check(length(name) between 1 and 200),
  family text,
  currency text,
  status text not null default 'active' check(status in ('active','suspended','retired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(source_provider_id,source_code)
);

create table market.index_observations (
  id uuid primary key default gen_random_uuid(),
  index_id uuid not null references market.indices(id),
  market_date date not null,
  close_value numeric(20,6) not null check(close_value>0),
  high_value numeric(20,6),
  low_value numeric(20,6),
  change_percent numeric(20,10),
  change_ytd numeric(20,10),
  volume numeric(24,6),
  transaction_count integer check(transaction_count is null or transaction_count>=0),
  source_provider_id text not null check(source_provider_id in ('licensed_api','licensed_sftp','bvc_public_testing')),
  source_timestamp bigint,
  status text not null default 'previewed' check(status in ('previewed','published','provisional','superseded')),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  published_at timestamptz,
  check(high_value is null or high_value>=close_value),
  check(low_value is null or low_value<=close_value),
  check(high_value is null or low_value is null or high_value>=low_value),
  unique(index_id,market_date,source_provider_id,status)
);

create index market_index_observations_lookup_idx
  on market.index_observations(index_id,market_date desc)
  where status in ('published','provisional');

alter table market.indices enable row level security;
alter table market.index_observations enable row level security;

create or replace function public.upsert_market_security_master(p_rows jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  v_user uuid:=auth.uid();
  v_row jsonb;
  v_id uuid;
  v_count integer:=0;
  v_ticker text;
  v_status text;
begin
  if v_user is null or not private.has_role('data_admin') then raise exception 'FORBIDDEN'; end if;
  if p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)=0 or jsonb_array_length(p_rows)>500 then
    raise exception 'INVALID_FILE';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_ticker:=upper(trim(coalesce(v_row->>'ticker','')));
    v_status:=lower(trim(coalesce(v_row->>'listingStatus','active')));
    if v_ticker !~ '^[A-Z0-9._-]{1,20}$'
       or length(trim(coalesce(v_row->>'name',''))) not between 1 and 200
       or length(coalesce(v_row->>'sector',''))>120
       or v_status not in ('pending','active','suspended','delisted')
       or (nullif(v_row->>'listedOn','') is not null and (v_row->>'listedOn') !~ '^\d{4}-\d{2}-\d{2}$')
       or (nullif(v_row->>'isin','') is not null and upper(v_row->>'isin') !~ '^[A-Z]{2}[A-Z0-9]{10}$')
       or (nullif(v_row->>'shareCount','') is not null and (v_row->>'shareCount') !~ '^\d+$') then
      raise exception 'INVALID_SECURITY_MASTER_ROW';
    end if;

    select id into v_id
      from market.securities
      where ticker=v_ticker
      order by case when listing_status='delisted' then 1 else 0 end,updated_at desc
      limit 1
      for update;

    if v_id is null then
      insert into market.securities(
        name,ticker,sector,listing_status,listed_on,is_synthetic,isin,issuer_name,
        instrument_type,market_segment,share_count,source_provider_id,source_identifier,source_fetched_at
      )
      values(
        trim(v_row->>'name'),v_ticker,nullif(trim(coalesce(v_row->>'sector','')),''),v_status,
        nullif(v_row->>'listedOn','')::date,false,nullif(upper(trim(coalesce(v_row->>'isin',''))),''),
        nullif(trim(coalesce(v_row->>'issuerName','')),''),nullif(trim(coalesce(v_row->>'instrumentType','')),''),
        nullif(trim(coalesce(v_row->>'marketSegment','')),''),nullif(v_row->>'shareCount','')::numeric,
        case when nullif(v_row->>'sourceId','') is not null then 'bvc_public_testing' else null end,
        nullif(trim(coalesce(v_row->>'sourceId','')),''),case when nullif(v_row->>'sourceId','') is not null then now() else null end
      )
      returning id into v_id;
    else
      update market.securities
        set name=trim(v_row->>'name'),sector=nullif(trim(coalesce(v_row->>'sector','')),''),
            listing_status=v_status,listed_on=coalesce(nullif(v_row->>'listedOn','')::date,listed_on),
            is_synthetic=false,isin=coalesce(nullif(upper(trim(coalesce(v_row->>'isin',''))),''),isin),
            issuer_name=coalesce(nullif(trim(coalesce(v_row->>'issuerName','')),''),issuer_name),
            instrument_type=coalesce(nullif(trim(coalesce(v_row->>'instrumentType','')),''),instrument_type),
            market_segment=coalesce(nullif(trim(coalesce(v_row->>'marketSegment','')),''),market_segment),
            share_count=coalesce(nullif(v_row->>'shareCount','')::numeric,share_count),
            source_provider_id=case when nullif(v_row->>'sourceId','') is not null then 'bvc_public_testing' else source_provider_id end,
            source_identifier=coalesce(nullif(trim(coalesce(v_row->>'sourceId','')),''),source_identifier),
            source_fetched_at=case when nullif(v_row->>'sourceId','') is not null then now() else source_fetched_at end,
            updated_at=now()
        where id=v_id;
    end if;
    v_count:=v_count+1;
  end loop;

  insert into audit.events(actor_id,actor_type,action,entity_type,after_state)
  values(v_user,'admin','market_security_master.upserted','security_master',jsonb_build_object('rows',v_count,'bvcFields',true));
  return jsonb_build_object('updatedRows',v_count);
end $$;

create function public.upsert_market_indices(p_rows jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  v_user uuid:=auth.uid();
  v_row jsonb;
  v_count integer:=0;
  v_code text;
begin
  if v_user is null or not private.has_role('data_admin') then raise exception 'FORBIDDEN'; end if;
  if p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)=0 or jsonb_array_length(p_rows)>100 then
    raise exception 'INVALID_INDEX_FILE';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_code:=upper(trim(coalesce(v_row->>'code','')));
    if v_code !~ '^[A-Z0-9._-]{1,30}$' then raise exception 'INVALID_INDEX_ROW'; end if;
    insert into market.indices(source_provider_id,source_code,name,family,currency,status)
    values(
      'bvc_public_testing',v_code,
      left(coalesce(nullif(trim(v_row#>>'{name,en}'),''),nullif(trim(v_row#>>'{name,fr}'),''),v_code),200),
      left(coalesce(nullif(trim(v_row#>>'{family,en}'),''),nullif(trim(v_row#>>'{family,fr}'),''),''),120),
      null,'active'
    )
    on conflict(source_provider_id,source_code) do update
      set name=excluded.name,family=nullif(excluded.family,''),updated_at=now();
    v_count:=v_count+1;
  end loop;

  insert into audit.events(actor_id,actor_type,action,entity_type,after_state)
  values(v_user,'admin','market_indices.upserted','market_index',jsonb_build_object('rows',v_count));
  return jsonb_build_object('updatedRows',v_count);
end $$;

create function public.upsert_market_index_observations(p_rows jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  v_user uuid:=auth.uid();
  v_row jsonb;
  v_index uuid;
  v_count integer:=0;
  v_code text;
begin
  if v_user is null or not private.has_role('data_admin') then raise exception 'FORBIDDEN'; end if;
  if p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)=0 or jsonb_array_length(p_rows)>5000 then
    raise exception 'INVALID_INDEX_OBSERVATION_FILE';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_code:=upper(trim(coalesce(v_row->>'code','')));
    if v_code !~ '^[A-Z0-9._-]{1,30}$'
       or (v_row->>'marketDate') !~ '^\d{4}-\d{2}-\d{2}$'
       or nullif(v_row->>'close','') is null then
      raise exception 'INVALID_INDEX_OBSERVATION_ROW';
    end if;
    select id into v_index from market.indices where source_provider_id='bvc_public_testing' and source_code=v_code for update;
    if v_index is null then
      insert into market.indices(source_provider_id,source_code,name,status)
      values('bvc_public_testing',v_code,v_code,'active')
      returning id into v_index;
    end if;

    update market.index_observations
      set status='superseded'
      where index_id=v_index and market_date=(v_row->>'marketDate')::date
        and source_provider_id='bvc_public_testing' and status in ('published','provisional');

    insert into market.index_observations(
      index_id,market_date,close_value,high_value,low_value,change_percent,change_ytd,volume,
      transaction_count,source_provider_id,source_timestamp,status,created_by,published_at
    )
    values(
      v_index,(v_row->>'marketDate')::date,(v_row->>'close')::numeric,
      nullif(v_row->>'high','')::numeric,nullif(v_row->>'low','')::numeric,
      nullif(v_row->>'changePercent','')::numeric,nullif(v_row->>'changeYtd','')::numeric,
      nullif(v_row->>'volume','')::numeric,nullif(v_row->>'transactionCount','')::integer,
      'bvc_public_testing',nullif(v_row->>'sourceTimestamp','')::bigint,'published',v_user,now()
    )
    on conflict(index_id,market_date,source_provider_id,status) do update
      set close_value=excluded.close_value,high_value=excluded.high_value,low_value=excluded.low_value,
          change_percent=excluded.change_percent,change_ytd=excluded.change_ytd,volume=excluded.volume,
          transaction_count=excluded.transaction_count,source_timestamp=excluded.source_timestamp,
          created_by=excluded.created_by,published_at=now();
    v_count:=v_count+1;
  end loop;

  insert into audit.events(actor_id,actor_type,action,entity_type,after_state)
  values(v_user,'admin','market_index_observations.upserted','market_index',jsonb_build_object('rows',v_count));
  return jsonb_build_object('updatedRows',v_count);
end $$;

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

create view public.market_index_overview with (security_invoker=false, security_barrier=true) as
select
  i.id,
  i.source_code as code,
  i.name,
  i.family,
  i.currency,
  i.status,
  lo.market_date as latest_market_date,
  lo.close_value as latest_close_value,
  po.market_date as previous_market_date,
  po.close_value as previous_close_value,
  case
    when lo.close_value is null or po.close_value is null or po.close_value=0 then null
    else ((lo.close_value-po.close_value)/po.close_value)*100
  end as daily_change_percent,
  lo.source_provider_id as latest_provider_id
from market.indices i
left join lateral (
  select o.market_date,o.close_value,o.source_provider_id
  from market.index_observations o
  where o.index_id=i.id and o.status in ('published','provisional')
  order by o.market_date desc,o.published_at desc
  limit 1
) lo on true
left join lateral (
  select o.market_date,o.close_value
  from market.index_observations o
  where o.index_id=i.id and o.status in ('published','provisional')
    and (lo.market_date is null or o.market_date<lo.market_date)
  order by o.market_date desc,o.published_at desc
  limit 1
) po on true
where i.status in ('active','suspended');

create view public.market_index_history with (security_invoker=false, security_barrier=true) as
select
  i.id as index_id,
  i.source_code as code,
  o.market_date,
  o.close_value,
  o.high_value,
  o.low_value,
  o.change_percent,
  o.change_ytd,
  o.volume,
  o.transaction_count,
  o.source_provider_id as provider_id,
  o.status,
  o.published_at
from market.index_observations o
join market.indices i on i.id=o.index_id
where i.status in ('active','suspended')
  and o.status in ('published','provisional');

revoke all on public.market_security_overview,public.market_index_overview,public.market_index_history from public;
grant select on public.market_security_overview,public.market_index_overview,public.market_index_history to anon,authenticated;

revoke all on function public.upsert_market_security_master(jsonb) from public;
revoke all on function public.upsert_market_indices(jsonb) from public;
revoke all on function public.upsert_market_index_observations(jsonb) from public;
grant execute on function public.upsert_market_security_master(jsonb) to authenticated;
grant execute on function public.upsert_market_indices(jsonb) to authenticated;
grant execute on function public.upsert_market_index_observations(jsonb) to authenticated;

commit;
