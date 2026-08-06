begin;
create function public.replace_transaction_import(
  p_supersedes_import_id uuid, p_portfolio_id uuid, p_filename text, p_file_hash text,
  p_file_size bigint, p_content_type text, p_content text, p_mapping jsonb,
  p_mapping_version integer, p_preview_totals jsonb, p_rows jsonb
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid(); v_old public.transaction_imports%rowtype; v_new uuid;
begin
  if v_user is null then raise exception using errcode='P0001',message='UNAUTHENTICATED'; end if;
  select * into v_old from public.transaction_imports where id=p_supersedes_import_id for update;
  if not found or v_old.owner_id<>v_user or v_old.portfolio_id<>p_portfolio_id then raise exception using errcode='P0001',message='FORBIDDEN_PORTFOLIO'; end if;
  if v_old.status='confirmed' then raise exception using errcode='P0001',message='CONFIRMED_IMPORT_IMMUTABLE'; end if;
  if v_old.status='superseded' then raise exception using errcode='P0001',message='IMPORT_NOT_CONFIRMABLE'; end if;
  update public.transaction_imports set status='superseded' where id=p_supersedes_import_id;
  v_new:=public.create_transaction_import(p_portfolio_id,p_filename,p_file_hash,p_file_size,p_content_type,p_content,p_mapping,p_mapping_version,p_preview_totals,p_rows);
  update public.transaction_imports set supersedes_import_id=p_supersedes_import_id where id=v_new;
  insert into audit.events(actor_id,actor_type,action,entity_type,entity_id,after_state) values(v_user,'user','transaction_import.replaced','transaction_import',v_new,jsonb_build_object('supersedesImportId',p_supersedes_import_id));
  return v_new;
end $$;
revoke all on function public.replace_transaction_import(uuid,uuid,text,text,bigint,text,text,jsonb,integer,jsonb,jsonb) from public;
grant execute on function public.replace_transaction_import(uuid,uuid,text,text,bigint,text,text,jsonb,integer,jsonb,jsonb) to authenticated;
commit;
