# Company documents (annual reports)

An official-document layer that indexes annual-report **metadata** for the full issuer universe
(listed and unlisted) and exposes it on both the issuer-centric `/companies/[slug]` page and,
for listed issuers, the existing Security Detail page. See `docs/ISSUER_MODEL.md` for the
broader issuer/security split this belongs to. This milestone covers `annual_report` only; the
schema is deliberately shaped to support other document types and a later PDF-archival phase
without changing shape.

## Canonical source

`ammc_public_documents` — the public issuer financial-statements directory on the AMMC
(Autorité Marocaine du Marché des Capitaux) website, the Moroccan capital-markets regulator.
IDBourse and any other unofficial mirror are not used. No anti-bot bypass: requests are
hostname-restricted to `www.ammc.ma`, use a normal browser user-agent, and are paced with a
delay between requests (see `packages/annual-reports/src/ammc-fetch.ts`). A transient
network-level failure (the request never completing — not a non-2xx response) is retried up to 3
times with exponential backoff, mirroring `@bvc/market-ingestion`'s existing `withRetry`
convention; this is resilience against an occasional dropped connection during a long crawl, not
a faster or more aggressive request pattern.

Verified site shape (real, not assumed):

- `/fr/liste-etats-financiers-emetteurs` is a Drupal Views listing filterable by
  `field_emetteur_target_id_verf` (a numeric AMMC issuer id, not a slug).
- **Filtering by a single issuer returns every report type mixed together** — annual, half-year,
  consolidated, standalone/"social". The listing URL is never annual-only by itself; the "Type
  rapport" column text is the only reliable classifier (`classifyAmmcReportType` in
  `packages/market-data/src/ammc-reports.ts` matches `annuel` vs `semestr`).
- Each row links to a document detail page with a small field table (Emetteur, Année, Rapports
  financiers, Pièce jointe) and **one or more PDF attachments** — a single detail page can carry
  a plain annual report plus a separate "document d'enregistrement universel". Neither the detail
  page URL nor the attachment URL is a reliable identity alone — see "Filing identity" below.
- The per-issuer listing is **paginated**, and older filings live on later pages: a company with
  many years of history spans more than one page. A page past the end of the real data returns
  HTTP 200 with an empty table (verified live), not a 404 — `syncAnnualReports()` walks pages
  until one comes back empty, which is the correct, non-error end-of-pagination signal.
- The "Année" field is the fiscal year AMMC tags the filing under, not a genuine publication
  date (it is often stamped to the last days of that same fiscal year, before a real annual
  report could exist) — never used as `publication_date`, which stays `null` for AMMC-sourced
  rows rather than being guessed.
- The full directory (`market.issuers.ammc_issuer_id` matched or not) is much larger than the
  BVC-listed universe: foreign cross-listings (`AIR LIQUIDE ( France)`, `TOTAL (France)`, ...),
  Moroccan public entities and financial institutions with no listed equity, and historical
  issuers. `docs/ISSUER_MODEL.md` covers how these become first-class, non-fake issuer records
  instead of being discarded.

## Schema

`supabase/migrations/202609060001_company_documents.sql` (original),
`202609070002_issuer_owned_documents_fundamentals.sql` / `202609070003_issuer_admin_rpcs.sql`
(issuer-ownership migration), and `202609070006_document_filing_identity.sql` (filing-identity
fix) together define:

- `market.company_documents` — one row per official document, owned by `issuer_id` (not
  `security_id` — an unlisted issuer has no security to attach to). Idempotency key is
  `(source_provider_id, source_record_url, source_url)`, **not** `(issuer_id, document_type,
fiscal_year)` (a single issuer/year can have more than one distinct annual-report attachment)
  and **not** `(source_provider_id, source_url)` alone (see "Filing identity" below). For
  `admin_manual` rows, which have no separate detail page, `source_record_url` is always set
  equal to `source_url` — the single URL an admin enters already is the record's identity.

### Filing identity

A FILE is not a FILING. `source_url` is the downloadable PDF asset; `source_record_url` is the
stable AMMC _filing/detail-page_ URL (`/fr/espace-emetteurs/etats-financiers/<slug>`) the asset
was found on. They are tracked separately because AMMC's real data breaks the assumption that one
PDF URL means one filing: **the same PDF can legitimately be attached to two distinct filing
records** — observed live for Meditelecom, whose 2015 and 2017 "Rapports sociaux annuels" filings
both attach the identical PDF. Keying uniqueness on `source_url` alone would silently collapse
those into one row and lose a real filing; keying it on the pair preserves both, while a detail
page carrying more than one attachment (an annual report plus a separate universal registration
document) still gets one row per attachment, and the exact same filing discovered twice (e.g. a
listing/pagination overlap) still collapses to one row. `packages/annual-reports/src/sync.ts`
dedupes its persist batch on this same `(sourceRecordUrl, sourceUrl)` pair — never `sourceUrl`
alone — before calling the store, since a single upsert statement can only touch one conflict
target once; a true duplicate found this way is recorded as a non-fatal `document_duplicate`
sync failure, never as a reason to fail the run. Rows persisted before this fix have
`source_record_url = null` (the detail-page URL was never captured); the next sync's persist step
(`upsertDocumentRows` in `store.ts`) reclaims each one in place by `(issuer_id, source_url,
fiscal_year)` — the same triple that already uniquely identified it under the old constraint —
before falling back to inserting any genuinely new filing.

- `market.ambiguous_document_issuers` — AMMC issuers whose normalized name collided with **more
  than one** existing SaifInvest issuer during a sync (never auto-resolved), with a `status`
  (`open` / `resolved` / `ignored`) an admin sets via `/[locale]/admin/reports`. An AMMC issuer
  with **no** existing match at all is not an error here -- it is simply created as a new
  unlisted/foreign issuer (see `docs/ISSUER_MODEL.md`).
