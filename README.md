# SaifInvest

SaifInvest is a multilingual Moroccan portfolio-tracking, market-research, and investment-analytics application focused on Casablanca Stock Exchange securities.

It is **not a brokerage or custodian**. Real portfolios record transactions already executed through a user's bank or broker; virtual portfolios are simulations. SaifInvest never represents a recorded transaction as an order sent to the market.

## MVP languages

- English
- French
- Arabic (RTL)

## Core MVP

- Supabase authentication, profile and owner-isolated portfolios.
- Real-tracking and virtual portfolio modes.
- Immutable transaction ledger: cash contributions/withdrawals, recorded buys/sells, dividends, fees and taxes.
- Atomic CSV transaction import, immutable reversal and optional replacement.
- Weighted-average-cost accounting and deterministic historical replay.
- Derived portfolio-state snapshots with safe worker locking/retries.
- Exact-decimal current valuation and P&L from published/provisional market prices.
- Historical TWR/XIRR performance endpoints with explicit unavailable states.
- Market directory, security detail and price history with a TradingView Lightweight Charts surface.
- Basic concentration/sector allocation and deterministic portfolio insights.
- Private administrator CSV market-price ingestion with second-admin publication.
- Disabled-by-default BVC public historical testing export for private/staging validation only; it never publishes automatically.

Market/fundamental data that is not actually available is shown as unavailable. The application does not invent PER, ROE, market capitalization, dividends, MASI performance, or other market facts.

## Local setup

Requires Node 22+, pnpm, Docker, and the Supabase CLI for live database integration tests.

```bash
cp .env.example .env.local
pnpm install
pnpm check
```

Never commit environment secrets.

## Accounting source of truth

`public.transactions` is authoritative. The canonical portfolio engine replays immutable transactions using effective time and ledger sequence with exact decimal arithmetic and weighted-average cost. Reversal rows are counter-entries that become visible at correction time, preserving earlier historical truth.

`analytics.portfolio_state_snapshots` and normalized position rows are derived caches only. Worker jobs are claimed with PostgreSQL locking and committed atomically; stale or partial generations cannot replace a newer valid state.

## Market data

Raw market ingestion/admin relations remain private. Public-safe views expose only normalized security metadata and published/provisional price history. Administrator CSV publication requires a distinct second `data_admin`.

Public production launch still requires appropriate rights for any exchange price, historical, fundamental, or benchmark series shown to users. The BVC public testing adapter is intentionally gated by `BVC_PUBLIC_TESTING_ENABLED=true` and is not a substitute for redistribution rights.

Published market-price rows can preserve OHLCV fields for interactive security charts. The charting layer uses TradingView Lightweight Charts while SaifInvest remains responsible for its own normalized market data. See `docs/BVC_PUBLIC_TESTING.md`.

See `docs/MVP_STATUS.md` for the current handoff status and remaining post-MVP work.
