begin;

revoke insert on public.transactions from authenticated;
grant select on public.transactions to authenticated;
grant execute on function public.record_transaction(uuid,text,date,text,numeric,uuid,numeric,numeric,numeric,numeric) to authenticated;

commit;
