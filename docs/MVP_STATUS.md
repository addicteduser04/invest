# SaifInvest final MVP status

## Product boundary

SaifInvest is a portfolio-tracking, market-research, analytics, and simulation product. It is **not a broker, custodian, bank, or order-execution venue**. A real-tracking portfolio records transactions that already occurred through the user's bank/broker. A virtual portfolio is explicitly a simulation.

## Languages

The MVP supports English, French, and Arabic. Arabic remains RTL and technical/financial values are isolated where needed for readability.

## Final MVP capabilities

- Authentication, password recovery, localized navigation, profiles, and portfolio lifecycle management.
- Real-tracking and virtual portfolio modes.
- Immutable transaction command covering contributions, withdrawals, recorded purchases/sales, dividends, fees, and taxes.
- Transaction CSV preview/confirmation, immutable corrections/reversals, and optional replacements.
- Exact-decimal weighted-average-cost accounting, deterministic historical replay, snapshots, and worker recalculation infrastructure.
- Current portfolio valuation with holdings, cash, market value, realized/unrealized/total P&L, dividends, and stale/missing-price states.
- Historical TWR/XIRR performance with 1M, 3M, YTD, 1Y, 3Y, and since-inception periods.
- MASI **price-index** benchmark calculation when a valid MASI series is available; the UI explicitly does not present it as a total-return benchmark.
- Market directory, security detail pages, OHLCV history, and TradingView Lightweight Charts with close-only fallback.
- MASI-family index overview support when trusted/private-test observations exist.
- Concentration, allocation, volatility/drawdown presentation when supported by the available data, plus deterministic portfolio insights and optional AI explanations.
- Private dual-admin market-price proposal/publication workflow.
- Private/staging BVC testing tools for security master, equity history, index master/history, and latest index snapshots.
- BVC equity-history staging directly into the existing second-admin review workflow; up to roughly three years can be collected in bounded sequential windows.
- Health endpoint at `/api/health`.
- Explicit unavailable states instead of fabricated market/fundamental values.

## Market-data policy

Production market-data rights remain a launch dependency. The public BVC website connectors are disabled by default and are intended only for private development/staging validation. Technical accessibility does not imply commercial redistribution rights.

Security master and MASI-family test data can be applied to a private testing database by an authenticated `data_admin`. Equity price history is staged privately and still requires a distinct second `data_admin` before publication through the existing price-publication workflow.

## Schema checkpoint

The current source contains **18 ordered transactional migrations**, ending with:

`202608280009_market_indices_and_bvc_security_master.sql`

No new migration was required for the final UI/read-path completion pass.

## Validation handoff

The uploaded baseline had already been reported green locally at the 18-migration checkpoint, including:

- market-data tests: 22 passing;
- web tests: 42 passing;
- live PostgreSQL tests: 30 passing;
- fresh `supabase db reset`: passing;
- `pnpm check`: passing;
- `git diff --check`: passing.

This final package adds the direct private BVC apply/stage workflow, bounded multi-window equity-history helper, richer MASI benchmark read path, MASI-family market overview, health endpoint, and documentation/runbook updates. The packaging environment could not reach the npm registry, so the final delta must be rerun through the acceptance sequence in `docs/FINAL_MVP_RUNBOOK.md` before production deployment.

## Intentionally deferred beyond MVP

- Commercial/licensed BVC or other vendor market-data feed and redistribution agreement — the
  daily ingestion pipeline (see [MARKET_DATA_OPERATIONS.md](./MARKET_DATA_OPERATIONS.md)) now
  supports `licensed_api`/`licensed_sftp` as first-class providers, but no adapter is
  implemented for either since no licensed vendor contract exists yet; this remains the actual
  blocker for production activation, not the automation itself.
- MASI total-return series unless a valid source is obtained.
- Full issuer financial-statement ingestion and derived fundamentals such as PER/ROE/EPS.
- Advanced optimization/backtesting/scenario-engine UI.
- Brokerage/custody connections and order execution (outside the SaifInvest product boundary).
- Native mobile applications.
