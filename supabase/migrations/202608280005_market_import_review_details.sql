begin;

revoke all on function public.list_market_price_imports() from public,anon,authenticated;
drop function public.list_market_price_imports();

create function public.list_market_price_imports()
returns table(
  id uuid,
  status text,
  source_hash text,
  original_object_path text,
  proposed_by uuid,
  reviewed_by uuid,
  created_at timestamptz,
  published_at timestamptz,
  candidate_count bigint,
  validation_report jsonb
)
language sql stable security definer set search_path=''
as $$
  select r.id,r.status,r.source_hash,r.original_object_path,r.proposed_by,r.reviewed_by,r.created_at,r.published_at,
    (select count(*) from market.price_candidates c where c.ingestion_run_id=r.id),r.validation_report
  from market.ingestion_runs r
  where auth.uid() is not null and private.has_role('data_admin')
  order by r.created_at desc limit 100
$$;

revoke all on function public.list_market_price_imports() from public;
grant execute on function public.list_market_price_imports() to authenticated;

commit;
