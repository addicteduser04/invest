# Operations

## Environments

- **Local**: disposable, `supabase start`. Free to reset.
- **Staging**: `https://saifinvest-staging.vercel.app`, Supabase project "Portfolio"
  (`afygvbccaggdhqiyxoqp`). Persistent — **never** `supabase db reset` against it, never truncate,
  never recreate from scratch. Treat it exactly like production for data-safety purposes even
  though its current dataset is a near-empty smoke-test environment (as of this milestone: 0
  securities/issuers/portfolios, 1 auth user — schema-migrated but not yet seeded with real
  market/issuer data).
- **Production**: does not exist yet. Nothing in this repo currently deploys to one; any future
  production target must go through the same non-destructive migration discipline as staging, plus
  whatever additional review a real financial-data production launch needs (out of scope here).

## Migration procedure

1. Every schema change is a **new**, additively-numbered file under `supabase/migrations/`
   (`YYYYMMDDNNNN_description.sql`), wrapped in `begin;`/`commit;`. Never edit a migration that has
   already been applied anywhere (local, staging, or committed to git) — even a comment-only edit
   creates drift between what the file says and what actually ran. Fix mistakes in local-only,
   uncommitted, unapplied files freely; once applied+committed, only a new forward migration can
   change behavior.
2. `pnpm check:migrations` validates every file is transactional, ordered, and doesn't use
   `float`/`real`/`double precision` (this project uses `numeric` throughout for monetary values).
3. Apply locally first: `supabase db push --local`. Verify row counts before/after for anything the
   migration touches (see "Before a risky schema change" below).
4. Apply to staging only after local tests pass: `supabase db push --linked` (requires being linked
   to the staging project — `supabase link` was already done for this repo).
5. `supabase db advisors --local --type security` (or `--linked` for staging) after any migration
   that adds a function, view, or table — catches `search_path`/`security_definer`/RLS regressions
   immediately rather than discovering them later.

## Rollback philosophy

There is no automatic rollback tooling for Postgres schema migrations here, and building one is
out of scope. In practice:

- An additive migration (new table/column/function) is safe to leave in place even if the feature
  built on it is abandoned — it costs nothing to keep.
