# BVC public testing connector

SaifInvest includes disabled-by-default, server-side adapters for selected first-party public Bourse de Casablanca website interfaces.

## Boundary

This connector exists to validate the SaifInvest market-data pipeline in a private development/staging environment. It is not evidence of a redistribution licence and must not be treated as the production market-data agreement.

**Technical accessibility does not imply commercial redistribution rights.**

Enable it only with:

```env
BVC_PUBLIC_TESTING_ENABLED=true
```

All BVC calls are server-side and require an authenticated SaifInvest `data_admin`. There are no direct browser-to-BVC requests and no background polling.

The private testing workflow intentionally distinguishes between:

- **security/index reference data:** preview first, then an explicit `data_admin` apply action to the private test database;
- **equity price history:** preview first, then an explicit stage action into the existing market-price ingestion run; a distinct second `data_admin` is still required to approve/publish prices;
- **latest index snapshot:** preview only.

Nothing is persisted merely by opening a page or requesting a preview.

## Confirmed first-party interfaces

| Purpose                     | Interface                                                                  | SaifInvest use                                                                                     |
| --------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Equity historical OHLCV     | `GET https://www.casablanca-bourse.com/api/boursenova/stock-historical`    | Bounded private-test preview/staging for one ticker/date range.                                    |
| Security master             | `GET https://www.casablanca-bourse.com/en/marches-produits/actions`        | Parses embedded Drupal settings `boursenova.actions`; no separate API is assumed.                  |
| Index master                | `GET https://www.casablanca-bourse.com/en/market-data/indices`             | Parses embedded Drupal settings `boursenova.indices.main` and `boursenova.indices.grouped_others`. |
| Index history               | `GET https://www.casablanca-bourse.com/api/boursenova/indices/historical`  | Bounded private-test history for supported MASI-family codes.                                      |
| Index composition inventory | `GET https://www.casablanca-bourse.com/api/boursenova/indices/composition` | Confirmed first-party inventory; not used for automatic publication.                               |
| Latest market page          | `GET https://www.casablanca-bourse.com/en/live-market/indices`             | Parses embedded `live_market` settings as latest available/delayed public-site snapshot only.      |

## Supported index codes

The index testing adapter intentionally whitelists the main MASI-family codes observed in the first-party settings:

- `MASI`
- `MSI20` — MASI 20
- `ESGI` — MASI ESG
- `MASIMS` — MASI Mid and Small Cap

## Normalization

Historical equity sessions normalize:

- BVC `seance` (`DD/MM/YYYY`) to the canonical market date;
- `ouverture` to open;
- `plusHaut` to high;
- `plusBas` to low;
- `dernierCours` to close;
- `titresEchanges` to traded-share volume.

Security-master rows normalize, when actually supplied:

- `ticker` to uppercase ticker;
- `instrument`/`emetteur` to display/issuer name;
- `codeISIN` to ISIN;
- `secteur` to sector;
- `categorie` and `compartiment` to reference metadata;
- `nombreTitres` to an exact whole-number share count;
- the upstream record identifier to `sourceId` for provenance.

The normalized security CSV parser preserves these optional BVC metadata fields rather than dropping them during a review/re-import cycle.

Index history normalizes:

- `seance` (`DD/MM/YYYY`) to the canonical market date;
- `indices[code].valeur` to close;
- `indices[code].plusHaut` and `plusBas` to high/low;
- `indices[code].variation` to daily change percent;
- `indices[code].variationYTD` to year-to-date change percent.

The BVC timestamp is retained as source metadata in the in-memory preview but is **not** used as the canonical trading date because its UTC representation can fall on the preceding calendar day.

## Equity-history range behavior

A single request remains limited to 400 calendar days. The private testing UI can optionally request up to roughly three years (maximum 1,100 calendar days); SaifInvest splits that range into sequential windows of at most 390 days, performs bounded requests, deduplicates `(ticker, trading_date)`, sorts the combined result, and stages one normalized candidate set.

This is intentionally sequential and bounded rather than a high-concurrency crawler.

## Persistence and publication

### Security master

`preview` performs a read-only BVC fetch and normalization. `apply` invokes the protected `upsert_market_security_master` RPC and is restricted to `data_admin` users in an environment where BVC testing is explicitly enabled.

### Index master/history

`preview` is read-only. Explicit `apply` actions invoke the protected index RPCs for the private test database. These observations are suitable for local/staging valuation and MASI price-index benchmark testing only.

### Equity prices

`preview` is read-only. `stage` creates an existing private market-price ingestion run. A different `data_admin` must approve the run before the normalized prices become published/provisional public-safe rows.

## Safety

- Server-side only and `data_admin` protected.
- Disabled unless the explicit environment flag is enabled.
- No background polling or aggressive crawling.
- No automatic action on preview.
- Equity history single-window requests are limited to 400 calendar days.
- Extended equity history is limited to 1,100 calendar days and split into bounded sequential windows.
- Index history custom date windows are bounded.
- Overlapping sessions are deduplicated by ticker and trading date.
- Invalid/missing closes and impossible OHLC relationships are rejected or quarantined in normalization logic.
- Unit tests use representative/captured payloads and do not require live BVC internet access.

## Production

For a public commercial deployment, replace or authorize this testing path with an appropriate licensed feed/redistribution agreement while keeping the same normalization, provenance, validation, review, and publication boundary.
