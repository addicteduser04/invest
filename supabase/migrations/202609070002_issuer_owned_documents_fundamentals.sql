begin;

-- Moves document and fundamentals ownership from security_id to issuer_id (market.issuers,
-- added in 202609070001), matching actual-world shape: an annual report or a financial statement
-- belongs to the issuing company, not to a tradable instrument. Listed-security product surfaces
-- keep working unchanged -- public.security_fundamentals and public.security_company_documents
-- are rebuilt as security -> issuer -> data joins exposing the exact same columns as before, so
-- apps/web/lib/{fundamentals-read,valuation-read,peer-read,dcf-inputs,reports-read}.ts and their
-- tests require zero changes. New issuer_fundamentals / issuer_company_documents views serve the
-- unlisted-issuer product surface.

-- === company_documents: issuer_id becomes canonical ownership ==============================

alter table market.company_documents add column issuer_id uuid references market.issuers(id);

update market.company_documents d set issuer_id=s.issuer_id
from market.securities s where d.security_id=s.id and d.issuer_id is null;

-- Every existing row today has a security_id that resolves to an issuer (verified before
-- writing this migration), so the backfill above is total and this NOT NULL is safe.
alter table market.company_documents alter column issuer_id set not null;
-- security_id becomes optional going forward: a document synced/entered for an issuer with no
-- listed BVC security has no security to attach.
alter table market.company_documents alter column security_id drop not null;

create index market_company_documents_issuer_type_year_idx
  on market.company_documents(issuer_id,document_type,fiscal_year desc);

-- === market.issuers: fold the alias table's job into direct columns ========================
--
-- Once an issuer carries its own ammc_issuer_id, a separate company_document_aliases join table
-- mapping "AMMC issuer id -> security_id" becomes a second, redundant source of truth for the
-- same fact (priority-1 matching in docs/COMPANY_DOCUMENTS.md is now just "does an issuer
-- already have this ammc_issuer_id" -- a direct indexed lookup on market.issuers). The 3
-- existing, deliberately-reviewed mappings (IAM, BCP, S2M) are preserved by copying them onto
-- the issuer rows below, not dropped.

alter table market.issuers add column ammc_issuer_name text;

update market.issuers i set
  ammc_issuer_id=a.source_issuer_id,
  ammc_issuer_name=a.source_issuer_name
from market.company_document_aliases a
join market.securities s on s.id=a.security_id
where i.id=s.issuer_id and a.source_provider_id='ammc_public_documents';

drop table market.company_document_aliases;

-- === unmatched_document_issuers: now specifically "ambiguous" review, issuer-centric =======
--
-- Under the old (security-only) model, "no BVC security" was the common, expected reason an
-- AMMC issuer landed here. Under the issuer model that is no longer true -- an issuer with no
-- listed equity is simply created as unlisted (see @bvc/annual-reports's sync.ts). This table
-- is now reserved for genuine ambiguity: an AMMC issuer name that collides with more than one
-- existing SaifInvest issuer, which is never auto-resolved.

alter table market.unmatched_document_issuers add column candidate_issuer_id uuid references market.issuers(id);
alter table market.unmatched_document_issuers drop column candidate_security_id;
alter table market.unmatched_document_issuers rename to ambiguous_document_issuers;

-- === market.fundamentals: issuer_id becomes canonical ownership ============================

alter table market.fundamentals add column issuer_id uuid references market.issuers(id);

update market.fundamentals f set issuer_id=s.issuer_id
from market.securities s where f.security_id=s.id and f.issuer_id is null;

alter table market.fundamentals alter column issuer_id set not null;
alter table market.fundamentals alter column security_id drop not null;

-- Fundamentals belong to the issuer's financial statements, not to a ticker: an issuer with two
-- securities (schema-wise possible) reports one set of numbers per period, not one per security.
alter table market.fundamentals drop constraint fundamentals_security_id_period_type_period_end_date_key;
alter table market.fundamentals add constraint fundamentals_issuer_period_key
  unique(issuer_id,period_type,period_end_date);

create index market_fundamentals_issuer_period_idx
  on market.fundamentals(issuer_id,period_end_date desc);

-- === Rebuilt product-safe views =============================================================

-- No is_synthetic filter here, deliberately: the original view (202609030001) had none, and a
-- listed-security read must behave exactly as before, including for the local SYN-* dev
-- fixtures used by supabase/tests/live-database.test.ts and friends. The synthetic exclusion
-- belongs only on the new issuer_id-keyed views below, which are new product surfaces this
-- migration gets to define policy for from the start.
drop view public.security_fundamentals;
create view public.security_fundamentals with (security_invoker=false, security_barrier=true) as
select
  f.id,
  s.id as security_id,
  f.period_type,
  f.interim_period,
  f.fiscal_year,
  f.period_end_date,
  f.publication_date,
  f.currency,
  f.revenue,
  f.ebitda,
  f.ebit,
  f.net_income,
  f.eps,
  f.cash_and_equivalents,
  f.total_debt,
  f.total_assets,
  f.total_equity,
  f.operating_cash_flow,
  f.capex,
  f.shares_outstanding,
  f.dividend_per_share,
  f.depreciation_amortization,
  f.tax_expense,
  f.working_capital,
  f.change_in_working_capital
from market.fundamentals f
join market.securities s on s.issuer_id=f.issuer_id;

revoke all on public.security_fundamentals from public;
grant select on public.security_fundamentals to anon,authenticated;

create view public.issuer_fundamentals with (security_invoker=false, security_barrier=true) as
select
  f.id,
  f.issuer_id,
  f.period_type,
  f.interim_period,
  f.fiscal_year,
  f.period_end_date,
  f.publication_date,
  f.currency,
  f.revenue,
  f.ebitda,
  f.ebit,
  f.net_income,
  f.eps,
  f.cash_and_equivalents,
  f.total_debt,
  f.total_assets,
  f.total_equity,
  f.operating_cash_flow,
  f.capex,
  f.shares_outstanding,
  f.dividend_per_share,
  f.depreciation_amortization,
  f.tax_expense,
  f.working_capital,
  f.change_in_working_capital
from market.fundamentals f
join market.issuers i on i.id=f.issuer_id
where not i.is_synthetic;

revoke all on public.issuer_fundamentals from public;
grant select on public.issuer_fundamentals to anon,authenticated;

-- Same deliberate no-is_synthetic-filter reasoning as security_fundamentals above.
drop view public.security_company_documents;
create view public.security_company_documents with (security_invoker=false, security_barrier=true) as
select
  d.id,
  s.id as security_id,
  d.document_type,
  d.fiscal_year,
  d.title,
  d.source_provider_id,
  d.source_url,
  d.publication_date,
  d.language,
  d.file_name,
  d.file_size_bytes
from market.company_documents d
join market.securities s on s.issuer_id=d.issuer_id
where d.status='published';

revoke all on public.security_company_documents from public;
grant select on public.security_company_documents to anon,authenticated;

create view public.issuer_company_documents with (security_invoker=false, security_barrier=true) as
select
  d.id,
  d.issuer_id,
  d.document_type,
  d.fiscal_year,
  d.title,
  d.source_provider_id,
  d.source_url,
  d.publication_date,
  d.language,
  d.file_name,
  d.file_size_bytes
from market.company_documents d
join market.issuers i on i.id=d.issuer_id
where d.status='published' and not i.is_synthetic;

revoke all on public.issuer_company_documents from public;
grant select on public.issuer_company_documents to anon,authenticated;

commit;
