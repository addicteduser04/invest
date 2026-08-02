begin;
create extension if not exists pgcrypto;
create schema if not exists private;
create schema if not exists market;
create schema if not exists analytics;
create schema if not exists audit;

create table public.profiles (id uuid primary key references auth.users(id) on delete cascade, display_name text, locale text not null default 'fr' check(locale in ('fr','ar')), created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.user_roles (user_id uuid not null references public.profiles(id) on delete cascade, role text not null check(role in ('investor','support_admin','data_admin')), primary key(user_id,role));
create table public.portfolios (id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(id), name text not null check(length(trim(name)) between 1 and 100), base_currency text not null default 'MAD' check(base_currency='MAD'), status text not null default 'active' check(status in ('active','archived')), created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table market.securities (id uuid primary key default gen_random_uuid(), name text not null, ticker text not null, sector text, listing_status text not null check(listing_status in ('pending','active','suspended','delisted')), listed_on date, delisted_on date, is_synthetic boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create unique index securities_active_ticker_uq on market.securities(ticker) where listing_status <> 'delisted';

create table public.transactions (id uuid primary key default gen_random_uuid(), portfolio_id uuid not null references public.portfolios(id), security_id uuid references market.securities(id), transaction_type text not null check(transaction_type in ('deposit','withdrawal','buy','sell','dividend','fee','tax','reversal')), trade_date date not null, settlement_date date not null, quantity numeric(24,8), unit_price numeric(20,6), gross_amount numeric(20,6), fees numeric(20,6) not null default 0 check(fees>=0), taxes numeric(20,6) not null default 0 check(taxes>=0), net_amount numeric(20,6) not null, version integer not null default 1 check(version>0), reverses_transaction_id uuid references public.transactions(id), idempotency_key text not null, note text, created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(), unique(portfolio_id,idempotency_key), check((transaction_type in ('buy','sell') and security_id is not null and quantity>0 and unit_price>=0) or transaction_type not in ('buy','sell')));
create index transactions_portfolio_date_idx on public.transactions(portfolio_id,settlement_date,created_at);

create table private.cash_ledger_entries (id uuid primary key default gen_random_uuid(), portfolio_id uuid not null references public.portfolios(id), transaction_id uuid not null unique references public.transactions(id), amount numeric(20,6) not null, entry_date date not null, created_at timestamptz not null default now());
create table private.outbox (id uuid primary key default gen_random_uuid(), topic text not null, aggregate_id uuid not null, idempotency_key text not null unique, payload jsonb not null, available_at timestamptz not null default now(), processed_at timestamptz, attempts integer not null default 0);

create table market.ingestion_runs (id uuid primary key default gen_random_uuid(), provider_id text not null check(provider_id in ('synthetic','admin_csv','licensed_api','licensed_sftp')), market_date date, status text not null check(status in ('uploaded','previewed','quarantined','approved','rejected','published','failed')), source_hash text not null unique, original_object_path text not null, mapping jsonb not null, validation_report jsonb not null default '{}', proposed_by uuid not null references public.profiles(id), reviewed_by uuid references public.profiles(id), review_reason text, created_at timestamptz not null default now(), reviewed_at timestamptz, published_at timestamptz, check(reviewed_by is null or reviewed_by<>proposed_by));
create table market.price_candidates (id uuid primary key default gen_random_uuid(), ingestion_run_id uuid not null references market.ingestion_runs(id), security_id uuid references market.securities(id), ticker text not null, market_date date not null, open_price numeric(20,6), high_price numeric(20,6), low_price numeric(20,6), close_price numeric(20,6) not null check(close_price>0), volume numeric(24,6), row_number integer not null, unique(ingestion_run_id,ticker,market_date));
create table market.prices (id uuid primary key default gen_random_uuid(), security_id uuid not null references market.securities(id), market_date date not null, close_price numeric(20,6) not null check(close_price>0), status text not null check(status in ('published','provisional','superseded')), ingestion_run_id uuid not null references market.ingestion_runs(id), published_at timestamptz not null default now());
create unique index one_current_price_per_day_uq on market.prices(security_id,market_date) where status in ('published','provisional');
create index prices_security_date_idx on market.prices(security_id,market_date desc);

create table analytics.portfolio_snapshots (id uuid primary key default gen_random_uuid(), portfolio_id uuid not null references public.portfolios(id), valuation_date date not null, rule_version text not null, snapshot_version integer not null check(snapshot_version>0), cash_value numeric(20,6) not null, securities_value numeric(20,6) not null, total_value numeric(20,6) not null, unrealized_gain numeric(20,6) not null, status text not null check(status in ('current','provisional','superseded','failed')), calculated_at timestamptz not null default now(), unique(portfolio_id,valuation_date,snapshot_version));
create unique index one_current_snapshot_uq on analytics.portfolio_snapshots(portfolio_id,valuation_date) where status in ('current','provisional');

create table audit.events (id uuid primary key default gen_random_uuid(), actor_id uuid, actor_type text not null check(actor_type in ('user','admin','service','system')), action text not null, entity_type text not null, entity_id uuid, request_id text, reason text, before_state jsonb, after_state jsonb, created_at timestamptz not null default now());
create index audit_entity_idx on audit.events(entity_type,entity_id,created_at desc);

create function private.has_role(requested_role text) returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.user_roles where user_id=auth.uid() and role=requested_role) $$;
revoke all on function private.has_role(text) from public;
grant execute on function private.has_role(text) to authenticated;

create function private.create_profile() returns trigger language plpgsql security definer set search_path='' as $$ begin insert into public.profiles(id,display_name,locale) values(new.id,coalesce(new.raw_user_meta_data->>'display_name',''),case when new.raw_user_meta_data->>'locale'='ar' then 'ar' else 'fr' end); insert into public.user_roles(user_id,role) values(new.id,'investor'); return new; end $$;
create trigger auth_user_profile after insert on auth.users for each row execute function private.create_profile();

alter table public.profiles enable row level security; alter table public.user_roles enable row level security; alter table public.portfolios enable row level security; alter table public.transactions enable row level security;
create policy profiles_self_select on public.profiles for select using(id=auth.uid()); create policy profiles_self_update on public.profiles for update using(id=auth.uid()) with check(id=auth.uid());
create policy roles_self_select on public.user_roles for select using(user_id=auth.uid());
create policy portfolios_owner_all on public.portfolios for all using(owner_id=auth.uid()) with check(owner_id=auth.uid());
create policy transactions_owner_select on public.transactions for select using(exists(select 1 from public.portfolios p where p.id=portfolio_id and p.owner_id=auth.uid()));
create policy transactions_owner_insert on public.transactions for insert with check(created_by=auth.uid() and exists(select 1 from public.portfolios p where p.id=portfolio_id and p.owner_id=auth.uid()));

revoke all on schema private,market,analytics,audit from anon,authenticated;
revoke all on all tables in schema private,market,analytics,audit from anon,authenticated;
grant usage on schema public to authenticated; grant select,update on public.profiles to authenticated; grant select on public.user_roles to authenticated; grant select,insert,update on public.portfolios to authenticated; grant select,insert on public.transactions to authenticated;

create function private.prevent_mutation() returns trigger language plpgsql as $$ begin raise exception 'append-only relation'; end $$;
create trigger audit_append_only before update or delete on audit.events for each row execute function private.prevent_mutation();
create trigger raw_run_no_delete before delete on market.ingestion_runs for each row execute function private.prevent_mutation();

insert into market.securities(name,ticker,sector,listing_status,is_synthetic) values ('Maroc Telecom — Donnée synthétique','SYN-IAM','Télécommunications','active',true),('Attijariwafa bank — Donnée synthétique','SYN-ATW','Banques','active',true);

create view public.security_directory with (security_invoker=false, security_barrier=true) as select id,name,ticker,sector,listing_status,is_synthetic from market.securities where listing_status in ('active','suspended');
revoke all on public.security_directory from anon; grant select on public.security_directory to authenticated;

create function public.record_transaction(p_portfolio_id uuid,p_type text,p_settlement_date date,p_idempotency_key text,p_amount numeric default null,p_security_id uuid default null,p_quantity numeric default null,p_unit_price numeric default null,p_fees numeric default 0,p_taxes numeric default 0) returns uuid language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid(); v_id uuid:=gen_random_uuid(); v_cash numeric(20,6); v_effect numeric(20,6); v_gross numeric(20,6);
begin
  if v_user is null or not exists(select 1 from public.portfolios where id=p_portfolio_id and owner_id=v_user and status='active') then raise exception 'forbidden'; end if;
  if p_type not in ('deposit','buy') then raise exception 'unsupported transaction type'; end if;
  if p_fees<0 or p_taxes<0 then raise exception 'fees and taxes must be non-negative'; end if;
  select coalesce(sum(amount),0) into v_cash from private.cash_ledger_entries where portfolio_id=p_portfolio_id;
  if p_type='deposit' then if p_amount is null or p_amount<=0 then raise exception 'deposit must be positive'; end if; v_effect:=p_amount; v_gross:=p_amount;
  else if p_security_id is null or p_quantity is null or p_quantity<=0 or p_unit_price is null or p_unit_price<0 then raise exception 'invalid purchase'; end if; if not exists(select 1 from market.securities where id=p_security_id and listing_status='active') then raise exception 'security unavailable'; end if; v_gross:=p_quantity*p_unit_price; v_effect:=-(v_gross+p_fees+p_taxes); if v_cash+v_effect<0 then raise exception 'insufficient cash'; end if; end if;
  insert into public.transactions(id,portfolio_id,security_id,transaction_type,trade_date,settlement_date,quantity,unit_price,gross_amount,fees,taxes,net_amount,idempotency_key,created_by) values(v_id,p_portfolio_id,p_security_id,p_type,p_settlement_date,p_settlement_date,p_quantity,p_unit_price,v_gross,p_fees,p_taxes,v_effect,p_idempotency_key,v_user);
  insert into private.cash_ledger_entries(portfolio_id,transaction_id,amount,entry_date) values(p_portfolio_id,v_id,v_effect,p_settlement_date);
  insert into private.outbox(topic,aggregate_id,idempotency_key,payload) values('portfolio.recalculate',p_portfolio_id,'recalculate:'||p_idempotency_key,jsonb_build_object('portfolioId',p_portfolio_id,'transactionId',v_id));
  insert into audit.events(actor_id,actor_type,action,entity_type,entity_id,after_state) values(v_user,'user','transaction.created','transaction',v_id,jsonb_build_object('type',p_type,'effect',v_effect)); return v_id;
exception when unique_violation then select id into v_id from public.transactions where portfolio_id=p_portfolio_id and idempotency_key=p_idempotency_key; return v_id;
end $$;
revoke all on function public.record_transaction(uuid,text,date,text,numeric,uuid,numeric,numeric,numeric,numeric) from public;
grant execute on function public.record_transaction(uuid,text,date,text,numeric,uuid,numeric,numeric,numeric,numeric) to authenticated;
commit;
