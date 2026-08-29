begin;

-- MVP language support: keep existing rows intact and add English without editing historical migrations.
alter table public.profiles drop constraint if exists profiles_locale_check;
alter table public.profiles
  add constraint profiles_locale_check check(locale in ('en','fr','ar'));

create or replace function private.create_profile() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  insert into public.profiles(id,display_name,locale)
  values(
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name',''),
    case
      when new.raw_user_meta_data->>'locale' in ('en','fr','ar') then new.raw_user_meta_data->>'locale'
      else 'fr'
    end
  );
  insert into public.user_roles(user_id,role) values(new.id,'investor');
  return new;
end $$;

-- SaifInvest tracks existing portfolios and clearly separated simulations; it is not a broker.
alter table public.portfolios
  add column tracking_mode text not null default 'real_tracking'
  check(tracking_mode in ('real_tracking','virtual'));

-- Public-safe market read models. Only published/provisional normalized prices are exposed;
-- raw ingestion data and administrative metadata stay private.
create view public.market_security_overview with (security_invoker=false, security_barrier=true) as
select
  s.id,
  s.name,
  s.ticker,
  s.sector,
  s.listing_status,
  s.listed_on,
  s.is_synthetic,
  lp.market_date as latest_market_date,
  lp.close_price as latest_close_price,
  pp.market_date as previous_market_date,
  pp.close_price as previous_close_price,
  case
    when lp.close_price is null or pp.close_price is null or pp.close_price=0 then null
    else ((lp.close_price-pp.close_price)/pp.close_price)*100
  end as daily_change_percent,
  case when lp.status='provisional' then true else false end as latest_price_provisional
from market.securities s
left join lateral (
  select p.market_date,p.close_price,p.status
  from market.prices p
  where p.security_id=s.id and p.status in ('published','provisional')
  order by p.market_date desc,p.published_at desc
  limit 1
) lp on true
left join lateral (
  select p.market_date,p.close_price
  from market.prices p
  where p.security_id=s.id and p.status in ('published','provisional')
    and (lp.market_date is null or p.market_date<lp.market_date)
  order by p.market_date desc,p.published_at desc
  limit 1
) pp on true
where s.listing_status in ('active','suspended');

create view public.market_price_history with (security_invoker=false, security_barrier=true) as
select
  p.security_id,
  p.market_date,
  p.close_price,
  p.status,
  p.published_at
from market.prices p
join market.securities s on s.id=p.security_id
where s.listing_status in ('active','suspended','delisted')
  and p.status in ('published','provisional');

revoke all on public.market_security_overview,public.market_price_history from public;
grant select on public.market_security_overview,public.market_price_history to anon,authenticated;

-- Replace the transaction command so sellable holdings reflect economic reversals.
-- Reversed buys/sells are excluded from the effective holding balance; replacement rows remain normal ledger rows.
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
      select coalesce(sum(case
        when t.transaction_type='buy' then t.quantity
        when t.transaction_type='sell' then -t.quantity
        else 0 end),0)
      into v_quantity
      from public.transactions t
      where t.portfolio_id=p_portfolio_id
        and t.security_id=p_security_id
        and t.transaction_type in ('buy','sell')
        and not exists(
          select 1 from public.transactions r
          where r.reverses_transaction_id=t.id and r.transaction_type='reversal'
        );
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
      jsonb_build_object('portfolioId',p_portfolio_id,'transactionId',v_id,
        'earliestAccountingDate',p_settlement_date));
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
