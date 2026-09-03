# SaifInvest final MVP runbook

This runbook is the acceptance and deployment handoff for the SaifInvest MVP release candidate.

## 1. Prerequisites

- Node.js 22+
- pnpm 11.x matching `packageManager` in `package.json`
- Docker
- Supabase CLI

From the repository root:

```bash
pnpm install --frozen-lockfile
supabase start
supabase status
```

Do not upgrade dependencies/tooling during final acceptance.

## 2. Local environment

The web package runs from `apps/web`, so create **`apps/web/.env.local`** from
**`apps/web/.env.example`**:

```bash
cp apps/web/.env.example apps/web/.env.local
```

Then set `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` from the local value printed by
`supabase status`. Keep this file ignored and never commit local/production secrets.

If running the worker (`pnpm dev`, or the daily-ingestion CLI) additionally provide, in the
repository-root `.env.local`:

```env
WORKER_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
INTERNAL_JOB_SIGNING_SECRET=<development-only random secret, 32+ chars>
MARKET_INGESTION_PROVIDER=bvc_public_testing
```

For web-only development, without the worker:

```bash
pnpm dev:web
```

## 3. Database reset (from-zero acceptance)

Before any test-data loading or deployment, prove the schema replays cleanly with no manual
intervention:

```bash
pnpm check:migrations
supabase db reset
pnpm test:database
pnpm test:integration
```

The current checkpoint contains **19 ordered transactional migrations**. `supabase db reset`
must apply all of them with no errors and no manual steps; `pnpm test:database` (30 live-DB
RLS/transaction/portfolio-state tests) and `pnpm test:integration` (20 migration-shape tests,
plus the same live-DB tests when `LIVE_DATABASE_TESTS=1`) must be green before continuing.

`pnpm test:database` counts rows in some shared tables (e.g. `public.portfolios`) via a
service-role query — run it on a state with no extra manually-created portfolios (i.e.
immediately after `supabase db reset`, or after a fresh reset following any manual data
bootstrap/regression pass below), not interleaved with them.

## 4. Data bootstrap (local/private testing only)

`BVC_PUBLIC_TESTING_ENABLED=true` and provider `bvc_public_testing` are for local/private
testing only — production must never use them (enforced in code, not just convention; see
§7). To seed enough local data to exercise the product:

```bash
pnpm data:bootstrap -- --tickers IAM,ATW,BCP --years 1
```

This applies the BVC security master (all listed securities, including IAM/ATW/BCP),
MASI-family index master, and latest market snapshots to the local database. If the BVC
public site's WAF rejects requests (`BVC_INVALID_RESPONSE`), that is an accepted, already-handled
outcome — security master and index master typically still succeed even when equity/index
_history_ is rejected; the failures are recorded, not silently swallowed, and existing data is
never corrupted.

## 5. Create local test users

Register at least:

- one normal investor account;
- one `data_admin` account.

New accounts are investors by default. Grant `data_admin` locally via SQL using the account's
profile UUID:

```sql
insert into public.user_roles(user_id, role)
values ('<user-uuid>', 'data_admin')
on conflict do nothing;
```

## 6. Daily market ingestion & admin operations

See **[MARKET_DATA_OPERATIONS.md](./MARKET_DATA_OPERATIONS.md)** for the full operations
runbook (how the pipeline works, CLI reference, provider configuration, production safety,
stale-data definition, investigating/retrying failed instruments, incident recovery). Summary:

```bash
pnpm market:daily -- --date 2026-08-28 --tickers IAM,ATW,BCP   # run
pnpm market:daily -- --date 2026-08-28 --tickers IAM,ATW,BCP   # rerun: idempotent, no duplicates
pnpm market:daily -- --retry-failed --date 2026-08-28          # retry only what failed
```

The admin UI at `/[locale]/admin/market-data` (data_admin-gated, enforced server-side) uses the
exact same pipeline for its "Run market import" and "Retry failed instruments" actions — there
is no separate browser ingestion stack. `GET /api/health` exposes a minimal, secret-free
`marketData` block (status, latest equity/index dates, last run status, failed-instrument count,
staleness) for external monitoring.

The manual/CSV two-admin price-review workflow (`/[locale]/admin/import`,
`/[locale]/admin/securities`) is separate and unchanged — see
[BVC_PUBLIC_TESTING.md](./BVC_PUBLIC_TESTING.md).

## 7. Financial regression scenario

This exact scenario has been verified end-to-end through the real `record_transaction` /
`reverse_transaction` RPCs and the real `/api/portfolios/[id]/valuation` endpoint (not just unit
tests), with market prices seeded to match the trade prices below so the result is
deterministic:

Deposit 100,000 MAD; buy IAM 100 @ 102.75 (fees 25); buy ATW 20 @ 705 (fees 30); buy BCP 50 @ 250
(fees 20); sell IAM 40 @ 102.75 (fees 10); dividend IAM gross 300, taxes 45; fee 50; then reverse
the standalone fee.

Verified result:

| Metric                        | Value                                                                                   |
| ----------------------------- | --------------------------------------------------------------------------------------- |
| Cash                          | 67,405.00 MAD                                                                           |
| Portfolio value               | 100,170.00 MAD                                                                          |
| Total gain                    | +170.00 MAD                                                                             |
| Realized P&L                  | -20.00 MAD                                                                              |
| Unrealized P&L                | -65.00 MAD                                                                              |
| Net dividend income           | 255.00 MAD                                                                              |
| IAM                           | 60 shares, avg cost 103.00, realized P&L -20.00                                         |
| ATW                           | 20 shares, avg cost 706.50                                                              |
| BCP                           | 50 shares, avg cost 250.40                                                              |
| Standalone fee, post-reversal | net 0 (original transaction row immutable; reversal is a separate linked counter-entry) |