- `market.document_sync_runs` — append-only audit trail of every `syncAnnualReports()`
  invocation (CLI or admin-triggered): issuer-level counts (discovered/existing/created/
  ambiguous/linked/unlisted/with-reports/without-reports) and document-level counts, no raw HTML
  persisted.
- `public.security_company_documents` — the listed-security read view (security → issuer join,
  published rows only). `public.issuer_company_documents` — the issuer-level equivalent, used by
  `/companies/[slug]` for both listed and unlisted issuers. Neither exposes admin/audit/
  matching-confidence fields. `source_provider_id` **is** exposed (unlike admin notes or sync
  errors) so the UI can render a human attribution label; see "Provenance" below.

No RLS policies are defined on the base tables — as with `market.fundamentals`, every grant is
revoked and all access is mediated through the views (reads) and the `SECURITY DEFINER` RPC
functions (writes), each independently re-checking `private.has_role('data_admin')`.

## Issuer matching

Deterministic, two-priority, never-guess (see `packages/annual-reports/src/matching.ts`):

1. **`ammc_issuer_id`** already set on an existing `market.issuers` row — highest priority,
   survives AMMC renaming its display text. Set either by an admin (`upsert_issuer_ammc_link`)
   or automatically the first time priority 2 resolves an issuer, so a re-sync never needs to
   re-walk the name match.
2. **Exact normalized name** (`normalizeAmmcIssuerName` in `@bvc/market-data/ammc-reports`) —
   only resolved when it matches **exactly one** existing issuer; a collision with more than one
   is `ambiguous`, never resolved by guessing.
3. **No match at all** — a brand-new issuer is created (`unlisted_company`, or `foreign_issuer`
   when a recognized country marker like `(France)` is detected), not treated as an error. See
   `docs/ISSUER_MODEL.md`.

`normalizeAmmcIssuerName` deliberately does **not** strip "MAROC"/"MOROCCO": AMMC lists both a
foreign parent and its Moroccan subsidiary as distinct issuers for several names (e.g. `HOLCIM`
vs `HOLCIM MAROC`, `TOTAL (France)` vs `TotalEnergies Marketing Maroc`) — stripping it would
silently collide two different companies.

## Sync pipeline

One canonical implementation, `syncAnnualReports()` in `packages/annual-reports/src/sync.ts`,
used identically by the CLI and the admin "Sync now" button — issuer-driven: it walks the AMMC
issuer directory, resolves (or creates) an issuer for each entry, and only for a non-ambiguous
issuer fetches its listing, keeps annual rows, fetches each detail page, and probes each
attachment with an HTTP `HEAD` request (existence + exact `Content-Length`; the PDF body is
never downloaded — see "Not mirroring PDFs" below). `--dry-run` skips the `HEAD` probe too (pure
discovery/classification preview).

```
pnpm reports:sync                    # every AMMC issuer: resolve/create + sync its reports
pnpm reports:sync -- --ticker IAM    # one listed security (resolves its issuer's AMMC entry)
pnpm reports:sync -- --year 2025     # every issuer, keeping only fiscal year 2025
pnpm reports:sync -- --dry-run       # full discovery/classification, zero persistence
```

`--ticker` and `--year` cannot be combined. A `--ticker` run for a security whose issuer has no
resolvable AMMC entry fails clearly (`resolve_ticker` / `NO_AMMC_ISSUER_MATCH`) instead of
silently doing nothing.

An issuer with zero annual reports at AMMC is `issuersWithoutReports`, not a failure —
`failures` only ever holds genuine fetch/parse errors (`listing`, `detail_fetch`,
`detail_parse`, `issuer_sync`, `create_issuer`, `persist`).

Persistence goes through `PgReportsStore` (a direct `WORKER_DATABASE_URL` connection, same
pattern as `@bvc/market-ingestion`'s `PgIngestionStore` — bypasses RLS as a trusted internal
worker, not through PostgREST). A `--dry-run` never creates a `document_sync_runs` row, never
creates an issuer, and never calls any write path.

## Not mirroring PDFs (yet)

`source_url` points directly at the official AMMC attachment. The product Download button links
there with `target="_blank" rel="noopener noreferrer"` — SaifInvest never proxies or stores the
PDF body this milestone (avoids storage/egress cost, preserves official provenance, avoids an
unintended redistribution layer). `checksum` stays `null` for the same reason: without
downloading the body there is nothing honest to hash. The schema already has the columns a later
binary-archival phase would need.

## Provenance in the UI

The public views expose `source_provider_id`, but the UI never prints the raw string. It maps to
a human label (`sourceLabel()` in `security-annual-reports-section.tsx`, mirroring the existing
`providerLabel()` pattern for market-data providers): `ammc_public_documents` → "AMMC",
`admin_manual` → "SaifInvest".

## Manual fallback

`/[locale]/admin/reports` also has a manual entry form (`upsert_company_document_manual`,
always `source_provider_id = 'admin_manual'`) for when AMMC sync cannot find or match a report —
it accepts either an `issuer_id` directly or a `security_id` (resolved server-side to that
security's issuer), so coverage does not depend entirely on the AMMC page structure never
changing, and works for issuers with no listed security too.

## Future: fundamentals extraction

Deliberately out of scope for this milestone. `company_documents` is shaped so a later phase can
treat an indexed annual-report PDF as the trusted source for a
`PDF → extraction → normalized draft fundamentals → admin review → publication` pipeline, but no
extraction of any kind runs today.
