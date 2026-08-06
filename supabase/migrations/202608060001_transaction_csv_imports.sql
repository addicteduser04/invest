begin;

create table public.transaction_imports (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id),
  portfolio_id uuid not null references public.portfolios(id),
  original_filename text not null check(length(original_filename) between 1 and 255),
  file_hash text not null check(file_hash ~ '^[0-9a-f]{64}$'),
  file_size bigint not null check(file_size between 1 and 5000000),
  content_type text not null check(content_type in ('text/csv','application/csv','text/plain','application/vnd.ms-excel')),
  status text not null check(status in ('uploaded','mapping_configured','previewed','validation_failed','ready_for_confirmation','confirming','confirmed','failed','superseded')),
  mapping jsonb not null, mapping_version integer not null check(mapping_version > 0),
  previewed_at timestamptz, preview_totals jsonb,
  confirmed_at timestamptz, imported_row_count integer, rejected_row_count integer,
  failure_code text, transaction_ids uuid[] not null default '{}',
  supersedes_import_id uuid references public.transaction_imports(id),
  uploaded_at timestamptz not null default now(), created_at timestamptz not null default now(),
  unique(owner_id, portfolio_id, file_hash)
);
create table private.transaction_import_blobs (
  import_id uuid primary key references public.transaction_imports(id),
  original_content text not null, preview_rows jsonb not null check(jsonb_typeof(preview_rows)='array'),
  created_at timestamptz not null default now()
);
alter table public.transaction_imports enable row level security;
create policy transaction_imports_owner_select on public.transaction_imports for select using(owner_id=auth.uid());
revoke all on public.transaction_imports from anon, authenticated;
grant select on public.transaction_imports to authenticated;
revoke all on private.transaction_import_blobs from public, anon, authenticated;

create function public.create_transaction_import(
  p_portfolio_id uuid, p_filename text, p_file_hash text, p_file_size bigint,
  p_content_type text, p_content text, p_mapping jsonb, p_mapping_version integer,
  p_preview_totals jsonb, p_rows jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_user uuid:=auth.uid(); v_id uuid:=gen_random_uuid(); v_status text;
begin
  if v_user is null then raise exception using errcode='P0001', message='UNAUTHENTICATED'; end if;
  perform 1 from public.portfolios where id=p_portfolio_id and owner_id=v_user and status='active';
  if not found then raise exception using errcode='P0001', message='FORBIDDEN_PORTFOLIO'; end if;
  if p_file_size<1 or p_file_size>5000000 or octet_length(p_content)>5000000 then raise exception using errcode='P0001', message='FILE_TOO_LARGE'; end if;
  if encode(extensions.digest(convert_to(p_content,'UTF8'),'sha256'),'hex')<>p_file_hash then raise exception using errcode='P0001', message='INVALID_FILE'; end if;
  if exists(select 1 from public.transaction_imports where owner_id=v_user and portfolio_id=p_portfolio_id and file_hash=p_file_hash) then raise exception using errcode='P0001', message='DUPLICATE_IMPORT'; end if;
  v_status:=case when coalesce((p_preview_totals->>'invalid')::integer,1)=0 then 'ready_for_confirmation' else 'validation_failed' end;
  insert into public.transaction_imports(id,owner_id,portfolio_id,original_filename,file_hash,file_size,content_type,status,mapping,mapping_version,previewed_at,preview_totals,rejected_row_count)
  values(v_id,v_user,p_portfolio_id,p_filename,p_file_hash,p_file_size,p_content_type,v_status,p_mapping,p_mapping_version,now(),p_preview_totals,coalesce((p_preview_totals->>'invalid')::integer,0));
  insert into private.transaction_import_blobs(import_id,original_content,preview_rows) values(v_id,p_content,p_rows);
  insert into audit.events(actor_id,actor_type,action,entity_type,entity_id,after_state) values(v_user,'user','transaction_import.previewed','transaction_import',v_id,jsonb_build_object('hash',p_file_hash,'totals',p_preview_totals));
  return v_id;
exception when unique_violation then raise exception using errcode='P0001', message='DUPLICATE_IMPORT';
end $$;

create function public.confirm_transaction_import(p_import_id uuid)
returns uuid[] language plpgsql security definer set search_path = '' as $$
declare v_user uuid:=auth.uid(); v_import public.transaction_imports%rowtype; v_rows jsonb; v_row jsonb; v_id uuid; v_ids uuid[]:='{}';
begin
  if v_user is null then raise exception using errcode='P0001', message='UNAUTHENTICATED'; end if;
  select * into v_import from public.transaction_imports where id=p_import_id for update;
  if not found or v_import.owner_id<>v_user or not exists(select 1 from public.portfolios where id=v_import.portfolio_id and owner_id=v_user) then raise exception using errcode='P0001', message='FORBIDDEN_PORTFOLIO'; end if;
  if v_import.status='confirmed' then return v_import.transaction_ids; end if;
  select preview_rows into v_rows from private.transaction_import_blobs where import_id=p_import_id;
  if v_import.status<>'ready_for_confirmation' or jsonb_array_length(v_rows)<>coalesce((v_import.preview_totals->>'valid')::integer,-1) then raise exception using errcode='P0001', message='IMPORT_NOT_CONFIRMABLE'; end if;
  update public.transaction_imports set status='confirming' where id=p_import_id;
  for v_row in select value from jsonb_array_elements(v_rows) loop
    v_id:=public.record_transaction(v_import.portfolio_id,v_row->>'type',(v_row->>'date')::date,v_row->>'externalReference',nullif(v_row->>'amount','')::numeric,nullif(v_row->>'securityId','')::uuid,nullif(v_row->>'quantity','')::numeric,nullif(v_row->>'unitPrice','')::numeric,coalesce(nullif(v_row->>'fees','')::numeric,0),coalesce(nullif(v_row->>'taxes','')::numeric,0));
    v_ids:=array_append(v_ids,v_id);
  end loop;
  update public.transaction_imports set status='confirmed',confirmed_at=now(),imported_row_count=cardinality(v_ids),rejected_row_count=0,transaction_ids=v_ids where id=p_import_id;
  insert into audit.events(actor_id,actor_type,action,entity_type,entity_id,after_state) values(v_user,'user','transaction_import.confirmed','transaction_import',p_import_id,jsonb_build_object('transactionIds',v_ids));
  return v_ids;
end $$;

revoke all on function public.create_transaction_import(uuid,text,text,bigint,text,text,jsonb,integer,jsonb,jsonb) from public;
revoke all on function public.confirm_transaction_import(uuid) from public;
grant execute on function public.create_transaction_import(uuid,text,text,bigint,text,text,jsonb,integer,jsonb,jsonb) to authenticated;
grant execute on function public.confirm_transaction_import(uuid) to authenticated;
commit;
