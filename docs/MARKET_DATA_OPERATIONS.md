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
environment (plus `APP_ENV` and `BVC_PUBLIC_TESTING_ENABLED` when the provider is
`bvc_public_testing` outside local development — see "Production safety" below).

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
before anything happens. Confirming **dispatches** the `Market ingestion` GitHub Actions
workflow (see "Executor and run lifecycle" below), which runs `pnpm market:daily` to completion;
the page then picks up the new run and tracks it live. The web app itself never executes
ingestion. The provider is always resolved on the runner from its own environment; the UI never
lets an operator choose it, so it cannot select `bvc_public_testing` in production even by
mistake.

When the deployment has no runner configured (`MARKET_INGESTION_DISPATCH_*` unset), the button
and the retry action are hidden and the API routes answer `503 EXECUTOR_NOT_CONFIGURED` — they
never create a run that nothing will execute.

## Executor and run lifecycle

**Executor.** `.github/workflows/market-ingestion.yml` (`workflow_dispatch`) is the only place
ingestion runs outside a developer's terminal. Its inputs mirror the CLI (`date`, `tickers`,
`dry_run`, `concurrency`, `retry_run_id`, `recover_stale_only`). It runs only in the GitHub
**environment** `staging`: the job pins `environment: staging`, the `environment` input is a
`choice` whose sole option is `staging`, and a guard step fails the job unless `APP_ENV` is
`staging`. No other environment's credentials can be selected. The environment must define:

| Kind     | Name                         | Staging value                            |
| -------- | ---------------------------- | ---------------------------------------- |
| secret   | `WORKER_DATABASE_URL`        | the staging project's session pooler URL |
| variable | `APP_ENV`                    | `staging`                                |
| variable | `MARKET_INGESTION_PROVIDER`  | `bvc_public_testing`                     |
| variable | `BVC_PUBLIC_TESTING_ENABLED` | `true`                                   |

The web deployment dispatches it with `MARKET_INGESTION_DISPATCH_TOKEN` (fine-grained token,
this repository only, "Actions: read and write"), `MARKET_INGESTION_DISPATCH_REPOSITORY`,
`MARKET_INGESTION_DISPATCH_ENVIRONMENT` (must be `staging`) and optionally `MARKET_INGESTION_DISPATCH_REF`
(default `main`). The workflow must exist on that ref before it can be dispatched.

**Terminal states.** Every run that reaches the pipeline is finalized as `succeeded`, `partial`
or `failed`:

- Provider/instrument errors are recorded per instrument and decide `partial` vs `failed`.
- A run-level error (e.g. the database becomes unreachable mid-run) finalizes the run as
  `failed` with a `PIPELINE` entry (`stage: pipeline`, code `PIPELINE_ERROR` unless the error
  carries its own code), then the CLI exits non-zero.
- `SIGINT`/`SIGTERM` (Ctrl-C, a cancelled workflow) mark the in-flight run `failed` with
  `INTERRUPTED` before exiting; the CLI's 40-minute watchdog marks it `failed` with
  `RUN_TIMEOUT` and exits. The workflow's own timeout is 45 minutes.
- Finalization only ever moves a run out of `running`; it never overwrites a terminal state.

**Stale-run recovery.** None of the above can run if the process is killed outright (runner
lost, `SIGKILL`, host crash). Because every executor is bounded to ~45 minutes, a run still
`running` after **90 minutes** cannot be live. Every non-dry-run ingestion first marks such runs
`failed` (`STALE_RUN_RECOVERED`, reason in `metrics.failureReason`, one
`market_ingestion_run.marked_failed` audit event each, existing metrics and failures preserved),
which also frees their date/provider slot. To recover without ingesting:
`pnpm market:daily -- --recover-stale`, or dispatch the workflow with `recover_stale_only`.

**Duplicates.** Two requests for the same date/provider cannot process concurrently: the
workflow's concurrency group serializes runs, the admin route rejects a date
that already has a `running` run (`409 ALREADY_RUNNING`), and the database's
`one_running_ingestion_run_per_date_provider_uq` index rejects a second `running` row outright
(the CLI reports `ALREADY_RUNNING` and exits non-zero without creating a run).

