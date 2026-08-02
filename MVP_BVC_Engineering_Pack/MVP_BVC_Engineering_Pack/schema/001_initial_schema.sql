-- Engineering skeleton only. Review before production.
create extension if not exists pgcrypto;

create schema if not exists private;
create schema if not exists market;
create schema if not exists analytics;
create schema if not exists audit;

create table public.profiles (
  id uuid primary key,
  display_name text,
  locale text not null default 'fr' check (locale in ('fr', 'ar', 'en')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_roles (
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('investor', 'support_admin', 'data_admin')),
  primary key (user_id, role)
);

create table public.portfolios (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id),
  name text not null,
  base_currency text not null default 'MAD' check (base_currency = 'MAD'),
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table market.securities (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  ticker text not null,
  sector text,
  listing_status text not null check (listing_status in ('pending', 'active', 'suspended', 'delisted')),
  listed_on date,
  delisted_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index securities_active_ticker_uq
  on market.securities (ticker)
  where listing_status <> 'delisted';

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null references public.portfolios(id),
  security_id uuid references market.securities(id),
  transaction_type text not null check (transaction_type in ('deposit', 'withdrawal', 'buy', 'sell', 'dividend', 'fee', 'tax', 'reversal')),
  trade_date date not null,
  settlement_date date not null,
  quantity numeric(24,8),
  unit_price numeric(20,6),
  gross_amount numeric(20,6),
  fees numeric(20,6) not null default 0,
  taxes numeric(20,6) not null default 0,
  net_amount numeric(20,6) not null,
  currency text not null default 'MAD' check (currency = 'MAD'),
  version integer not null default 1 check (version > 0),
  reverses_transaction_id uuid references public.transactions(id),
  idempotency_key text not null,
  note text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (portfolio_id, idempotency_key)
);

create index transactions_portfolio_date_idx
  on public.transactions (portfolio_id, trade_date, created_at);

create table market.ingestion_runs (
  id uuid primary key default gen_random_uuid(),
  provider_id text not null,
  market_date date not null,
  status text not null,
  source_hash text,
  coverage_expected integer,
  coverage_received integer,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  error_summary text,
  unique (provider_id, market_date, source_hash)
);

create table market.raw_batches (
  id uuid primary key default gen_random_uuid(),
  ingestion_run_id uuid not null references market.ingestion_runs(id),
  payload jsonb not null,
  source_hash text not null,
  collected_at timestamptz not null default now(),
  unique (ingestion_run_id, source_hash)
);

create table market.prices (
  id uuid primary key default gen_random_uuid(),
  security_id uuid not null references market.securities(id),
  market_date date not null,
  close_price numeric(20,6) not null check (close_price > 0),
  currency text not null default 'MAD' check (currency = 'MAD'),
  status text not null check (status in ('candidate', 'published', 'provisional', 'superseded')),
  ingestion_run_id uuid not null references market.ingestion_runs(id),
  published_at timestamptz,
  unique (security_id, market_date, ingestion_run_id)
);

create unique index one_published_price_per_day_uq
  on market.prices (security_id, market_date)
  where status = 'published';

create index prices_security_date_idx
  on market.prices (security_id, market_date desc);

create table analytics.portfolio_snapshots (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null references public.portfolios(id),
  valuation_date date not null,
  rule_version text not null,
  snapshot_version integer not null,
  cash_value numeric(20,6) not null,
  securities_value numeric(20,6) not null,
  total_value numeric(20,6) not null,
  twr numeric(20,10),
  xirr numeric(20,10),
  status text not null check (status in ('current', 'provisional', 'superseded', 'failed')),
  calculated_at timestamptz not null default now(),
  unique (portfolio_id, valuation_date, snapshot_version)
);

create index portfolio_snapshots_latest_idx
  on analytics.portfolio_snapshots (portfolio_id, valuation_date desc, snapshot_version desc);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  kind text not null,
  payload jsonb not null,
  viewed_at timestamptz,
  acknowledged_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_user_open_idx
  on public.notifications (user_id, created_at desc)
  where acknowledged_at is null;

create table public.support_cases (
  id uuid primary key default gen_random_uuid(),
  case_number text not null unique,
  user_id uuid not null references public.profiles(id),
  portfolio_id uuid references public.portfolios(id),
  status text not null check (status in ('submitted', 'under_review', 'information_required', 'resolved', 'closed')),
  category text not null,
  description text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table audit.events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  actor_type text not null check (actor_type in ('user', 'admin', 'service', 'system')),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  request_id text,
  reason text,
  before_state jsonb,
  after_state jsonb,
  created_at timestamptz not null default now()
);

create index audit_entity_idx
  on audit.events (entity_type, entity_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.portfolios enable row level security;
alter table public.transactions enable row level security;
alter table public.notifications enable row level security;
alter table public.support_cases enable row level security;

-- Policies deliberately omitted from this skeleton. Implement and test the
-- complete ownership/role matrix before exposing these tables through an API.
