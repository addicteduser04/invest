# Fundamentals

Normalized, point-in-time-capable financial-statement data per listed security, and the derived
metrics built on top of it. This is a foundation layer for future valuation/screening work; it
does not itself include DCF, comparable-company valuation, or screener filters.

## Schema

`market.fundamentals` (migration `supabase/migrations/202609030001_market_fundamentals.sql`) —
one row per `(security_id, period_type, period_end_date)`, explicit numeric columns, not a JSON
blob:

- **Identity**: `security_id`, `period_type` (`annual` | `interim`), `interim_period` (`H1` |
  `H2`, required iff interim), `fiscal_year`, `period_end_date`, `publication_date`, `currency`,
  `source_provider_id`.
- **Income statement**: `revenue`, `ebitda`, `ebit`, `net_income`, `eps`.
- **Balance sheet**: `cash_and_equivalents`, `total_debt`, `total_assets`, `total_equity`.
- **Cash flow**: `operating_cash_flow`, `capex`.
- **Capital**: `shares_outstanding`, `dividend_per_share`.

All monetary columns are `numeric(20,6)`; `shares_outstanding` is `numeric(24,0)` (matches
`market.securities.share_count`'s precision). No D&A / working-capital / tax-rate columns exist
yet — they aren't in this milestone's required field list, and adding unused nullable columns
now would be speculative. A future `alter table` can add them once a real input source exists.

Access follows the same convention as every other `market` schema table: no direct RLS policies,
no PostgREST exposure of the `market` schema at all. Writes go through the `data_admin`-gated
`apply_fundamentals_import` RPC; reads go through the public `security_fundamentals` view
(`security_barrier = true`, granted to `anon, authenticated`), which excludes admin/audit fields
(`created_by`, import-run linkage). `market.fundamentals_import_runs` is the durable audit trail
(append-only, same `private.prevent_mutation()` guard as `market.ingestion_runs`).

## Point-in-time semantics

`publication_date` is **nullable and never backfilled from `period_end_date`**. An unknown
publication date must stay unknown — silently substituting the period end date would let a
future backtest assume a number was public before it actually was. The only enforced temporal
rule is `publication_date >= period_end_date` (a company cannot publish results before the
period they cover ends); no other date is invented or inferred.

## Null vs. zero

A blank CSV cell always becomes `null`, never `0`. A company that hasn't disclosed EBITDA is
different from a company reporting exactly zero EBITDA, and the import path preserves that
distinction end to end (CSV → `market.fundamentals` → `security_fundamentals` view → derived
metrics, which return `null` rather than treating a missing input as zero).

## Capex sign convention

`capex` is stored as a **non-negative magnitude of cash spent** (enforced by a `check` constraint
in the migration). Free cash flow is computed as:

```
free_cash_flow = operating_cash_flow - capex
```

## Uniqueness / idempotency

`unique(security_id, period_type, period_end_date)`. Re-importing the same period updates the
existing row in place — no row-status versioning. `apply_fundamentals_import` does the upsert and
the insert/update/no-op accounting in one statement, via
`insert ... on conflict ... do update ... where <any column is distinct from incoming> returning (xmax = 0)`:
a conflicting row whose `where` clause evaluates false is skipped by Postgres entirely (no row
returned), which is exactly the no-op case — `row_count - inserted - updated = no-op`.

## CSV import format

One row per company/period. Header:

```
ticker,period_end_date,publication_date,period_type,interim_period,currency,
revenue,ebitda,ebit,net_income,eps,cash,total_debt,total_assets,total_equity,
operating_cash_flow,capex,shares_outstanding,dividend_per_share
```

- `ticker` must resolve to a known security (via the public security directory) or the row is
  rejected.
- `period_type` is `annual` or `interim`; `interim_period` (`H1`/`H2`) is required for interim
  rows and must be blank for annual rows.
- `period_end_date` is required (ISO date); `publication_date` is optional.
- `currency` defaults to `MAD` if blank.
- Every numeric field may be blank (stays `null`). Negative values are accepted everywhere except
  `capex` and `shares_outstanding`, which must be non-negative (a count/magnitude, not a
  financial value that can legitimately go negative).
- A file containing any invalid row cannot be confirmed as a whole (matches the existing
  security-master admin-CSV convention) — fix and re-upload rather than partially importing.
- A row whose key already exists in the database is flagged as a warning ("will be updated"),
  not an error.

See `docs/samples/fundamentals-sample.csv` for a worked example.

## Derived metrics

Pure functions in `apps/web/lib/fundamentals-metrics.ts`. Every metric returns `null` (never
throws, never guesses) when a required input is missing or a denominator is exactly zero:

- **Growth (YoY, matched against the prior period of the same `period_type`/`interim_period`)**:
  revenue growth, net income growth, EPS growth — `(current - prior) / abs(prior)`.
- **Margins**: EBITDA / EBIT / net / FCF margin — `<line item> / revenue`.
- **Free cash flow**: `operating_cash_flow - capex`.
- **Debt/equity**: `total_debt / total_equity`. **Net debt**: `total_debt - cash_and_equivalents`.
- **ROE**: `net_income / total_equity` — computed even when equity is negative; there is no
  positivity gate on an economically valid (if unusual) input.

## Product surface

`apps/web/lib/fundamentals-read.ts` reads up to the last 12 periods for one security from
`security_fundamentals`, coerces every numeric column to a string at the boundary, computes the
derived metrics for the latest period, and returns a zod-validated shape. It is rendered by
`apps/web/components/security-fundamentals-section.tsx`, appended to the existing Security Detail
page (`apps/web/app/[locale]/market/[securityId]/page.tsx`) below the price hero and chart,
without touching either. A security with no fundamentals rows shows an explicit empty state; a
period-over-period trend table (revenue / net income / FCF) only renders once at least 2 periods
exist.

## Admin import workflow

`/[locale]/admin/fundamentals` (`data_admin` only, same auth gate as the other three admin
pages). Upload → preview (per-row errors/warnings, insert/update/no-op totals) → confirm → durable
result, backed by `POST /api/admin/fundamentals/import`. Single-admin validate-then-confirm, no
two-admin governance — unlike the price-import flow, this is low-frequency, manually curated
reference data, not price-moving.

## Adding a future licensed provider

`source_provider_id` already anticipates `licensed_api` / `licensed_sftp` alongside `admin_csv`
(the only source this milestone writes). No provider-adapter code is added now — fundamentals
import is CSV-only here. When a licensed feed exists, it plugs in the same way
`market.securities.source_provider_id` already anticipates non-admin sources: extend the CSV/API
boundary to also accept rows tagged with the new provider id, without changing the schema.
