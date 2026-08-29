# SaifInvest MVP completion status

This source package extends the Phase C accounting checkpoint into the user-facing MVP path.

## Product boundary

SaifInvest is a portfolio tracking, market-research, analytics, and simulation product. It is **not a broker, custodian, bank, or order-execution venue**. A real-tracking portfolio records transactions that already occurred through the user's bank/broker. A virtual portfolio is explicitly a simulation.

## Languages

The MVP supports English, French, and Arabic. Arabic remains RTL. Shared error contracts now localize EN/FR/AR and new product pages are authored in all three languages.

## Implemented in this completion pass

- English locale added to profile creation and shared contracts.
- Real-tracking vs virtual portfolio mode stored explicitly.
- Reversal-aware sellable-holdings validation in the transaction command.
- Public-safe market security overview and price-history read models.
- Private, dual-administrator CSV market-price proposal/publication workflow.
- Current portfolio valuation using exact-decimal ledger state plus latest valid price at or before the valuation date.
- Position market value, realized/unrealized/total P&L, price freshness and missing-price states.
- Daily close-to-close TWR and investor-perspective XIRR helpers.
- Performance API, valuation API, market directory and security-detail pages.
- Published OHLCV preservation and TradingView Lightweight Charts integration with close-only fallback.
- Read-only, environment-gated BVC historical testing export based on the supplied BVC browser capture; no automatic persistence/publication.
- Portfolio dashboard with holdings, recent transactions, corrections, CSV import, allocation, concentration and deterministic portfolio insights.
- SaifInvest landing/auth experience and explicit non-broker language.
- MASI benchmark remains deliberately unavailable until a valid benchmark series is supplied.
- Unavailable market/fundamental values are never fabricated.

## Market-data policy

The repository still starts with synthetic securities and supports administrator-supplied CSV prices. Public production launch remains dependent on valid market-data redistribution rights. Raw CSV content proposed through the admin workflow is stored in a private database relation; publication requires a second distinct data administrator.

## Validation status

The baseline MVP was validated in the normal development environment before this market-data/chart slice: `pnpm check` passed, the web package reported 40 tests, and the live database suite reported 30 tests.

This follow-up slice adds the fifteenth migration plus the BVC testing adapter/chart integration. The packaging environment cannot install workspace dependencies, so these newest changes were syntax-transpiled and migration ordering was checked here; rerun `pnpm check`, `supabase db reset`, and `pnpm test:database` after applying this slice.

## Deferred beyond the strict MVP

- Licensed MASI total-return benchmark integration.
- Full fundamental statement ingestion and ratios such as PER/ROE when licensed/reliable source data is available.
- Advanced optimizer/backtesting UI.
- Brokerage/custody connections and order execution (out of product scope).
- Native mobile applications.
