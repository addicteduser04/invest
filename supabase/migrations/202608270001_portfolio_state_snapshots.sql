begin;

alter table public.transactions add column ledger_sequence bigint generated always as identity;
alter table public.transactions add constraint transactions_portfolio_sequence_uq unique(portfolio_id,ledger_sequence);
create index transactions_portfolio_replay_idx on public.transactions(portfolio_id,settlement_date,ledger_sequence);

alter table private.outbox add column locked_at timestamptz;
alter table private.outbox add column locked_by text;

create table private.portfolio_recalculation_runs (
  id uuid primary key default gen_random_uuid(),
  outbox_id uuid not null references private.outbox(id),
  portfolio_id uuid not null references public.portfolios(id),
  earliest_accounting_date date not null,
  boundary_sequence bigint not null,
  worker_id text not null,
  status text not null check(status in ('claimed','completed','failed')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  failure_code text
);
create unique index one_active_portfolio_recalculation_uq
  on private.portfolio_recalculation_runs(portfolio_id) where status='claimed';

create table analytics.portfolio_state_snapshots (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null references public.portfolios(id),
  recalculation_run_id uuid not null unique references private.portfolio_recalculation_runs(id),
  as_of timestamptz not null,
  earliest_rebuilt_date date not null,
  boundary_sequence bigint not null,
  last_transaction_id uuid references public.transactions(id),
  last_transaction_recorded_at timestamptz,
  transaction_count integer not null check(transaction_count>=0),
  cash_balance numeric(30,10) not null,
  realized_gain numeric(30,10) not null,
  rule_version text not null,
  status text not null check(status in ('current','superseded')),
  calculated_at timestamptz not null default now()
);
create unique index one_current_portfolio_state_uq
  on analytics.portfolio_state_snapshots(portfolio_id) where status='current';
create index portfolio_state_history_idx
  on analytics.portfolio_state_snapshots(portfolio_id,as_of desc,boundary_sequence desc);

create table analytics.portfolio_state_positions (
  snapshot_id uuid not null references analytics.portfolio_state_snapshots(id) on delete cascade,
  security_id uuid not null references market.securities(id),
  quantity numeric(30,10) not null check(quantity>=0),
  average_cost numeric(30,10) not null check(average_cost>=0),
  cost_basis numeric(30,10) not null check(cost_basis>=0),
  realized_gain numeric(30,10) not null,
  primary key(snapshot_id,security_id)
);

alter table analytics.portfolio_state_snapshots enable row level security;
alter table analytics.portfolio_state_positions enable row level security;
create policy portfolio_state_owner_select on analytics.portfolio_state_snapshots for select
  using(exists(select 1 from public.portfolios p where p.id=portfolio_id and p.owner_id=auth.uid()));
create policy portfolio_state_positions_owner_select on analytics.portfolio_state_positions for select
  using(exists(select 1 from analytics.portfolio_state_snapshots s join public.portfolios p on p.id=s.portfolio_id
    where s.id=snapshot_id and p.owner_id=auth.uid()));

revoke all on private.portfolio_recalculation_runs from public,anon,authenticated;
revoke all on analytics.portfolio_state_snapshots,analytics.portfolio_state_positions from public,anon,authenticated;
grant usage on schema analytics to authenticated;
grant select on analytics.portfolio_state_snapshots,analytics.portfolio_state_positions to authenticated;

create view public.portfolio_replay_transactions with (security_invoker=false,security_barrier=true) as
select t.id,t.portfolio_id,t.transaction_type,t.settlement_date,t.security_id,t.quantity,t.unit_price,
  t.gross_amount,t.fees,t.taxes,t.reverses_transaction_id,t.created_at,t.ledger_sequence,
  case when t.transaction_type='reversal' or rr.replacement_transaction_id=t.id
    then greatest(t.created_at,t.settlement_date::timestamptz)
    else t.settlement_date::timestamptz end as effective_at
from public.transactions t
left join private.transaction_reversal_requests rr
  on rr.reversal_transaction_id=t.id or rr.replacement_transaction_id=t.id
where exists(select 1 from public.portfolios p where p.id=t.portfolio_id and p.owner_id=auth.uid());
revoke all on public.portfolio_replay_transactions from public,anon;
grant select on public.portfolio_replay_transactions to authenticated;

create function private.claim_portfolio_recalculation(p_worker_id text)
returns table(claimed_run_id uuid,claimed_outbox_id uuid,claimed_portfolio_id uuid,claimed_earliest_accounting_date date,claimed_boundary_sequence bigint)
language plpgsql security definer set search_path=''
as $$
declare v_job private.outbox%rowtype; v_run uuid; v_earliest date; v_boundary bigint;
begin
  if p_worker_id is null or length(trim(p_worker_id)) not between 1 and 200 then raise exception 'INVALID_WORKER_ID'; end if;
  update private.portfolio_recalculation_runs
    set status='failed',completed_at=now(),failure_code='WORKER_LEASE_EXPIRED'
    where status='claimed' and started_at<now()-interval '5 minutes';
  update private.outbox o set locked_at=null,locked_by=null
    where o.processed_at is null and exists(
      select 1 from private.portfolio_recalculation_runs r
      where r.outbox_id=o.id and r.status='failed' and r.failure_code='WORKER_LEASE_EXPIRED');
  select o.* into v_job from private.outbox o join public.portfolios p on p.id=o.aggregate_id
   where o.topic='portfolio.recalculate' and o.processed_at is null and o.available_at<=now()
     and (o.locked_at is null or o.locked_at<now()-interval '5 minutes')
     and not exists(select 1 from private.portfolio_recalculation_runs r where r.portfolio_id=o.aggregate_id and r.status='claimed')
   order by o.available_at,o.id for update of o,p skip locked limit 1;
  if not found then return; end if;
  select coalesce((v_job.payload->>'earliestAccountingDate')::date,
    (select settlement_date from public.transactions where id=(v_job.payload->>'transactionId')::uuid),
    (select min(settlement_date) from public.transactions where portfolio_id=v_job.aggregate_id),current_date)
    into v_earliest;
  select coalesce(max(t.ledger_sequence),0) into v_boundary from public.transactions t where t.portfolio_id=v_job.aggregate_id;
  update private.outbox set locked_at=now(),locked_by=p_worker_id,attempts=attempts+1 where id=v_job.id;
  insert into private.portfolio_recalculation_runs(outbox_id,portfolio_id,earliest_accounting_date,boundary_sequence,worker_id,status)
    values(v_job.id,v_job.aggregate_id,v_earliest,v_boundary,p_worker_id,'claimed') returning id into v_run;
  return query select v_run,v_job.id,v_job.aggregate_id,v_earliest,v_boundary;
end $$;

create function private.commit_portfolio_recalculation(p_run_id uuid,p_state jsonb,p_rule_version text)
returns uuid language plpgsql security definer set search_path=''
as $$
declare v_run private.portfolio_recalculation_runs%rowtype; v_snapshot uuid:=gen_random_uuid(); v_position jsonb; v_latest bigint;
begin
  select * into v_run from private.portfolio_recalculation_runs where id=p_run_id for update;
  if not found or v_run.status<>'claimed' then raise exception 'RECALCULATION_NOT_CLAIMED'; end if;
  perform 1 from public.portfolios where id=v_run.portfolio_id for update;
  select coalesce(max(boundary_sequence),-1) into v_latest from analytics.portfolio_state_snapshots
    where portfolio_id=v_run.portfolio_id and status='current';
  if v_latest>v_run.boundary_sequence then raise exception 'STALE_RECALCULATION'; end if;
  if jsonb_typeof(p_state->'positions')<>'array' or p_rule_version is null then raise exception 'INVALID_PORTFOLIO_STATE'; end if;
  update analytics.portfolio_state_snapshots set status='superseded'
    where portfolio_id=v_run.portfolio_id and status='current';
  insert into analytics.portfolio_state_snapshots(id,portfolio_id,recalculation_run_id,as_of,earliest_rebuilt_date,
    boundary_sequence,last_transaction_id,last_transaction_recorded_at,transaction_count,cash_balance,realized_gain,rule_version,status)
  values(v_snapshot,v_run.portfolio_id,v_run.id,now(),v_run.earliest_accounting_date,v_run.boundary_sequence,
    nullif(p_state->>'lastTransactionId','')::uuid,nullif(p_state->>'lastTransactionRecordedAt','')::timestamptz,
    (p_state->>'transactionCount')::integer,(p_state->>'cash')::numeric,(p_state->>'realizedGain')::numeric,p_rule_version,'current');
  for v_position in select value from jsonb_array_elements(p_state->'positions') loop
    insert into analytics.portfolio_state_positions(snapshot_id,security_id,quantity,average_cost,cost_basis,realized_gain)
    values(v_snapshot,(v_position->>'securityId')::uuid,(v_position->>'quantity')::numeric,
      (v_position->>'averageCost')::numeric,(v_position->>'costBasis')::numeric,(v_position->>'realizedGain')::numeric);
  end loop;
  update private.portfolio_recalculation_runs set status='completed',completed_at=now() where id=v_run.id;
  update private.outbox set processed_at=now(),locked_at=null,locked_by=null where id=v_run.outbox_id;
  return v_snapshot;
end $$;

create function private.fail_portfolio_recalculation(p_run_id uuid,p_failure_code text)
returns void language plpgsql security definer set search_path=''
as $$
declare v_outbox uuid;
begin
  update private.portfolio_recalculation_runs set status='failed',completed_at=now(),failure_code=left(coalesce(p_failure_code,'INTERNAL_FAILURE'),200)
    where id=p_run_id and status='claimed' returning outbox_id into v_outbox;
  if v_outbox is not null then update private.outbox set locked_at=null,locked_by=null,available_at=now()+interval '30 seconds' where id=v_outbox; end if;
end $$;

revoke all on function private.claim_portfolio_recalculation(text) from public;
revoke all on function private.commit_portfolio_recalculation(uuid,jsonb,text) from public;
revoke all on function private.fail_portfolio_recalculation(uuid,text) from public;
grant execute on function private.claim_portfolio_recalculation(text) to service_role;
grant execute on function private.commit_portfolio_recalculation(uuid,jsonb,text) to service_role;
grant execute on function private.fail_portfolio_recalculation(uuid,text) to service_role;
grant usage on schema private,analytics,market to service_role;
grant select on public.transactions,market.securities to service_role;

commit;
