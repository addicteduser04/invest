begin;

create table private.transaction_reversal_requests (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null references public.portfolios(id),
  original_transaction_id uuid not null references public.transactions(id),
  reversal_transaction_id uuid not null unique references public.transactions(id),
  replacement_transaction_id uuid unique references public.transactions(id),
  actor_id uuid not null references public.profiles(id),
  reason text not null check(length(trim(reason)) between 8 and 1000),
  status text not null check(status in ('completed')),
  idempotency_reference text not null,
  source_import_id uuid references public.transaction_imports(id),
  earliest_accounting_date date not null,
  outbox_id uuid not null unique references private.outbox(id),
  requested_at timestamptz not null default now(),
  completed_at timestamptz not null,
  unique(portfolio_id, idempotency_reference),
  unique(original_transaction_id)
);

revoke all on private.transaction_reversal_requests from public, anon, authenticated;

create function public.reverse_transaction(
  p_portfolio_id uuid,
  p_original_transaction_id uuid,
  p_reason text,
  p_idempotency_reference text,
  p_replacement jsonb default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_original public.transactions%rowtype;
  v_existing private.transaction_reversal_requests%rowtype;
  v_request_id uuid := gen_random_uuid();
  v_reversal_id uuid := gen_random_uuid();
  v_replacement_id uuid;
  v_outbox_id uuid;
  v_cash numeric(20,6);
  v_holdings numeric(24,8);
  v_source_import_id uuid;
  v_replacement_key text;
  v_replacement_date date;
begin
  if v_user is null then
    raise exception using errcode='P0001', message='UNAUTHENTICATED';
  end if;
  if p_idempotency_reference is null or length(p_idempotency_reference) not between 16 and 128 then
    raise exception using errcode='P0001', message='INVALID_REVERSAL_IDEMPOTENCY_REFERENCE';
  end if;
  if p_reason is null or length(trim(p_reason)) not between 8 and 1000 then
    raise exception using errcode='P0001', message='INVALID_REVERSAL_REASON';
  end if;

  perform 1 from public.portfolios
   where id=p_portfolio_id and owner_id=v_user and status='active'
   for update;
  if not found then
    raise exception using errcode='P0001', message='FORBIDDEN_PORTFOLIO';
  end if;

  select * into v_existing from private.transaction_reversal_requests
   where portfolio_id=p_portfolio_id and idempotency_reference=p_idempotency_reference;
  if found then
    if v_existing.original_transaction_id<>p_original_transaction_id then
      raise exception using errcode='P0001', message='DUPLICATE_REVERSAL_IDEMPOTENCY_REFERENCE';
    end if;
    return jsonb_build_object('status','completed','requestId',v_existing.id,
      'originalTransactionId',v_existing.original_transaction_id,
      'reversalTransactionId',v_existing.reversal_transaction_id,
      'replacementTransactionId',v_existing.replacement_transaction_id,
      'repeated',true);
  end if;

  select * into v_original from public.transactions
   where id=p_original_transaction_id and portfolio_id=p_portfolio_id
   for update;
  if not found then
    raise exception using errcode='P0001', message='TRANSACTION_NOT_FOUND';
  end if;
  if v_original.transaction_type='reversal' then
    raise exception using errcode='P0001', message='REVERSAL_OF_REVERSAL_PROHIBITED';
  end if;
  if exists(select 1 from private.transaction_reversal_requests where original_transaction_id=v_original.id) then
    raise exception using errcode='P0001', message='ALREADY_REVERSED';
  end if;

  select coalesce(sum(amount),0) into v_cash
    from private.cash_ledger_entries where portfolio_id=p_portfolio_id;
  if v_cash-v_original.net_amount < 0 then
    raise exception using errcode='P0001', message='REVERSAL_INSUFFICIENT_CASH';
  end if;
  if v_original.transaction_type='buy' then
    select coalesce(sum(case
      when t.transaction_type='buy' then t.quantity
      when t.transaction_type='sell' then -t.quantity
      when t.transaction_type='reversal' and o.transaction_type='buy' then -o.quantity
      when t.transaction_type='reversal' and o.transaction_type='sell' then o.quantity
      else 0 end),0)
      into v_holdings
      from public.transactions t
      left join public.transactions o on o.id=t.reverses_transaction_id
     where t.portfolio_id=p_portfolio_id and t.security_id=v_original.security_id;
    if v_holdings-v_original.quantity < 0 then
      raise exception using errcode='P0001', message='REVERSAL_INSUFFICIENT_HOLDINGS';
    end if;
  end if;

  select id into v_source_import_id from public.transaction_imports
   where p_original_transaction_id=any(transaction_ids) limit 1;

  insert into public.transactions(
    id,portfolio_id,security_id,transaction_type,trade_date,settlement_date,
    quantity,unit_price,gross_amount,fees,taxes,net_amount,version,
    reverses_transaction_id,idempotency_key,note,created_by
  ) values (
    v_reversal_id,p_portfolio_id,v_original.security_id,'reversal',v_original.trade_date,
    v_original.settlement_date,v_original.quantity,v_original.unit_price,v_original.gross_amount,
    v_original.fees,v_original.taxes,-v_original.net_amount,v_original.version+1,
    v_original.id,p_idempotency_reference,trim(p_reason),v_user
  );
  insert into private.cash_ledger_entries(portfolio_id,transaction_id,amount,entry_date)
    values(p_portfolio_id,v_reversal_id,-v_original.net_amount,v_original.settlement_date);

  if p_replacement is not null and p_replacement<>'null'::jsonb then
    if jsonb_typeof(p_replacement)<>'object' then
      raise exception using errcode='P0001', message='INVALID_REPLACEMENT';
    end if;
    v_replacement_key := p_idempotency_reference || ':replacement';
    if length(v_replacement_key)>128 then v_replacement_key:=encode(extensions.digest(convert_to(v_replacement_key,'UTF8'),'sha256'),'hex'); end if;
    begin
      v_replacement_date := (p_replacement->>'settlementDate')::date;
      v_replacement_id := public.record_transaction(
        p_portfolio_id,p_replacement->>'type',v_replacement_date,v_replacement_key,
        nullif(p_replacement->>'amount','')::numeric,nullif(p_replacement->>'securityId','')::uuid,
        nullif(p_replacement->>'quantity','')::numeric,nullif(p_replacement->>'unitPrice','')::numeric,
        coalesce(nullif(p_replacement->>'fees','')::numeric,0),coalesce(nullif(p_replacement->>'taxes','')::numeric,0));
    exception when others then
      raise exception using errcode='P0001', message=case
        when sqlerrm='insufficient cash' then 'REVERSAL_INSUFFICIENT_CASH'
        when sqlerrm='insufficient quantity' then 'REVERSAL_INSUFFICIENT_HOLDINGS'
        else 'INVALID_REPLACEMENT' end;
    end;
    delete from private.outbox where idempotency_key='recalculate:'||v_replacement_key;
  end if;

  insert into private.outbox(topic,aggregate_id,idempotency_key,payload)
  values('portfolio.recalculate',p_portfolio_id,'reversal:'||p_idempotency_reference,
    jsonb_build_object('portfolioId',p_portfolio_id,'requestId',v_request_id,
      'originalTransactionId',v_original.id,'reversalTransactionId',v_reversal_id,
      'replacementTransactionId',v_replacement_id,'earliestAccountingDate',
      least(v_original.settlement_date,coalesce(v_replacement_date,v_original.settlement_date))))
  returning id into v_outbox_id;

  insert into private.transaction_reversal_requests(
    id,portfolio_id,original_transaction_id,reversal_transaction_id,replacement_transaction_id,
    actor_id,reason,status,idempotency_reference,source_import_id,earliest_accounting_date,
    outbox_id,completed_at
  ) values (
    v_request_id,p_portfolio_id,v_original.id,v_reversal_id,v_replacement_id,v_user,trim(p_reason),
    'completed',p_idempotency_reference,v_source_import_id,
    least(v_original.settlement_date,coalesce(v_replacement_date,v_original.settlement_date)),
    v_outbox_id,now());

  insert into audit.events(actor_id,actor_type,action,entity_type,entity_id,request_id,reason,after_state)
  values(v_user,'user','transaction.reversed','transaction',v_original.id,p_idempotency_reference,
    trim(p_reason),jsonb_build_object('requestId',v_request_id,'reversalTransactionId',v_reversal_id,
      'replacementTransactionId',v_replacement_id,'sourceImportId',v_source_import_id));

  return jsonb_build_object('status','completed','requestId',v_request_id,
    'originalTransactionId',v_original.id,'reversalTransactionId',v_reversal_id,
    'replacementTransactionId',v_replacement_id,'repeated',false);
exception
  when unique_violation then
    select * into v_existing from private.transaction_reversal_requests
     where portfolio_id=p_portfolio_id and idempotency_reference=p_idempotency_reference;
    if found and v_existing.original_transaction_id=p_original_transaction_id then
      return jsonb_build_object('status','completed','requestId',v_existing.id,
        'originalTransactionId',v_existing.original_transaction_id,
        'reversalTransactionId',v_existing.reversal_transaction_id,
        'replacementTransactionId',v_existing.replacement_transaction_id,'repeated',true);
    end if;
    raise exception using errcode='P0001', message='REVERSAL_CONFLICT';
end
$$;

revoke all on function public.reverse_transaction(uuid,uuid,text,text,jsonb) from public, anon;
grant execute on function public.reverse_transaction(uuid,uuid,text,text,jsonb) to authenticated;

commit;
