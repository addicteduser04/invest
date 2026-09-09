# DCF / Intrinsic valuation

A transparent, assumption-driven Discounted Cash Flow module. It answers "what is this company
worth under these explicit assumptions?" — it is not an automated investment recommendation, a
factor score, or a backtest. See `docs/PEER_COMPARISON.md`-style precedent
(`docs/FUNDAMENTALS.md`) for the layering convention this module follows: pure calculation
modules, a read model, and a UI layer that never computes finance itself.

## Methodology (FCFF / enterprise-value)

```
FCFF   = EBIT * (1 - tax rate) + D&A - Capex - Change in NWC
PV(t)  = FCFF_t / (1 + WACC)^t                        (year-end discounting, t = 1..N integers)
TV     = FCFF_(N+1) / (WACC - g),  FCFF_(N+1) = FCFF_N * (1 + g)
PV(TV) = TV / (1 + WACC)^N

Enterprise value = sum(PV(t), t=1..N) + PV(TV)
Net debt         = total debt - cash
Equity value     = Enterprise value - Net debt
Value per share  = Equity value / shares outstanding
```

All of this lives in `apps/web/lib/dcf-model.ts` (`projectDcf` for the pure per-year forecast and
bridge, `terminalValue` for Gordon Growth, `runDcf` as the validate-then-project orchestrator). No
finance formula is duplicated in a React component.

**Flat assumptions, not a year-by-year grid.** Every rate assumption (revenue growth, EBIT
margin, tax rate, D&A/capex/ΔNWC as % of revenue) is a single number applied uniformly across the
whole forecast horizon — not a separate value per year. Revenue still compounds year over year;
only the _rate_ is held flat. This keeps the assumption editor a short, auditable list instead of
an N-column grid, matching the product's "do not over-engineer" guidance. A future milestone could
allow per-year overrides without changing the engine's shape.

**Discounting convention.** Year-end discounting only (`PV = CF_t / (1+WACC)^t`, integer `t`). No
mid-year convention is applied.

**Tax on a forecast loss.** If a forecast year's EBIT is negative, tax is clamped to 0 (no tax
benefit/refund is credited) rather than going negative — a deliberate, conservative modeling
choice, not a bug.

## Schema: minimal extension to `market.fundamentals`

`supabase/migrations/202609040001_dcf_valuation.sql` adds four nullable, unconstrained (sign-wise)
`numeric(20,6)` columns anticipated by the original fundamentals design: `depreciation_amortization`,
`tax_expense`, `working_capital`, `change_in_working_capital`. Same null-vs-zero discipline as
every other fundamentals column — a blank CSV cell is `null`, never `0`. `apply_fundamentals_import`,
`public.security_fundamentals`, and the CSV import parser (`packages/market-data/src/fundamentals-import.ts`)
were all re-published/extended to carry the four fields end to end; a CSV uploaded before they
existed still parses (`relax_column_count`), and the new columns remain fully optional. See
`docs/FUNDAMENTALS.md` for the full schema reference.

## Historical DCF inputs

`apps/web/lib/dcf-inputs.ts` (`readDcfHistoricalInputs` / pure core `buildDcfHistoricalInputs`)
turns `security_fundamentals` rows into a `DcfHistoricalPeriod[]` series plus a single `basePeriod`
— the point-in-time-usable period the forecast's base year defaults from. **PIT selection is
reused unchanged from `valuation-read.ts`'s `selectLatestUsablePeriod`**: a period only counts if
its `publication_date` is known and not in the future; among usable periods, the greatest
`period_end_date` wins. A published FY2025 alongside an unpublished H1 2026 always resolves to
FY2025 as the base year — no new "latest" rule was introduced for DCF.

Each period distinguishes what is directly reported from what is computed:

- **Historical** (straight from the row): revenue, EBIT, EBITDA, D&A, tax expense, operating cash
  flow, capex, working capital, cash, total debt, shares outstanding.
- **Derived**: revenue growth (YoY vs. the prior period of the _same_ `period_type`/
  `interim_period`), EBIT margin, effective tax rate, FCFF.
- **Change in working capital** is the one field with two possible sources, and the period record
  says which: a **historical** value from a directly-reported `change_in_working_capital` cell
  takes priority; otherwise it is **derived** from the current and prior period's `working_capital`
  — but only when both periods share the same `period_type`/`interim_period`, so an annual figure
  is never diffed against an interim one. If neither is available, it stays `null` (never `0`).

## Effective tax rate — never invented from net income alone

```
pre-tax income   = net_income + tax_expense      (an exact identity from two genuine figures)
effective_tax_rate = tax_expense / pre-tax income
```

