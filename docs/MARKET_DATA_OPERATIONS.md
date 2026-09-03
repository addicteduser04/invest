# Market data operations runbook

How daily equity/index ingestion runs, how to operate it manually, and how to recover from
provider failures. This covers the automated pipeline (`packages/market-ingestion`,
`pnpm market:daily`, `/[locale]/admin/market-data`) — not the manual CSV/BVC-staging two-admin
review workflow described in [BVC_PUBLIC_TESTING.md](./BVC_PUBLIC_TESTING.md), which is
unrelated and unchanged.

## How it works

One pipeline (`runDailyIngestion` in `@bvc/market-ingestion`) is used everywhere: the CLI
(`pnpm market:daily`), the scheduled job, and the admin UI's "Run market import" / "Retry
failed instruments" actions. It:

1. Resolves the provider from `MARKET_INGESTION_PROVIDER` (never client-selectable).
2. Creates a durable run row (`market.ingestion_runs`, status `running`).
3. Refreshes the security master and resolves the target ticker list.
4. Refreshes index master + history for the four supported MASI-family indices.
5. Fetches and upserts one day of OHLCV per ticker, bounded concurrency (default 2), with
   bounded retry/backoff per instrument.
6. Finalizes the run: `succeeded` (no failures), `partial` (some instruments failed), or
   `failed` (nothing succeeded).

Writes are idempotent: `market.prices` and `market.index_observations` are upserted keyed by
`(security_id, market_date)` / `(index_id, market_date, provider)`, so rerunning the same date
never duplicates rows — it just updates them. Each invocation still creates its own run row, so
the run history is a complete audit trail even across reruns and retries.

## Daily automatic run

An external scheduler (cron, a hosting platform's scheduled job, GitHub Actions on a
`schedule:` trigger — anything that can run a shell command on a timer) invokes:

```sh
pnpm market:daily
```

This is provider-neutral by design: nothing in the pipeline assumes a specific hosting vendor.
The worker process just needs `WORKER_DATABASE_URL` and `MARKET_INGESTION_PROVIDER` set in its
environment.

### Recommended schedule (Africa/Casablanca)

| Time  | Purpose                                                    |
| ----- | ---------------------------------------------------------- |
| 18:05 | Primary run                                                |
| 18:30 | Retry opportunity (`pnpm market:daily -- --retry-failed`)  |
| 19:30 | Final retry opportunity; alert on-call if still incomplete |

The admin UI's "Next expected refresh" field shows this schedule as **configured** — it is
static configuration the app documents, not something it can observe a live scheduler doing.

## Manual admin run

`/[locale]/admin/market-data` → **Run market import** opens a confirmation panel (target date,
all-active-securities or a selected ticker list, dry-run toggle, collapsed concurrency option)
before anything happens. It calls the same `runDailyIngestion` pipeline as the CLI — there is no
separate browser-side ingestion path. The provider is always resolved server-side; the UI never
lets an operator choose it, so it cannot select `bvc_public_testing` in production even by
mistake.

## CLI reference

```sh
pnpm market:daily -- --date 2026-09-01
pnpm market:daily -- --ticker IAM
pnpm market:daily -- --tickers IAM,ATW,BCP
pnpm market:daily -- --dry-run
pnpm market:daily -- --retry-failed
pnpm market:daily -- --retry-failed --date 2026-09-01
pnpm market:daily -- --concurrency 3
```

- `--date` defaults to today in Africa/Casablanca.
- `--dry-run` fetches and validates but writes nothing — no run row is created either, since
  there is nothing durable to record. Use it to sanity-check provider connectivity.
- `--retry-failed` finds the most recent `partial`/`failed` run (scoped to `--date` if given,
  optionally further scoped by `--ticker(s)`), and reprocesses **only** the tickers/index codes
  that failed in it. It creates a new run row linked to the original via `parent_run_id`;
  already-published data from the original run is never re-touched.
- `--concurrency` is capped at 5 (default 2) to avoid hammering the provider.

## Provider configuration

Set `MARKET_INGESTION_PROVIDER` to exactly one of:

- `bvc_public_testing` — the public Bourse de Casablanca website connector. **Local/private
  testing only.** Requires `BVC_PUBLIC_TESTING_ENABLED=true` as well. See
  [BVC_PUBLIC_TESTING.md](./BVC_PUBLIC_TESTING.md) for the legal boundary — technical
  accessibility does not imply redistribution rights.
- `licensed_api` / `licensed_sftp` — reserved for a real licensed market-data feed. **No
  adapter is implemented yet** (there is no licensed vendor contract in this codebase); selecting
  either currently fails fast with `PROVIDER_NOT_CONFIGURED`. Wiring a real integration is a
  prerequisite for production activation — see the "Production" section below.

## Production safety

- If `NODE_ENV=production` and `MARKET_INGESTION_PROVIDER=bvc_public_testing`, the pipeline
  refuses to start (`PRODUCTION_REFUSES_BVC_PUBLIC_TESTING`) — no exceptions, no override flag.
- There is no fallback path in the code from a licensed provider to `bvc_public_testing`. A
  licensed-provider failure is a failed run, never a silent downgrade.
- Provider credentials are never included in API responses, run records, or logs — only the
  provider _id_ (e.g. `licensed_api`) is ever surfaced.

## Stale-data interpretation

One shared calculation (`computeExpectedLatestMarketDate` / `isMarketDateStale` in
`packages/market-data/src/staleness.ts`) is used by the CLI summary, `/api/health`, and the
admin UI — there is exactly one definition of "stale," not three. It:

- Uses Africa/Casablanca.
- Never treats a weekend date as itself "expected" — Saturday/Sunday are skipped when computing
  the most recent trading day.
- Only expects a business day's data once past a post-market cutoff (19:30 by default, after the
  last scheduled retry window). Before the cutoff, the previous business day is still expected.

`HEALTHY` = last run succeeded and both latest equity/index dates are not stale. `STALE` = last
run succeeded but a date has fallen behind the expected trading day. `PARTIAL`/`FAILED` reflect
the last run's own status directly.

## Investigating failed instruments

Open the run from **Recent runs** (or `/[locale]/admin/market-data/runs/[runId]` directly). The
**Failed instruments** table lists, per instrument: ticker, pipeline stage (security master /
index master / index history / OHLCV), the date or range attempted, a short error code (e.g.
`BVC_HTTP_403`, `BVC_INVALID_RESPONSE`, `UNKNOWN_TICKER`, `PROVIDER_NOT_CONFIGURED`), a
human-readable message, and how many attempts were made. Raw stack traces are never stored or
shown — only sanitized, capped error messages.

From a `partial`/`failed` run, **Retry failed instruments** shows exactly how many instruments
will be retried, then calls the same pipeline scoped to just those instruments.

## Incident recovery / provider outage procedure

If the provider (public or licensed) is rejecting requests — e.g. a WAF blocking the BVC public
endpoint, or a licensed feed outage:

1. The current run finalizes as `partial` or `failed`; it never corrupts or duplicates
   previously published data (idempotent upserts + append-only run history).
2. Confirm existing data is intact: check the admin page's **Coverage** section for
   `FAILED LAST RUN` markers (does not mean the underlying price data is wrong — it means the
   _last_ run couldn't refresh that ticker) versus `STALE`/`NO PRICE HISTORY`.
3. Retry once the provider recovers: `pnpm market:daily -- --retry-failed` (or the admin UI
   button). This only touches the tickers/indices that actually failed.
4. If the outage persists past the last scheduled retry window (19:30), the admin health header
   will show `PARTIAL`/`FAILED` with a non-zero failure count — treat this as the operational
   alert signal; there is no separate paging integration built into this milestone.
5. Do not switch providers mid-incident by editing `MARKET_INGESTION_PROVIDER` without also
   reviewing the safety rules above (e.g. never point production at `bvc_public_testing`).

## Health endpoint

`GET /api/health` (unauthenticated) includes a minimal `marketData` block: status, latest
equity/index dates, last run status/time, a failed-instrument _count_ (not the failures
themselves), and computed staleness. No secrets, no stack traces, no per-instrument detail — for
that, use the admin UI, which is `data_admin`-gated.