- A migration that changes existing behavior (drops a constraint, changes a view's columns) should
  be followed by a **new** forward migration that reverts it, never by editing history.
- Before anything destructive-shaped (`drop column`, `drop table`, a `delete`/`truncate` outside a
  disposable dev DB), capture row counts first (see below) and get explicit user confirmation —
  this is a standing rule for this project, not new to this milestone.

## Before a risky schema change

```sql
select count(*) from market.securities;
select count(*) from market.issuers;
select count(*) from market.fundamentals;
select count(*) from market.company_documents;
select count(*) from public.portfolios;
select count(*) from public.transactions;
```

Run this before and after. Any unexpected decrease is a stop-and-investigate signal, not something
to push past.

## Backup / recovery

**Operator check required** — this repo has not verified what backup/PITR (point-in-time recovery)
plan the staging (or any future production) Supabase project is actually on; Supabase's automatic
daily backups and PITR are plan-gated features, and claiming a specific retention window here
without having checked the project's billing plan would be a guess this document should not make.
Before any staging schema change that is hard to reverse, confirm in the Supabase dashboard
(Database → Backups) what recovery point is actually available.

**Recovery priority order** if ever needed, highest first:

1. `public.portfolios`, `public.transactions`, `private.transaction_reversal_requests`,
   `private.cash_ledger_entries` — user-owned financial ledger data. Irreplaceable.
2. `public.profiles`, `public.user_roles`, `auth.users` — account/access data.
3. `market.securities`, `market.issuers`, `market.fundamentals`, `market.company_documents` —
   re-derivable from the BVC/AMMC sources (CSV re-import, `pnpm reports:sync -- --all`), slower to
   rebuild than to restore but not user-data-loss.
4. `market.prices`, `market.index_observations` — re-importable from provider history where still
   available; older provisional/superseded rows may not be reconstructable if the source no longer
   serves them.
5. `market.document_sync_runs`, `market.ingestion_runs`, `audit.events`,
   `private.rate_limit_counters` — operational/audit trail. Losing recent rows here is an
   observability gap, not a data-loss incident; `rate_limit_counters` is explicitly ephemeral and
   expected to be empty/small at any given time.

## Cost / resource posture

Architecture choices that keep this bounded, verified during this milestone (local DB, 2026-09):

- **No AMMC PDF mirroring**: `market.company_documents` stores metadata + the official AMMC URL
  only, never the PDF body (`docs/COMPANY_DOCUMENTS.md`). At ~2,346 indexed documents this avoids
  storing what would likely be several GB of PDFs plus their egress cost.
- **Bounded imports**: every CSV/bulk-import path has both an application-level row/byte cap and an
  independent database-level `jsonb_array_length` cap on the RPC itself (see `docs/SECURITY.md`
  "Input limits").
- **Bounded public reads**: `/companies` and `/stocks` fetch their full (small, fixed-size)
  directory once and filter client-side — no server-side pagination needed at this scale, and no
  unbounded query risk as a result. `/compare` is capped at `MAX_COMPARE_SECURITIES`.
- **Rate limits + job locks**: see `docs/SECURITY.md`.
- **Compact logs**: verified empirically this milestone —
  `audit.events` (2,324 rows) stores structured records under 400 bytes each (action, actor,
  compact `after_state`), never raw HTML/stack traces.
  `market.document_sync_runs.failures` (JSONB) tops out around 2.5KB for a full 187-issuer sync's
  worth of failures. Neither table stores anything unbounded.
- **`private.rate_limit_counters` self-cleans**: every call to `check_rate_limit` opportunistically
  deletes that same scope/identity's windows older than 2×the window size — no scheduled job, and
  the table cannot accumulate unbounded history for a given caller.

### Current local database size (2026-09-10, reference point only — staging is near-empty)

Total: **18 MB**. Largest tables:

| Table                      | Total size | Rows (approx) | Grows with                                   |
| -------------------------- | ---------- | ------------- | -------------------------------------------- |
| `market.company_documents` | 1.9 MB     | 2,346         | B: number of issuers/AMMC filings            |
| `audit.events`             | 0.9 MB     | 2,324         | C: number of users × their activity          |
| `market.ingestion_runs`    | 168 kB     | ~120          | D: operational (one row per ingestion run)   |
| `market.issuers`           | 160 kB     | 189           | B: number of issuers                         |
| `public.transactions`      | 152 kB     | —             | C: number of users × their activity          |
| `market.securities`        | 128 kB     | 83            | B: BVC-listed universe (slow-growing)        |
| `market.fundamentals`      | 112 kB     | —             | B: number of issuers × reporting periods     |
| `market.prices`            | 96 kB      | 74            | A: market history (will dominate over years) |

Growth categories (per the milestone's own framing):

- **A — market history** (`market.prices`, `market.index_observations`,
  `market.price_candidates`): currently tiny (this environment has almost no historical price
  data loaded) but is the one category that grows unboundedly with time regardless of user/issuer
  count — daily prices × years × securities. Already indexed for the query patterns that read it
  (`prices_security_date_idx` on `(security_id, market_date desc)`); watch this table's growth rate
  once real daily ingestion is running continuously.
- **B — issuer/document count** (`market.issuers`, `market.company_documents`,
  `market.fundamentals`): grows with AMMC's own universe (currently 187 issuers, bounded by
  reality — AMMC does not add thousands of new issuers) and with historical filing depth (now that
  pagination is fixed, a deep issuer can have 15+ years of filings). Already the largest category
  at 2,346 rows / 1.9 MB; expect roughly linear growth with issuer count, not explosive.
- **C — user count** (`public.transactions`, `public.portfolios`, `audit.events`,
  `private.cash_ledger_entries`): scales with product adoption, the one category actually outside
  this project's control. Currently near-empty on both local and staging.
- **D — operational logs** (`market.ingestion_runs`, `market.document_sync_runs`,
  `private.rate_limit_counters`, `private.portfolio_recalculation_runs`): one row per operational
  event, already compact (see above), and `rate_limit_counters` specifically self-prunes.

### Checking table/index size

```sql
select pg_size_pretty(pg_database_size(current_database()));

select n.nspname||'.'||c.relname as name,
  pg_size_pretty(pg_total_relation_size(c.oid)) as total,
  pg_size_pretty(pg_relation_size(c.oid)) as table_only,
  pg_size_pretty(pg_indexes_size(c.oid)) as indexes_only
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where c.relkind='r' and n.nspname in ('market','public','private','analytics','audit')
order by pg_total_relation_size(c.oid) desc limit 20;
```

## Query and index notes

`EXPLAIN (ANALYZE, BUFFERS)` run against the local DB this milestone on the main read paths
(`issuer_directory`, `security_company_documents`, `market_security_overview`): all under 1ms at
current row counts, all correctly using sequential scans where the table is small enough that a
seq scan is genuinely cheaper than an index scan (normal Postgres planner behavior, not a problem).
`market.prices` already carries `prices_security_date_idx (security_id, market_date desc)` and a
matching partial unique index — the planner will switch to using them automatically as the table
grows past the point where a seq scan stops being cheaper; no index was missing. No new index was
added this milestone because none of the audited queries showed a genuine missing-index cost at
current or realistically-near-term data volumes.

## Caching

Not added this milestone. Candidates noted for later if traffic ever justifies it (issuer
directory, security directory, annual-report lists — all slow-changing, public, safe to cache);
none currently warranted given they already execute in under 1ms server-side and there is no
production traffic yet to cache for. Never cache: `public.portfolios`/`transactions`/
`dcf_scenarios` reads, anything behind `requireDataAdmin`, or any auth-sensitive response.
