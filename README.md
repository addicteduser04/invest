# SaifInvest

SaifInvest is a multilingual Moroccan portfolio-tracking, market-research, and investment-analytics application focused on Casablanca Stock Exchange securities.

It is **not a brokerage or custodian**. Real portfolios record transactions already executed through a user's bank or broker; virtual portfolios are simulations. SaifInvest never represents a recorded transaction as an order sent to the market.

## MVP languages

- English
- French
- Arabic (RTL)

## Final MVP scope

- Supabase authentication, profile management, password recovery, and owner-isolated portfolios.
- Explicit real-tracking and virtual/simulation portfolio modes.
- Immutable transaction ledger for cash contributions/withdrawals, recorded buys/sells, dividends, fees, and taxes.
- Atomic CSV transaction import, immutable reversal, and optional replacement.
- Weighted-average-cost accounting and deterministic historical replay with exact-decimal financial arithmetic.
- Derived portfolio-state snapshots with safe worker locking/retries.
- Current valuation with cash, holdings, market value, realized/unrealized/total P&L, dividend income, and explicit missing/stale-price states.
- Historical TWR/XIRR performance with 1M, 3M, YTD, 1Y, 3Y, and since-inception periods.
- MASI price-index benchmark support when trusted/private-test MASI history exists, with an explicit price-index (not total-return) disclaimer.
- Concentration, sector allocation, volatility/drawdown presentation when sufficient data exists, and deterministic portfolio insights.
- Moroccan market directory and security pages with OHLCV history and TradingView Lightweight Charts.
- MASI-family market overview support (MASI, MASI 20, MASI ESG, MASI Mid and Small Cap) when index data exists.
- Private administrator market-price staging with distinct second-admin publication.
- Disabled-by-default BVC public testing connectors for security master, historical equities, and MASI-family indices.
- Optional AI portfolio explanation provider with a deterministic fallback when the external provider is unavailable.
- Health endpoint at `/api/health` for web/database reachability checks.

Market/fundamental data that is not actually available is shown as unavailable. The application does not invent PER, ROE, EPS, dividends, market capitalization, benchmark history, or other market facts.

## Local setup

Requires Node 22+, pnpm, Docker, and the Supabase CLI for live database integration tests.

```bash
pnpm install --frozen-lockfile
supabase start
```

The Next.js app is executed from `apps/web`, so start from its app-specific example and keep the resulting file untracked:

```bash
cp apps/web/.env.example apps/web/.env.local
```

Then set `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` from the local value printed by `supabase status`. For private BVC testing only, set `BVC_PUBLIC_TESTING_ENABLED=true`.

For web-only development:

```bash
pnpm dev:web
```

The root `pnpm dev` also starts the worker and therefore additionally requires the local worker variables documented in `.env.example`.

Never commit environment secrets.

## Validation

The final local acceptance sequence is:

```bash
pnpm --filter @bvc/market-data test
pnpm --filter @bvc/web test
pnpm typecheck
pnpm check:migrations
supabase db reset
pnpm test:database
pnpm check
```

See `docs/FINAL_MVP_RUNBOOK.md` for the complete local bootstrap, private BVC testing flow, and deployment checklist.

## Accounting source of truth

`public.transactions` is authoritative. The canonical portfolio engine replays immutable transactions using effective time and ledger sequence with exact decimal arithmetic and weighted-average cost. Reversal rows are counter-entries that become visible at correction time, preserving earlier historical truth.

`analytics.portfolio_state_snapshots` and normalized position rows are derived caches only. Worker jobs are claimed with PostgreSQL locking and committed atomically; stale or partial generations cannot replace a newer valid state.

## Market data

Raw market ingestion/admin relations remain private. Public-safe views expose only normalized security metadata and published/provisional price history. Administrator price publication requires a distinct second `data_admin`.

For private development/staging, the BVC testing tools can:

- preview and apply the BVC security master to the private test database;
- preview and apply MASI-family index master/history to the private test database;
- fetch a single bounded equity-history window or up to roughly three years through bounded sequential windows;
- stage normalized BVC equity price history into the existing two-admin review/publication workflow.

Public production launch still requires appropriate rights for any exchange price, historical, fundamental, or benchmark series shown to users. `BVC_PUBLIC_TESTING_ENABLED=true` is a private testing mechanism, **not** a redistribution licence.

Published market-price rows preserve OHLCV fields for interactive security charts. The charting layer uses TradingView Lightweight Charts while SaifInvest remains responsible for its normalized market data.

See `docs/BVC_PUBLIC_TESTING.md` and `docs/MVP_STATUS.md`.
