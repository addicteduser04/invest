# BVC public testing connector

SaifInvest includes disabled-by-default, server-side adapters for selected first-party public Bourse de Casablanca website interfaces.

## Boundary

This connector exists to validate the SaifInvest market-data pipeline in a private development/staging environment. It is not evidence of a redistribution licence and must not be treated as the production market-data agreement.

Technical accessibility does not imply commercial redistribution rights.

Enable it only with:

```env
BVC_PUBLIC_TESTING_ENABLED=true
```

All BVC calls are server-side, authenticated as a SaifInvest `data_admin`, and read-only. The testing routes return normalized previews or CSV files; they do not write to Supabase and do not publish prices automatically.

## Confirmed First-Party Interfaces

The following interfaces were discovered from the current Bourse de Casablanca public website and its first-party JavaScript/settings payloads:

| Purpose                     | Interface                                                                  | SaifInvest use                                                                                       |
| --------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Equity historical OHLCV     | `GET https://www.casablanca-bourse.com/api/boursenova/stock-historical`    | Bounded testing CSV export for one ticker and date window.                                           |
| Security master             | `GET https://www.casablanca-bourse.com/en/marches-produits/actions`        | Parses the embedded Drupal settings `boursenova.actions` array. No separate API endpoint is assumed. |
| Index master                | `GET https://www.casablanca-bourse.com/en/market-data/indices`             | Parses embedded Drupal settings `boursenova.indices.main` and `boursenova.indices.grouped_others`.   |
| Index history               | `GET https://www.casablanca-bourse.com/api/boursenova/indices/historical`  | Bounded testing CSV export for supported MASI-family index codes.                                    |
| Index composition inventory | `GET https://www.casablanca-bourse.com/api/boursenova/indices/composition` | Documented as confirmed accessible first-party inventory; not used for publication.                  |
| Latest market page          | `GET https://www.casablanca-bourse.com/en/live-market/indices`             | Parses embedded `live_market` settings as latest available/delayed public-site snapshot only.        |

## Supported Index Codes

The index testing adapter intentionally whitelists the main MASI-family codes observed in the current first-party index settings:

- `MASI`
- `MSI20` for MASI 20
- `ESGI` for MASI ESG
- `MASIMS` for MASI Mid and Small Cap

## Normalization

Historical equity sessions normalize:

- BVC `seance` (`DD/MM/YYYY`) to the canonical market date.
- `ouverture` to open.
- `plusHaut` to high.
- `plusBas` to low.
- `dernierCours` to close.
- `titresEchanges` to traded-share volume.

Security-master rows normalize:

- `ticker` to uppercase ticker.
- `instrument`/`emetteur` to display name.
- `codeISIN` to ISIN.
- `secteur` to sector.
- `categorie` and `compartiment` to reference metadata.
- `nombreTitres` to an exact decimal share count.

Index history normalizes:

- `seance` (`DD/MM/YYYY`) to the canonical market date.
- `indices[code].valeur` to close.
- `indices[code].plusHaut` and `plusBas` to high/low.
- `indices[code].variation` to daily change percent.
- `indices[code].variationYTD` to year-to-date change percent.

The BVC timestamp is retained as source metadata in the in-memory preview but is **not** used as the canonical trading date because its UTC representation can fall on the preceding calendar day.

## Safety

- Server-side and `data_admin` only.
- Disabled unless the explicit environment flag is enabled.
- No automatic database persistence.
- No automatic publication.
- No background polling.
- Equity history requests are limited to 400 calendar days.
- Index history custom date windows are limited to 1100 calendar days.
- Overlapping sessions are deduplicated by ticker and trading date.
- Invalid/missing closes and impossible OHLC relationships are rejected or quarantined in preview logic.
- Unit tests use captured payloads and do not call live BVC.

## Production

For a public commercial deployment, replace this testing path with an authorized/licensed feed and keep the same normalized validation/publication boundary.
