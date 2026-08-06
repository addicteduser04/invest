begin;

alter table public.transaction_imports drop constraint transaction_imports_owner_id_portfolio_id_file_hash_key;
create unique index transaction_imports_active_file_uq on public.transaction_imports(owner_id,portfolio_id,file_hash) where status<>'superseded';
create table public.transaction_import_attempts (
  id uuid primary key default gen_random_uuid(), import_id uuid not null references public.transaction_imports(id),
  owner_id uuid not null references public.profiles(id), attempted_at timestamptz not null default now(),
  outcome text not null check(outcome in ('succeeded','failed')), failure_code text,
  failed_row integer, retryable boolean not null default false, diagnostic jsonb not null default '{}'
);
alter table public.transaction_import_attempts enable row level security;
create policy transaction_import_attempts_owner_select on public.transaction_import_attempts for select using(owner_id=auth.uid());
revoke all on public.transaction_import_attempts from anon,authenticated;
grant select on public.transaction_import_attempts to authenticated;

create function private.import_failure_code(p_message text) returns text language sql immutable set search_path='' as $$
  select case
    when p_message='insufficient cash' then 'INSUFFICIENT_CASH'
    when p_message='insufficient quantity' then 'INSUFFICIENT_HOLDINGS'
    when p_message='security unavailable' then 'UNKNOWN_SECURITY'
    when p_message='forbidden' then 'FORBIDDEN_PORTFOLIO'
    when p_message='unsupported transaction type' then 'INVALID_TRANSACTION_TYPE'
    else 'IMPORT_VALIDATION_FAILED' end
$$;
revoke all on function private.import_failure_code(text) from public,anon,authenticated;

drop function public.confirm_transaction_import(uuid);
create function public.confirm_transaction_import(p_import_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid(); v_import public.transaction_imports%rowtype; v_rows jsonb; v_row jsonb;
  v_id uuid; v_ids uuid[]:='{}'; v_row_number integer; v_code text; v_attempt uuid;
begin
  if v_user is null then raise exception using errcode='P0001',message='UNAUTHENTICATED'; end if;
  select * into v_import from public.transaction_imports where id=p_import_id for update;
  if not found or v_import.owner_id<>v_user or not exists(select 1 from public.portfolios where id=v_import.portfolio_id and owner_id=v_user and status='active') then raise exception using errcode='P0001',message='FORBIDDEN_PORTFOLIO'; end if;
  if v_import.status='confirmed' then return jsonb_build_object('status','confirmed','transactionIds',v_import.transaction_ids,'repeated',true); end if;
  select preview_rows into v_rows from private.transaction_import_blobs where import_id=p_import_id;
  if v_import.status not in ('ready_for_confirmation','failed') or jsonb_array_length(v_rows)<>coalesce((v_import.preview_totals->>'valid')::integer,-1) then raise exception using errcode='P0001',message='IMPORT_NOT_CONFIRMABLE'; end if;
  update public.transaction_imports set status='confirming',failure_code=null where id=p_import_id;
  begin
    for v_row in select value from jsonb_array_elements(v_rows) loop
      v_row_number:=(v_row->>'row')::integer;
      v_id:=public.record_transaction(v_import.portfolio_id,v_row->>'type',(v_row->>'date')::date,v_row->>'externalReference',nullif(v_row->>'amount','')::numeric,nullif(v_row->>'securityId','')::uuid,nullif(v_row->>'quantity','')::numeric,nullif(v_row->>'unitPrice','')::numeric,coalesce(nullif(v_row->>'fees','')::numeric,0),coalesce(nullif(v_row->>'taxes','')::numeric,0));
      v_ids:=array_append(v_ids,v_id);
    end loop;
  exception when others then
    v_code:=private.import_failure_code(sqlerrm);
    insert into public.transaction_import_attempts(import_id,owner_id,outcome,failure_code,failed_row,retryable,diagnostic) values(p_import_id,v_user,'failed',v_code,v_row_number,v_code in ('INSUFFICIENT_CASH','INSUFFICIENT_HOLDINGS'),jsonb_build_object('phase','confirmation')) returning id into v_attempt;
    update public.transaction_imports set status='failed',failure_code=v_code,imported_row_count=null,transaction_ids='{}' where id=p_import_id;
    insert into audit.events(actor_id,actor_type,action,entity_type,entity_id,after_state) values(v_user,'user','transaction_import.confirmation_failed','transaction_import',p_import_id,jsonb_build_object('attemptId',v_attempt,'failureCode',v_code,'row',v_row_number));
    return jsonb_build_object('status','failed','attemptId',v_attempt,'failureCode',v_code,'failedRow',v_row_number,'retryable',v_code in ('INSUFFICIENT_CASH','INSUFFICIENT_HOLDINGS'));
  end;
  insert into public.transaction_import_attempts(import_id,owner_id,outcome) values(p_import_id,v_user,'succeeded') returning id into v_attempt;
  update public.transaction_imports set status='confirmed',confirmed_at=now(),imported_row_count=cardinality(v_ids),rejected_row_count=0,failure_code=null,transaction_ids=v_ids where id=p_import_id;
  insert into audit.events(actor_id,actor_type,action,entity_type,entity_id,after_state) values(v_user,'user','transaction_import.confirmed','transaction_import',p_import_id,jsonb_build_object('attemptId',v_attempt,'transactionIds',v_ids));
  return jsonb_build_object('status','confirmed','attemptId',v_attempt,'transactionIds',v_ids,'repeated',false);
end $$;
revoke all on function public.confirm_transaction_import(uuid) from public;
grant execute on function public.confirm_transaction_import(uuid) to authenticated;

create function public.supersede_transaction_import(p_import_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid(); v_import public.transaction_imports%rowtype;
begin
  if v_user is null then raise exception using errcode='P0001',message='UNAUTHENTICATED'; end if;
  select * into v_import from public.transaction_imports where id=p_import_id for update;
  if not found or v_import.owner_id<>v_user or not exists(select 1 from public.portfolios where id=v_import.portfolio_id and owner_id=v_user) then raise exception using errcode='P0001',message='FORBIDDEN_PORTFOLIO'; end if;
  if v_import.status='confirmed' then raise exception using errcode='P0001',message='CONFIRMED_IMPORT_IMMUTABLE'; end if;
  if v_import.status='superseded' then raise exception using errcode='P0001',message='IMPORT_NOT_CONFIRMABLE'; end if;
  update public.transaction_imports set status='superseded' where id=p_import_id;
  insert into audit.events(actor_id,actor_type,action,entity_type,entity_id,after_state) values(v_user,'user','transaction_import.superseded','transaction_import',p_import_id,jsonb_build_object('reason','replacement_requested'));
  return p_import_id;
end $$;
revoke all on function public.supersede_transaction_import(uuid) from public;
grant execute on function public.supersede_transaction_import(uuid) to authenticated;
commit;
