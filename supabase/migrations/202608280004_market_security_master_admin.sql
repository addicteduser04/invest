begin;

create function public.upsert_market_security_master(p_rows jsonb)
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
       or (nullif(v_row->>'listedOn','') is not null and (v_row->>'listedOn') !~ '^\d{4}-\d{2}-\d{2}$') then
      raise exception 'INVALID_SECURITY_MASTER_ROW';
    end if;

    select id into v_id
      from market.securities
      where ticker=v_ticker
      order by case when listing_status='delisted' then 1 else 0 end,updated_at desc
      limit 1
      for update;

    if v_id is null then
      insert into market.securities(name,ticker,sector,listing_status,listed_on,is_synthetic)
      values(trim(v_row->>'name'),v_ticker,nullif(trim(coalesce(v_row->>'sector','')),''),v_status,
        nullif(v_row->>'listedOn','')::date,false)
      returning id into v_id;
    else
      update market.securities
        set name=trim(v_row->>'name'),sector=nullif(trim(coalesce(v_row->>'sector','')),''),
            listing_status=v_status,listed_on=coalesce(nullif(v_row->>'listedOn','')::date,listed_on),
            is_synthetic=false,updated_at=now()
        where id=v_id;
    end if;
    v_count:=v_count+1;
  end loop;

  insert into audit.events(actor_id,actor_type,action,entity_type,after_state)
  values(v_user,'admin','market_security_master.upserted','security_master',jsonb_build_object('rows',v_count));
  return jsonb_build_object('updatedRows',v_count);
end $$;

create function public.list_market_security_master_admin()
returns table(id uuid,ticker text,name text,sector text,listing_status text,listed_on date,is_synthetic boolean,updated_at timestamptz)
language sql stable security definer set search_path=''
as $$
  select s.id,s.ticker,s.name,s.sector,s.listing_status,s.listed_on,s.is_synthetic,s.updated_at
  from market.securities s
  where auth.uid() is not null and private.has_role('data_admin')
  order by s.ticker,s.updated_at desc
$$;

revoke all on function public.upsert_market_security_master(jsonb) from public;
revoke all on function public.list_market_security_master_admin() from public;
grant execute on function public.upsert_market_security_master(jsonb) to authenticated;
grant execute on function public.list_market_security_master_admin() to authenticated;

commit;
