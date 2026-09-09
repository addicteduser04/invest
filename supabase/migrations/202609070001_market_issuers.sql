begin;

-- First-class issuer/company model. Until now the product implicitly assumed
-- security == company; the AMMC annual-reports sync proved the genuine issuer universe is much
-- larger (foreign cross-listings, unlisted Moroccan public entities, historical issuers) than
-- BVC-listed equities. An issuer may have zero, one, or (schema-wise) more than one security.
-- This migration is purely additive: no existing table is dropped, no existing column is
-- removed, and every current security/fundamentals/document row is backfilled to a genuine issuer
-- with no data loss (see docs/COMPANY_DOCUMENTS.md and the migration test suite).

create extension if not exists unaccent;

-- Shared normalization so the one-time backfill below, any future admin/CSV issuer-name
-- resolution, and the TS-side normalizeAmmcIssuerName (packages/market-data/src/ammc-reports.ts)
-- all agree closely enough to be usable as a lookup key. The AMMC-sync matching path itself
-- still runs entirely in TypeScript; this is a secondary, SQL-side convenience, not the
-- source of truth for that matching decision.
create function private.normalize_company_name(p_name text) returns text
language sql immutable as $$
  select trim(regexp_replace(
    regexp_replace(
      upper(public.unaccent(coalesce(p_name,''))),
      '\y(SA|S\.A\.?|SARL|GROUPE|GROUP|\(EX[^)]*\)|EX)\y', ' ', 'g'
    ),
    '[^A-Z0-9]+', ' ', 'g'
  ))
$$;

create function private.slugify(p_name text) returns text
language sql immutable as $$
  select trim(both '-' from regexp_replace(lower(public.unaccent(coalesce(p_name,''))), '[^a-z0-9]+', '-', 'g'))
$$;

create table market.issuers (
  id uuid primary key default gen_random_uuid(),
  name text not null check(length(trim(name))>0),
  normalized_name text not null,
  slug text not null unique,
  country_code text,
  country_name text,
  -- Text, not bigint: AMMC's own issuer ids (e.g. "2798") are already handled as text
  -- everywhere else in this codebase (market.company_document_aliases.source_issuer_id,
  -- market.unmatched_document_issuers.source_issuer_id) -- kept consistent rather than
  -- introducing a second representation of the same identifier.
  ammc_issuer_id text unique,
  issuer_type text check(issuer_type in (
    'listed_company','unlisted_company','public_entity','financial_institution',
    'foreign_issuer','historical_issuer','other'
  )),
  equity_listing_status text not null default 'unknown' check(equity_listing_status in (
    'listed_bvc','no_listed_bvc_equity','historical_or_delisted','unknown'
  )),
  website text,
  sector text,
  -- Mirrors market.securities.is_synthetic: a handful of local/dev-only fixture issuers
  -- (SYN-IAM, SYN-ATW) exist so every security can keep a non-null issuer_id rather than
  -- special-casing null issuer_id throughout the read layer. Every public-facing issuer
  -- view/list filters this out -- synthetic issuers must never reach genuine product surfaces.
  is_synthetic boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index market_issuers_normalized_name_idx on market.issuers(normalized_name);
create index market_issuers_equity_listing_status_idx on market.issuers(equity_listing_status);

alter table market.securities add column issuer_id uuid references market.issuers(id);

-- Backfill: one issuer per distinct genuine (non-synthetic) security identity, seeded from the
-- security's own name/sector -- no metadata invented. At migration time every genuine security
-- has a distinct, non-null issuer_name (verified before writing this migration), so this is a
-- straightforward 1:1 seed; the schema itself does not assume 1:1 going forward.
insert into market.issuers(name,normalized_name,slug,sector,issuer_type,equity_listing_status)
select distinct
  s.issuer_name,
  private.normalize_company_name(s.issuer_name),
  private.slugify(s.issuer_name),
  s.sector,
  'listed_company',
  'listed_bvc'
from market.securities s
where not s.is_synthetic and s.issuer_name is not null;

update market.securities s set issuer_id=i.id
from market.issuers i
where not s.is_synthetic and s.issuer_name=i.name and s.issuer_id is null;

-- Synthetic local/dev fixtures get their own clearly-marked synthetic issuer rows (see
-- is_synthetic comment above) so issuer_id can be NOT NULL for every security without a
-- special nullable case.
insert into market.issuers(name,normalized_name,slug,issuer_type,equity_listing_status,is_synthetic)
select distinct
  s.ticker,
  private.normalize_company_name(s.ticker),
  lower(s.ticker),
  'other',
  'unknown',
  true
from market.securities s
where s.is_synthetic;

update market.securities s set issuer_id=i.id
from market.issuers i
where s.is_synthetic and i.is_synthetic and lower(s.ticker)=i.slug and s.issuer_id is null;

-- Every security must now have an issuer -- enforced going forward (not just at backfill time).
alter table market.securities alter column issuer_id set not null;

alter table market.issuers enable row level security;
revoke all on market.issuers from anon,authenticated;

-- Public-safe issuer directory read model (listed and unlisted, genuine issuers only). The
-- optional linked security is surfaced here so a listed issuer's page can link straight to
-- Security Detail without a second query.
create view public.issuer_directory with (security_invoker=false, security_barrier=true) as
select
  i.id,
  i.name,
  i.slug,
  i.country_code,
  i.country_name,
  i.issuer_type,
  i.equity_listing_status,
  i.website,
  i.sector,
  s.id as security_id,
  s.ticker as security_ticker
from market.issuers i
left join market.securities s on s.issuer_id=i.id and not s.is_synthetic
where not i.is_synthetic;

revoke all on public.issuer_directory from public;
grant select on public.issuer_directory to anon,authenticated;

commit;