To repeat: create a portfolio, run the RPCs in order via the real app or `supabase-js` against
local Supabase, wait for the worker to process `portfolio.recalculate` (a few seconds), then
`GET /api/portfolios/[id]/valuation`.

## 8. Full local validation

Run this exact sequence:

```bash
pnpm format:fix
pnpm test
pnpm typecheck
pnpm lint
pnpm check:migrations
pnpm build
pnpm test:database
pnpm test:integration
git diff --check
```

All must pass with zero failures. `pnpm test` covers unit/component tests across every
workspace package (portfolio engine, contracts, market-data, market-ingestion, worker, web) plus
the root BVC-bootstrap tests. Do not deploy while an ordinary code/test/database failure remains
unresolved.

## 9. Localization & visual sweep

Exercise `/en`, `/fr`, `/ar` on the core flows (home, market, stocks, compare, security detail,
dashboard, transactions, transactions/new, admin market-data) at both ~1440px and ~390px.
Check for: untranslated copy, RTL layout correctness (ticker codes and numbers stay readable
left-to-right within RTL text), horizontal overflow, clipped/broken forms or charts, and that the
admin UI never looks like a generic CRUD dashboard.

`document.documentElement.scrollWidth - clientWidth` should be `0` on every route at 390px in a
live (non-full-page-screenshot) viewport check.

## 10. Authorization matrix

Three identities, verified with no redirect loops and no homepage fallback hacks:

| Route                                                               | Signed out    | Investor            | data_admin |
| ------------------------------------------------------------------- | ------------- | ------------------- | ---------- |
| `/fr`, `/fr/market`, `/fr/stocks`, `/fr/compare`, `/fr/market/<id>` | 200           | 200                 | 200        |
| `/fr/dashboard`, `/fr/transactions`, `/fr/transactions/new`         | → `/fr/login` | 200 (own data only) | 200        |
| `/fr/admin/market-data`                                             | → `/fr/login` | → `/fr/dashboard`   | 200        |

Primary navigation is exactly **Marché · Actions · Comparer · Portefeuille** for everyone, plus
**Tableau de bord admin** for `data_admin` only (server-computed, not hidden client-side).
Dividendes is intentionally unlinked from navigation pending its own release; the page itself
still exists at `/[locale]/dividends` for anyone who navigates there directly.

## 11. Health endpoint

```bash
curl -i http://localhost:<port>/api/health
```

`200` with `status: "ok"` when the database is reachable, including a `marketData` block (see
§6). `503` with `status: "degraded"` means the app is running but its database dependency is
unreachable/misconfigured. Never returns secrets or stack traces in either case.

## 12. Staging deployment

**Status as of this release candidate: blocked on missing/unconfirmed external configuration —
not attempted.** No staging deployment was performed. What's missing:

- **No designated staging target.** One Supabase project is `supabase link`ed locally
  (`Portfolio`, ref `afygvbccaggdhqiyxoqp`) with public web keys present in a local,
  gitignored `.env.local`, but nothing in the repository confirms this project is meant for
  staging (vs. production, vs. a personal scratch project), and its direct Postgres connection
  string (`DATABASE_URL`/`WORKER_DATABASE_URL`) is not configured anywhere.
- **No web hosting deployment path.** No Vercel CLI installed/authenticated, no `vercel.json`,
  no other hosting configuration or CI deploy step (`.github/workflows/ci.yml` runs `pnpm check`
  only — no deploy job).
- **No worker hosting target.** Nothing configures where a staging worker process would run.
- **No staging-specific `MARKET_INGESTION_PROVIDER` decision.** Per policy (§7 of
  MARKET_DATA_OPERATIONS.md), `bvc_public_testing` must not be assumed safe on a publicly
  reachable staging site — this has to be an explicit choice, not a default.

Required configuration once a target is confirmed:

**Web:** `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.

**Server/worker:** `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` / `WORKER_DATABASE_URL`,
`INTERNAL_JOB_SIGNING_SECRET` (generate fresh — do not reuse a local development value),
`MARKET_INGESTION_PROVIDER` (never `bvc_public_testing` unless the environment is confirmed
private; production/public staging refuses it unconditionally regardless of this setting once
`NODE_ENV=production`).

Once a target and hosting path are confirmed: apply all 19 migrations via the Supabase CLI
against that project, deploy the web app, deploy/configure the worker (or an external scheduler
invoking `pnpm market:daily` on the recommended cadence — see MARKET_DATA_OPERATIONS.md §
"Recommended schedule"), confirm `/api/health`, then repeat §7's financial scenario and the
core EN/FR/AR smoke test against the deployed URL before inviting pilot users.

## 13. Production market-data gate

`bvc_public_testing` must never be configured with `NODE_ENV=production` — the pipeline hard-fails
(`PRODUCTION_REFUSES_BVC_PUBLIC_TESTING`) with no override. A public SaifInvest launch must not
present the private BVC public-site connector as a licensed commercial feed. Before public
redistribution of exchange data, obtain/confirm the required rights and wire a real
`licensed_api`/`licensed_sftp` adapter (none exists yet — selecting either currently fails fast
with `PROVIDER_NOT_CONFIGURED`, which is the correct, safe behavior until a real integration is
built) while retaining the existing validation/provenance/review architecture.
