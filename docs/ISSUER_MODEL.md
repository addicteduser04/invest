# Issuer / company model

Evolves SaifInvest from an implicit `security == company` assumption into a proper
issuer/company model: a company (`market.issuers`) can exist with zero, one, or (schema-wise)
more than one listed security. Triggered by the AMMC annual-reports sync (see
`docs/COMPANY_DOCUMENTS.md`), which proved the real issuer universe -- Moroccan public entities
and financial institutions with no listed equity, foreign cross-listings, historical issuers --
is much larger than the ~80 BVC-listed equities SaifInvest previously tracked.

```
ISSUER (market.issuers)
   ├── annual reports (market.company_documents, issuer_id)
   ├── fundamentals (market.fundamentals, issuer_id)
   ├── company metadata (name, sector, country, issuer_type, equity_listing_status)
   └── 0..N securities (market.securities.issuer_id)
            └── prices / trading data / market-derived metrics
```

## Schema (`supabase/migrations/202609070001_market_issuers.sql` onward)

- `market.issuers`: `name`, `normalized_name`, `slug` (unique, public route key),
  `ammc_issuer_id`/`ammc_issuer_name` (the priority-1 AMMC matching signal -- see below),
  `issuer_type` (`listed_company` / `unlisted_company` / `public_entity` /
  `financial_institution` / `foreign_issuer` / `historical_issuer` / `other`),
  `equity_listing_status` (`listed_bvc` / `no_listed_bvc_equity` / `historical_or_delisted` /
  `unknown`), `country_code`/`country_name`, `sector`, `website`, `is_synthetic`.
- `market.securities.issuer_id` (`not null`, FK) -- every security, real or the local `SYN-*`
  dev fixtures, has an issuer. Synthetic fixtures get their own `is_synthetic=true` issuer rows
  so no nullable-issuer special case exists anywhere in the read layer; every public-facing
  issuer view/list filters `is_synthetic` out.
- `market.fundamentals.issuer_id` is canonical (unique key is `(issuer_id, period_type,
period_end_date)`, not per-security) -- fundamentals are the issuer's financial statements, not
  a per-ticker fact. `security_id` stays as a nullable column on existing rows for traceability
  but is never written by new imports.
- `market.company_documents.issuer_id` is canonical for the same reason (see
  `docs/COMPANY_DOCUMENTS.md`).

### Why no separate alias table

An earlier iteration had a dedicated `company_document_aliases` join table mapping AMMC issuer
id -> security. Once `market.issuers.ammc_issuer_id` exists as a direct column, that table became
a second, redundant source of truth for the same fact -- priority-1 matching is now just an
indexed lookup on `market.issuers`. The 3 originally reviewed mappings (IAM, BCP, S2M) were
migrated onto the corresponding issuer rows, not dropped; see the migration comment in
`202609070002_issuer_owned_documents_fundamentals.sql`.

## Backward compatibility for listed securities

`public.security_fundamentals` and `public.security_company_documents` are rebuilt as
`security -> issuer -> data` joins that expose **exactly** the same columns (including
`security_id`) as before the migration. `apps/web/lib/{fundamentals-read,valuation-read,
peer-read,dcf-inputs,reports-read}.ts` and their tests needed zero changes. Neither view filters
`is_synthetic` (the pre-migration views didn't either -- the local `SYN-*` dev fixtures must stay
visible through them exactly as before). The synthetic exclusion applies only to the new
issuer-keyed views (`issuer_fundamentals`, `issuer_company_documents`, `issuer_directory`), which
are new product surfaces with no such precedent to preserve.

New issuer-keyed views (`public.issuer_fundamentals`, `public.issuer_company_documents`,
`public.issuer_directory`) serve `/companies` and `/companies/[slug]`, including for issuers with
no listed security at all.

## Valuation semantics

Security/market-price-dependent metrics (market cap, P/E, P/B, dividend yield, earnings/FCF
yield, market-price peer comparison) stay security-level only -- an unlisted issuer has no price
to compute them from, and the product never fabricates one. Issuer-level (fundamentals-only)
metrics -- revenue, EBITDA, EBIT, net income, margins, ROE, debt/equity, net debt, FCF -- are
available for every issuer with fundamentals data, listed or not, via
`apps/web/lib/issuer-fundamentals-read.ts` / `IssuerFundamentalsSection`. The Security Detail
page's peer comparison stays listed-security-only for this phase (mission scope: do not expand
peer logic beyond what already exists).

## Sync classification (see `docs/COMPANY_DOCUMENTS.md` for the full pipeline)

`market.document_sync_runs` now tracks issuer-level outcomes distinctly from document-level
ones: `issuers_discovered/existing/created/ambiguous/linked_to_security/unlisted/with_reports/
without_reports`. An AMMC issuer with no BVC security is `unlisted`/`created`, never an error; an
issuer with zero annual reports is `without_reports`, never a failure. Only genuine fetch/parse
problems land in `failures`.

## Product surfaces

- `/[locale]/companies` -- the full issuer directory (`CompanyDirectory`), search + classification
  filter (Listed BVC / Unlisted Moroccan / Foreign / Historical). Distinct from `/stocks`, which
  stays the listed-equity market screener.
- `/[locale]/companies/[slug]` -- issuer detail. For a listed issuer: badge "Listed on Casablanca
  Stock Exchange · TICKER" plus a prominent link to the existing Security Detail route (no
  duplicated price/chart UI). For an unlisted issuer: badge "Not listed as an equity on the
  Casablanca Stock Exchange" (never a bare "Not listed", which would wrongly imply no
  capital-markets instruments exist at all) and a neutral "No listed equity market price is
  available for comparison" in place of any market-data section -- no fake ticker/price/chart/
  market cap/P-E.
- Security Detail's company-name heading links to `/companies/[issuer-slug]` (resolved via one
  extra `issuer_directory` query keyed by `security_id`); every existing security-level feature
  (valuation, peers, DCF, charts, reports, fundamentals) is unchanged.

## Admin (`/[locale]/admin/reports`, extended)

Coverage stats are issuer-level (total/listed/unlisted/foreign issuers, issuers with/without
reports, ambiguous count) rather than the old security-only counts. New RPCs:
`upsert_issuer_ammc_link` (set/correct an issuer's AMMC id), `create_issuer_manual` (explicit
issuer creation, e.g. for a company not yet discovered by sync), `resolve_ambiguous_document_
issuer` (link an ambiguous AMMC entry to an existing issuer and resolve it in one call, or
ignore it). None of these ever auto-link an ambiguous case -- only a human decision does.

## Fundamentals CSV import (`docs/FUNDAMENTALS.md`, resolution logic in

`packages/market-data/src/fundamentals-import.ts`)

Backward compatible: a ticker-only CSV still works unchanged. Optional new columns
`issuer_id` / `ammc_issuer_id` / `issuer_name` let an admin target an issuer with no listed
security. Resolution precedence per row: `issuer_id` (trusted as-is) → `ticker` (resolved to that
security's issuer) → `ammc_issuer_id` → `issuer_name` (exact normalized match against exactly one
known issuer). Never fuzzy-matches; a row that resolves to nothing, or to more than one issuer by
name, is rejected with a clear per-row error rather than guessed.
