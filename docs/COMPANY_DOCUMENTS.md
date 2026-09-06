# Company documents (annual reports)

An official-document layer that indexes annual-report **metadata** for listed companies and
exposes it on each Security Detail page. This milestone covers `annual_report` only; the schema
is deliberately shaped to support other document types and a later PDF-archival phase without
changing shape.

## Canonical source

`ammc_public_documents` — the public issuer financial-statements directory on the AMMC
(Autorité Marocaine du Marché des Capitaux) website, the Moroccan capital-markets regulator.
IDBourse and any other unofficial mirror are not used. No anti-bot bypass: requests are
hostname-restricted to `www.ammc.ma`, use a normal browser user-agent, and are paced with a
delay between requests (see `packages/annual-reports/src/ammc-fetch.ts`).

Verified site shape (real, not assumed):

- `/fr/liste-etats-financiers-emetteurs` is a Drupal Views listing filterable by
  `field_emetteur_target_id_verf` (a numeric AMMC issuer id, not a slug).
- **Filtering by a single issuer returns every report type mixed together** — annual, half-year,
  consolidated, standalone/"social". The listing URL is never annual-only by itself; the "Type
  rapport" column text is the only reliable classifier (`classifyAmmcReportType` in
  `packages/market-data/src/ammc-reports.ts` matches `annuel` vs `semestr`).
- Each row links to a document detail page with a small field table (Emetteur, Année, Rapports
  financiers, Pièce jointe) and **one or more PDF attachments** — a single detail page can carry
  a plain annual report plus a separate "document d'enregistrement universel", so the attachment
  URL, not the detail page URL, is the true per-document identity.
- The "Année" field is the fiscal year AMMC tags the filing under, not a genuine publication
  date (it is often stamped to the last days of that same fiscal year, before a real annual
  report could exist) — never used as `publication_date`, which stays `null` for AMMC-sourced
  rows rather than being guessed.

## Schema

`supabase/migrations/202609060001_company_documents.sql` adds:

- `market.company_documents` — one row per official document. Idempotency key is
  `(source_provider_id, source_url)`, **not** `(security_id, document_type, fiscal_year)`,
  because a single issuer/year can have more than one distinct annual-report attachment.
- `market.company_document_aliases` — the explicit, admin-maintained issuer→security mapping
  (priority-1 matching signal), unique per `(security_id, source_provider_id)` and per
  `(source_provider_id, source_issuer_id)`.
- `market.unmatched_document_issuers` — AMMC issuers a sync run could not attach to any
  security, with a `status` (`open` / `resolved` / `ignored`) an admin can set; re-syncing an
  issuer that is still unmatched only refreshes `last_seen_at`, never resets that decision.
- `market.document_sync_runs` — append-only audit trail of every `syncAnnualReports()`
  invocation (CLI or admin-triggered), counts only, no raw HTML persisted.
- `public.security_company_documents` — the product-safe read view: published rows only, no
  admin/audit/matching-confidence fields. `source_provider_id` **is** exposed (unlike admin
  notes or sync errors) so the UI can render a human attribution label; see "Provenance" below.

No RLS policies are defined on the four base tables — as with `market.fundamentals`, every
grant is revoked and all access is mediated through the view (reads) and the `SECURITY DEFINER`
RPC functions below (writes), each independently re-checking `private.has_role('data_admin')`.

## Issuer matching

Deterministic, two-priority, never-guess:

1. **Alias** (`market.company_document_aliases`, keyed by the AMMC issuer id) — highest
   priority, survives AMMC renaming its display text.
2. **Exact normalized name** (`normalizeAmmcIssuerName` in `@bvc/market-data/ammc-reports`) —
   only resolved when it matches **exactly one** security; two securities colliding on the same
   normalized name is treated as unmatched, not resolved by guessing.

`normalizeAmmcIssuerName` deliberately does **not** strip "MAROC"/"MOROCCO": AMMC lists both a
foreign parent and its Moroccan subsidiary as distinct issuers for several names (e.g. `HOLCIM`
vs `HOLCIM MAROC`, `TOTAL (France)` vs `TotalEnergies Marketing Maroc`) — stripping it would
silently collide two different companies.

An issuer that clears neither priority is recorded in `unmatched_document_issuers` for admin
review (`/[locale]/admin/reports`), optionally with a best-effort `candidateSecurityId`
suggestion (`suggestCandidateSecurity`) that is **never** auto-applied.

## Sync pipeline

One canonical implementation, `syncAnnualReports()` in `packages/annual-reports/src/sync.ts`,
used identically by the CLI and the admin "Sync now" button — issuer-driven: it walks the AMMC
issuer directory, resolves each issuer to a security (or records it unmatched), and only for a
resolved issuer fetches its listing, keeps annual rows, fetches each detail page, and probes
each attachment with an HTTP `HEAD` request (existence + exact `Content-Length`; the PDF body is
never downloaded — see "Not mirroring PDFs" below).

```
pnpm reports:sync                    # every currently active/suspended security
pnpm reports:sync -- --ticker IAM    # one security (resolves its AMMC issuer via alias/name)
pnpm reports:sync -- --year 2025     # every security, keeping only fiscal year 2025
pnpm reports:sync -- --dry-run       # full discovery/matching/probing, zero persistence
```

`--ticker` and `--year` cannot be combined. A `--ticker` run for a security with no resolvable
AMMC issuer fails clearly (`resolve_ticker` / `NO_AMMC_ISSUER_MATCH`) instead of silently doing
nothing — the fix is to add an alias, not to guess.

Persistence goes through `PgReportsStore` (a direct `WORKER_DATABASE_URL` connection, same
pattern as `@bvc/market-ingestion`'s `PgIngestionStore` — bypasses RLS as a trusted internal
worker, not through PostgREST). A `--dry-run` never creates a `document_sync_runs` row and never
calls any write path.

## Not mirroring PDFs (yet)

`source_url` points directly at the official AMMC attachment. The product Download button links
there with `target="_blank" rel="noopener noreferrer"` — SaifInvest never proxies or stores the
PDF body this milestone (avoids storage/egress cost, preserves official provenance, avoids an
unintended redistribution layer). `checksum` stays `null` for the same reason: without
downloading the body there is nothing honest to hash. The schema already has the columns a later
binary-archival phase would need.

## Provenance in the UI

The public view exposes `source_provider_id`, but the UI never prints the raw string. It maps to
a human label (`sourceLabel()` in `security-annual-reports-section.tsx`, mirroring the existing
`providerLabel()` pattern for market-data providers): `ammc_public_documents` → "AMMC",
`admin_manual` → "SaifInvest".

## Manual fallback

`/[locale]/admin/reports` also has a manual entry form (`upsert_company_document_manual`,
always `source_provider_id = 'admin_manual'`) for when AMMC sync cannot find or match a report —
coverage should not depend entirely on the page structure never changing.

## Future: fundamentals extraction

Deliberately out of scope for this milestone. `company_documents` is shaped so a later phase can
treat an indexed annual-report PDF as the trusted source for a
`PDF → extraction → normalized draft fundamentals → admin review → publication` pipeline, but no
extraction of any kind runs today.
