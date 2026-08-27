# BVC Portfolio

An early-stage, bilingual portfolio accounting and analysis application for Casablanca Stock Exchange equities. Development uses clearly labelled synthetic data and administrator-supplied CSV files only. It is not licensed for public market-data redistribution or production use.

## Local checks

Requires Node 22+, pnpm 10+, Docker, and a local Supabase CLI for database integration tests.

```bash
pnpm install
pnpm check
```

Copy `.env.example` to `.env.local` and provide a local Supabase project before exercising authentication. Never commit environment values.

The authoritative source documents are preserved under `MVP_BVC_Engineering_Pack/`.

## Portfolio-state accounting

`public.transactions` is the sole accounting source of truth. The portfolio engine replays that
immutable ledger in effective-time, ledger-sequence order using exact decimal arithmetic and the
weighted-average-cost method. Purchases add gross amount, fees, and taxes to cost basis; sales
remove `average cost × quantity`, add net proceeds to cash, and realize `net proceeds − disposed
cost`. Deposits/dividends increase cash (dividends net of withholding tax), while withdrawals,
standalone fees, and standalone taxes reduce it.

Reversal rows are economic counter-entries. Their effective time is the later of their recorded
time and settlement date, so an `as_of` query before a correction retains the original historical
state. A replacement linked to that correction follows the same visibility rule. Other manual and
imported transactions become effective on settlement date and share identical economics.

`analytics.portfolio_state_snapshots` and its normalized position rows are derived caches, never
authoritative data. Transaction commands enqueue `private.outbox` work. The worker claims work with
`FOR UPDATE SKIP LOCKED`, captures an immutable ledger-sequence boundary, replays all rows through
the canonical engine, and atomically replaces the current snapshot. Portfolio locking, a single
active-run constraint, boundary comparisons, and transactional parent/child insertion prevent
concurrent, stale, or partial generations. Failures retain the previous snapshot and unlock the job
for retry. Owners have read-only RLS access; only the service worker can claim or commit generations.