This is only computed when the CSV actually supplied `tax_expense` for that period. If it wasn't
supplied (the common case today, since it's a brand-new optional field), the rate stays `null` and
the DCF's tax-rate assumption has no historical reference — the user must enter one explicitly.
**A Moroccan statutory corporate tax rate is never hardcoded** as a fallback; issuers do not share
one effective rate.

## Default assumptions — historical-data-derived, or blank

`apps/web/lib/dcf-defaults.ts` (`deriveDcfDefaults`) suggests a default for six assumptions —
revenue growth, EBIT margin, tax rate, D&A/capex/ΔNWC as % of revenue — as the **median** (reusing
`peer-statistics.ts`'s `median`, preferred over mean for its resistance to one unusual year) of up
to the last **3 annual periods** (interim periods are excluded entirely from these medians, to
avoid blending an H1 growth rate against an FY one). If fewer than one usable annual observation
exists for a given field, that default is `null` and the assumption editor shows "no historical
reference available" — it never fabricates a number just to make the model runnable.

**WACC and terminal growth are never defaulted, ever.** They do not appear in `DcfDefaults` at
all. The user must type both in before any valuation number appears, on every scenario, every
time — this is intentional: these two assumptions are not observable in a company's own financial
statements the way a margin or a growth rate arguably is.

## Forecast engine, terminal value, validation

`projectDcf` produces one row per forecast year (revenue, growth, EBIT, EBIT margin, tax, NOPAT,
D&A, capex, change in NWC, FCFF, discount factor, PV of FCFF), then Gordon Growth terminal value
on the final year's FCFF, then the EV → equity → per-share bridge, then
`terminalValueShareOfEv = PV(TV) / EV` — surfaced plainly, never labeled "good" or "bad".

`apps/web/lib/dcf-validation.ts` never lets a raw exception reach the UI. Nine structured codes
(`MISSING_BASE_REVENUE`, `MISSING_SHARES_OUTSTANDING`, `MISSING_WACC`, `MISSING_TERMINAL_GROWTH`,
`WACC_NOT_ABOVE_TERMINAL_GROWTH`, `INVALID_FORECAST_HORIZON`, `NON_FINITE_ASSUMPTION`,
`NEGATIVE_SHARES`, `MISSING_OPERATING_ASSUMPTION`) each carry a `blocking` flag. Only a
share-count problem (missing, zero, or negative) is non-blocking — enterprise and equity value are
still computed and shown; only the per-share line goes unavailable. Everything else blocks the
whole projection, most importantly `WACC <= terminal growth`, which would otherwise divide by zero
or a negative number in the Gordon Growth formula.

## Sensitivity

`apps/web/lib/dcf-sensitivity.ts` builds a 5×5 WACC × terminal-growth grid centered on the current
base-case assumptions (`buildDefaultSensitivityAxes`: ±2/±1/0 steps of 1 percentage point for
WACC, 0.5 percentage point for terminal growth), so the base case always lands in the middle cell.
Every cell reuses `runDcf` — there is no second valuation formula for the grid. A cell where
`WACC <= terminal growth` is never computed; it is marked invalid and rendered as `—`.

## Scenarios

Three named scenarios — Bear / Base / Bull — each an independent, full assumption set (all nine
fields, base revenue/cash/debt/shares included). They start identical (all seeded from the same
historical defaults, WACC/terminal growth blank) and diverge only through explicit user edits, per
the product's "no automatically generated optimistic/pessimistic case" rule.

## Persistence — minimal, deferred beyond the basics

`public.dcf_scenarios` (`id, user_id, security_id, name, assumptions jsonb, created_at,
updated_at`, unique on `(user_id, security_id, name)`) stores a saved scenario as JSONB — the one
place in this schema JSONB is appropriate, since this is user-authored model configuration, not a
canonical financial statement. Row-level security mirrors `public.portfolios`'s existing
`owner_id = auth.uid()` pattern exactly (`for all using(user_id = auth.uid()) with check(...)`,
`anon` revoked entirely). No version history, no sharing, no delete endpoint — saving the same name
again upserts in place. `POST /api/dcf/scenarios` and `GET /api/dcf/scenarios?securityId=` are thin
wrappers; every ownership check is enforced by the RLS policy, not application code.

## Missing-data policy

Never fabricate a historical figure. A security with **no fundamentals at all** still gets a fully
usable, entirely manual DCF: base revenue, cash, debt, and shares outstanding are editable inputs
(defaulting to `null`/blank when no historical base period exists), and every assumption row shows
"no historical reference available" rather than silently substituting a number. A security with
**partial fundamentals** shows whichever historical references exist and leaves the rest blank. A
security with **no current market price** can still produce a full intrinsic value — the
current-price comparison line simply shows "unavailable" instead of a difference.

## Limitations

- Flat (not year-by-year) operating assumptions.
- Year-end discounting only, no mid-year convention.
- No tax shield credited on a forecast operating loss.
- Effective tax rate only available once `tax_expense` is actually imported for a period.
- No multi-stage growth (single explicit horizon + one terminal growth rate).
- No sensitivity axis beyond WACC × terminal growth.
