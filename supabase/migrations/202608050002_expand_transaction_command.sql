begin;

revoke insert on public.transactions from authenticated;

create or replace function public.record_transaction(
  p_portfolio_id uuid,
  p_type text,
  p_settlement_date date,
  p_idempotency_key text,
  p_amount numeric default null,
  p_security_id uuid default null,
  p_quantity numeric default null,
  p_unit_price numeric default null,
  p_fees numeric default 0,
  p_taxes numeric default 0
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_id uuid := gen_random_uuid();
  v_cash numeric(20,6);
  v_effect numeric(20,6);
  v_gross numeric(20,6);
  v_quantity numeric(24,8);
begin
  if v_user is null or p_idempotency_key is null
     or length(p_idempotency_key) < 16 or length(p_idempotency_key) > 128 then
    raise exception 'forbidden or invalid idempotency key';
  end if;

  perform 1 from public.portfolios
   where id = p_portfolio_id and owner_id = v_user and status = 'active'
   for update;
  if not found then raise exception 'forbidden'; end if;

  if p_type not in ('deposit','withdrawal','buy','sell','dividend','fee','tax') then
    raise exception 'unsupported transaction type';
  end if;
  p_fees := coalesce(p_fees, 0);
  p_taxes := coalesce(p_taxes, 0);
  if p_fees < 0 or p_taxes < 0 then raise exception 'fees and taxes must be non-negative'; end if;

  select coalesce(sum(amount), 0) into v_cash
    from private.cash_ledger_entries where portfolio_id = p_portfolio_id;

  if p_type in ('deposit','withdrawal','fee','tax') then
    if p_amount is null or p_amount <= 0 then raise exception 'amount must be positive'; end if;
    v_gross := p_amount;
    v_effect := case when p_type = 'deposit' then p_amount else -p_amount end;
  elsif p_type = 'dividend' then
    if p_amount is null or p_amount <= 0 or p_taxes > p_amount then
      raise exception 'invalid dividend';
    end if;
    v_gross := p_amount;
    v_effect := p_amount - p_taxes;
  else
    if p_security_id is null or p_quantity is null or p_quantity <= 0
       or p_unit_price is null or p_unit_price < 0 then
      raise exception 'invalid security transaction';
    end if;
    if not exists (select 1 from market.securities where id = p_security_id and listing_status = 'active') then
      raise exception 'security unavailable';
    end if;
    v_gross := p_quantity * p_unit_price;
    if p_type = 'buy' then
      v_effect := -(v_gross + p_fees + p_taxes);
    else
      select coalesce(sum(case transaction_type when 'buy' then quantity when 'sell' then -quantity else 0 end),0)
        into v_quantity from public.transactions
       where portfolio_id = p_portfolio_id and security_id = p_security_id;
      if p_quantity > v_quantity then raise exception 'insufficient quantity'; end if;
      v_effect := v_gross - p_fees - p_taxes;
      if v_effect < 0 then raise exception 'sale costs exceed proceeds'; end if;
    end if;
  end if;

  if v_cash + v_effect < 0 then raise exception 'insufficient cash'; end if;

  insert into public.transactions(
    id,portfolio_id,security_id,transaction_type,trade_date,settlement_date,
    quantity,unit_price,gross_amount,fees,taxes,net_amount,idempotency_key,created_by
  ) values (
    v_id,p_portfolio_id,p_security_id,p_type,p_settlement_date,p_settlement_date,
    p_quantity,p_unit_price,v_gross,p_fees,p_taxes,v_effect,p_idempotency_key,v_user
  );
  insert into private.cash_ledger_entries(portfolio_id,transaction_id,amount,entry_date)
    values(p_portfolio_id,v_id,v_effect,p_settlement_date);
  insert into private.outbox(topic,aggregate_id,idempotency_key,payload)
    values('portfolio.recalculate',p_portfolio_id,'recalculate:'||p_idempotency_key,
      jsonb_build_object('portfolioId',p_portfolio_id,'transactionId',v_id));
  insert into audit.events(actor_id,actor_type,action,entity_type,entity_id,after_state)
    values(v_user,'user','transaction.created','transaction',v_id,
      jsonb_build_object('type',p_type,'effect',v_effect));
  return v_id;
exception when unique_violation then
  select id into v_id from public.transactions
   where portfolio_id=p_portfolio_id and idempotency_key=p_idempotency_key;
  return v_id;
end
$$;

revoke all on function public.record_transaction(uuid,text,date,text,numeric,uuid,numeric,numeric,numeric,numeric) from public;
grant execute on function public.record_transaction(uuid,text,date,text,numeric,uuid,numeric,numeric,numeric,numeric) to authenticated;

commit;
