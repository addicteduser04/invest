begin;

create table private.market_ingestion_blobs (
  ingestion_run_id uuid primary key references market.ingestion_runs(id),
  source_text text not null,
  source_hash text not null,
  created_at timestamptz not null default now()
);
revoke all on private.market_ingestion_blobs from public,anon,authenticated;

create function public.propose_market_price_import(
  p_source_hash text,
  p_original_filename text,
  p_mapping jsonb,
  p_validation_report jsonb,
  p_source_text text,
  p_candidates jsonb
) returns uuid
language plpgsql security definer set search_path=''
as $$
declare
  v_user uuid:=auth.uid();
  v_run uuid:=gen_random_uuid();
  v_row jsonb;
  v_security uuid;
begin
  if v_user is null or not private.has_role('data_admin') then raise exception 'FORBIDDEN'; end if;
  if p_source_hash !~ '^[0-9a-f]{64}$' or p_source_text is null or octet_length(p_source_text)>5000000
     or p_candidates is null or jsonb_typeof(p_candidates)<>'array' then raise exception 'INVALID_FILE'; end if;
  if exists(select 1 from market.ingestion_runs where source_hash=p_source_hash) then raise exception 'DUPLICATE_IMPORT'; end if;
  insert into market.ingestion_runs(id,provider_id,status,source_hash,original_object_path,mapping,validation_report,proposed_by)
  values(v_run,'admin_csv','previewed',p_source_hash,'db-private://market-ingestion/'||v_run||'/'||left(coalesce(p_original_filename,'upload.csv'),180),coalesce(p_mapping,'{}'::jsonb),coalesce(p_validation_report,'{}'::jsonb),v_user);
  insert into private.market_ingestion_blobs(ingestion_run_id,source_text,source_hash) values(v_run,p_source_text,p_source_hash);
  for v_row in select value from jsonb_array_elements(p_candidates) loop
    select id into v_security from market.securities where ticker=upper(v_row->>'ticker') and listing_status in ('active','suspended') limit 1;
    insert into market.price_candidates(ingestion_run_id,security_id,ticker,market_date,open_price,high_price,low_price,close_price,volume,row_number)
    values(v_run,v_security,upper(v_row->>'ticker'),(v_row->>'marketDate')::date,
      nullif(v_row->>'open','')::numeric,nullif(v_row->>'high','')::numeric,nullif(v_row->>'low','')::numeric,
      (v_row->>'close')::numeric,nullif(v_row->>'volume','')::numeric,(v_row->>'row')::integer);
  end loop;
  if exists(select 1 from market.price_candidates where ingestion_run_id=v_run and security_id is null) then
    update market.ingestion_runs set status='quarantined',validation_report=coalesce(validation_report,'{}'::jsonb)||jsonb_build_object('quarantineReason','UNKNOWN_SECURITY') where id=v_run;
  end if;
  return v_run;
end $$;

create function public.publish_market_price_import(p_ingestion_run_id uuid,p_review_reason text)
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
  insert into market.prices(security_id,market_date,close_price,status,ingestion_run_id)
  select security_id,market_date,close_price,'published',v_run.id from market.price_candidates where ingestion_run_id=v_run.id;
  get diagnostics v_count=row_count;
  update market.ingestion_runs set status='published',reviewed_by=v_user,review_reason=left(coalesce(p_review_reason,'Approved'),1000),reviewed_at=now(),published_at=now(),market_date=(select max(market_date) from market.price_candidates where ingestion_run_id=v_run.id) where id=v_run.id;
  insert into audit.events(actor_id,actor_type,action,entity_type,entity_id,reason,after_state)
  values(v_user,'admin','market_prices.published','ingestion_run',v_run.id,p_review_reason,jsonb_build_object('publishedRows',v_count));
  return jsonb_build_object('status','published','ingestionRunId',v_run.id,'publishedRows',v_count);
end $$;

create function public.list_market_price_imports()
returns table(id uuid,status text,source_hash text,original_object_path text,proposed_by uuid,reviewed_by uuid,created_at timestamptz,published_at timestamptz,candidate_count bigint)
language sql stable security definer set search_path=''
as $$
  select r.id,r.status,r.source_hash,r.original_object_path,r.proposed_by,r.reviewed_by,r.created_at,r.published_at,
    (select count(*) from market.price_candidates c where c.ingestion_run_id=r.id)
  from market.ingestion_runs r
  where auth.uid() is not null and private.has_role('data_admin')
  order by r.created_at desc limit 100
$$;

revoke all on function public.propose_market_price_import(text,text,jsonb,jsonb,text,jsonb) from public;
revoke all on function public.publish_market_price_import(uuid,text) from public;
revoke all on function public.list_market_price_imports() from public;
grant execute on function public.propose_market_price_import(text,text,jsonb,jsonb,text,jsonb) to authenticated;
grant execute on function public.publish_market_price_import(uuid,text) to authenticated;
grant execute on function public.list_market_price_imports() to authenticated;

commit;