## CLI reference

```sh
pnpm market:daily -- --date 2026-09-01
pnpm market:daily -- --ticker IAM
pnpm market:daily -- --tickers IAM,ATW,BCP
pnpm market:daily -- --dry-run
pnpm market:daily -- --retry-failed
pnpm market:daily -- --retry-failed --date 2026-09-01
pnpm market:daily -- --retry-run 650b1586-07e1-45da-8bcb-98366bcaf3de
pnpm market:daily -- --recover-stale
pnpm market:daily -- --concurrency 3
```

- `--date` defaults to today in Africa/Casablanca.
- `--dry-run` fetches and validates but writes nothing — no run row is created either, since
  there is nothing durable to record. Use it to sanity-check provider connectivity.
- `--retry-failed` finds the most recent `partial`/`failed` run (scoped to `--date` if given,
  optionally further scoped by `--ticker(s)`), and reprocesses **only** the tickers/index codes
  that failed in it. It creates a new run row linked to the original via `parent_run_id`;
  already-published data from the original run is never re-touched.
- `--retry-run <id>` does the same for one specific `partial`/`failed` run (what the admin
  retry action dispatches).
- `--recover-stale` only marks stale `running` runs failed (see above), then exits.
- `--trigger-source schedule|manual|cli` records who initiated the run (default `cli`).
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

- The pipeline classifies which environment it is running as from `APP_ENV` (`local`,
  `staging`, `production`, or `test`) — never from `NODE_ENV` or Vercel's own deployment-type
  metadata. Both of those read `production` for the `saifinvest-staging` Vercel project too (it
  is deployed as a Production-type Vercel deployment, same as real production would be), so
  neither can distinguish staging from real production on its own — `APP_ENV` is the explicit
  signal that does.
- If `APP_ENV=production` (or `APP_ENV` is missing/unrecognized on a deployed build, i.e.
  `NODE_ENV=production` — see `resolveAppEnv` in
  `packages/market-ingestion/src/provider-policy.ts`) and
  `MARKET_INGESTION_PROVIDER=bvc_public_testing`, the pipeline refuses to start
  (`PRODUCTION_REFUSES_BVC_PUBLIC_TESTING`) — no exceptions, no override flag, and
  `BVC_PUBLIC_TESTING_ENABLED` is never consulted in this case.
- `APP_ENV=staging` is the only other environment permitted to use `bvc_public_testing`, and
  still independently requires `BVC_PUBLIC_TESTING_ENABLED=true` — neither flag implies the
  other. The `saifinvest-staging` Vercel project should set all three:
  `APP_ENV=staging`, `MARKET_INGESTION_PROVIDER=bvc_public_testing`,
  `BVC_PUBLIC_TESTING_ENABLED=true`.
- A missing or unrecognized `APP_ENV` outside a deployed build (plain local `pnpm dev`/CLI usage)
  falls back to `local`, preserving the existing local development workflow, which has never
  needed to set `APP_ENV` at all.
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
will be retried, then dispatches the runner (`--retry-run`) scoped to just those instruments.
A run that failed only at the `pipeline` stage has nothing instrument-level to retry — rerun
its date instead (writes are idempotent).

## Incident recovery / provider outage procedure

If the provider (public or licensed) is rejecting requests — e.g. a WAF blocking the BVC public
endpoint, or a licensed feed outage:

1. The current run finalizes as `partial` or `failed`; it never corrupts or duplicates
   previously published data (idempotent upserts + append-only run history).
2. Confirm existing data is intact: check the admin page's **Coverage** section for
   `FAILED LAST RUN` markers (does not mean the underlying price data is wrong — it means the
   _last_ run couldn't refresh that ticker) versus `STALE`/`NO PRICE HISTORY`.
3. Retry once the provider recovers: `pnpm market:daily -- --retry-failed` (or the admin UI
   button, which dispatches the runner). This only touches the tickers/indices that actually failed.
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
