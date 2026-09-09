import {
  ammcListingUrl,
  normalizeAmmcIssuerName,
  parseAmmcDocumentDetail,
  parseAmmcFinancialStatementsListing,
  parseAmmcIssuerDirectory,
  type AmmcAttachment,
  type AmmcIssuerOption,
  type AmmcListingRow,
} from '@bvc/market-data/ammc-reports';
import { ammcHardenedFetch, delay, probeAttachment, type AmmcFetchImpl } from './ammc-fetch';
import { draftNewIssuer, resolveIssuer, suggestCandidateIssuer } from './matching';
import type { ReportsStore } from './store';
import type {
  AmbiguousIssuer,
  DiscoveredDocument,
  DocumentUpsertCounts,
  IssuerRef,
  SecurityRef,
  SyncCounters,
  SyncFailure,
  SyncScope,
  SyncSummary,
} from './types';

export interface SyncDeps {
  fetchImpl?: AmmcFetchImpl;
  log?: (message: string) => void;
  /** Delay between AMMC requests, in ms -- keeps the crawl bounded/respectful. */
  delayMs?: number;
}

const DRY_RUN_ISSUER_PREFIX = 'dry-run-issuer:';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function prettifyFileStem(fileName: string): string {
  return fileName
    .replace(/\.pdf$/i, '')
    .replace(/[_-]+/g, ' ')
    .trim();
}

function buildDocumentTitle(
  reportTypeLabel: string,
  fiscalYear: number,
  attachment: AmmcAttachment,
  totalAttachments: number,
): string {
  if (totalAttachments <= 1) return `${reportTypeLabel} ${fiscalYear}`;
  return `${reportTypeLabel} ${fiscalYear} — ${prettifyFileStem(attachment.fileName)}`;
}

function zeroCounters(): SyncCounters {
  return {
    issuersDiscovered: 0,
    issuersExisting: 0,
    issuersCreated: 0,
    issuersLinkedToSecurity: 0,
    issuersUnlisted: 0,
    issuersAmbiguous: 0,
    issuersWithReports: 0,
    issuersWithoutReports: 0,
    documentsDiscovered: 0,
    documentsInserted: 0,
    documentsUpdated: 0,
    documentsUnchanged: 0,
  };
}

/**
 * The single canonical annual-report sync pipeline -- used identically by the CLI
 * (`pnpm reports:sync`) and the admin "Sync now" button (via /api/admin/reports/sync).
 *
 * Issuer-driven: walks the official AMMC issuer directory and, for each entry, resolves a
 * SaifInvest issuer via resolveIssuer() (priority 1: existing ammc_issuer_id; priority 2: exact
 * normalized-name match against exactly one existing issuer). An issuer with no match at all is
 * CREATED -- an AMMC issuer with no BVC security is a legitimate unlisted/foreign/historical
 * issuer, not an error (see docs/COMPANY_DOCUMENTS.md and mission section 5/23). Only a name
 * collision with more than one existing issuer is "ambiguous" and held for admin review; it is
 * never auto-resolved. Only rows AMMC itself labels as an annual variant are kept as documents;
 * half-year rows are discarded. Zero annual reports for a validly-resolved issuer is recorded as
 * issuersWithoutReports, never as a failure -- see NO_REPORTS_AVAILABLE vs SOURCE_FETCH_FAILED
 * in the failures array (stage 'listing'/'detail_fetch' vs no stage at all for a clean zero).
 */
export async function syncAnnualReports(
  scope: SyncScope,
  store: ReportsStore,
  deps: SyncDeps = {},
): Promise<SyncSummary> {
  const fetchImpl = deps.fetchImpl ?? ammcHardenedFetch;
  const log = deps.log ?? (() => {});
  const delayMs = deps.delayMs ?? 300;

  const createdBy = await store.ensureSystemActor();
  const securities = await store.listActiveSecurities();
  const issuerPool: IssuerRef[] = await store.listExistingIssuers();

  const failures: SyncFailure[] = [];
  let ammcDirectory: AmmcIssuerOption[] = [];
  try {
    const response = await fetchImpl(ammcListingUrl());
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const directory = parseAmmcIssuerDirectory(await response.text());
    ammcDirectory = directory.issuers;
    for (const err of directory.errors) failures.push({ stage: 'issuer_directory', message: err });
  } catch (error) {
    failures.push({ stage: 'issuer_directory', message: errorMessage(error) });
    return finish(store, scope, createdBy, zeroCounters(), failures, []);
  }

  let targetAmmcIssuers: AmmcIssuerOption[];
  if (scope.ticker) {
    const security = securities.find((s) => s.ticker.toUpperCase() === scope.ticker!.toUpperCase());
    if (!security) {
      failures.push({
        stage: 'resolve_ticker',
        message: `UNKNOWN_TICKER: "${scope.ticker}" is not a currently active/suspended security`,
      });
      return finish(store, scope, createdBy, zeroCounters(), failures, []);
    }
    const issuerRef = issuerPool.find((i) => i.id === security.issuerId);
    const found = issuerRef?.ammcIssuerId
      ? ammcDirectory.find((i) => i.issuerId === issuerRef.ammcIssuerId)
      : issuerRef
        ? ammcDirectory.find(
            (i) => normalizeAmmcIssuerName(i.issuerName) === issuerRef.normalizedName,
          )
        : undefined;
    if (!found) {
      failures.push({
        stage: 'resolve_ticker',
        message: `NO_AMMC_ISSUER_MATCH: no ammc_issuer_id or exact-name AMMC issuer found for ${security.ticker}`,
        context: security.ticker,
      });
      return finish(store, scope, createdBy, zeroCounters(), failures, []);
    }
    targetAmmcIssuers = [found];
  } else {
    targetAmmcIssuers = ammcDirectory;
  }

  const counters = zeroCounters();
  const discovered: DiscoveredDocument[] = [];
  const ambiguous: AmbiguousIssuer[] = [];

  for (const ammcIssuer of targetAmmcIssuers) {
    counters.issuersDiscovered += 1;
    const resolution = resolveIssuer(ammcIssuer, issuerPool);

    if (resolution.kind === 'ambiguous') {
      counters.issuersAmbiguous += 1;
      ambiguous.push({
        sourceIssuerId: ammcIssuer.issuerId,
        sourceIssuerName: ammcIssuer.issuerName,
        candidateIssuerId: suggestCandidateIssuer(ammcIssuer, issuerPool),
      });
      continue;
    }

    let issuerRef: IssuerRef;
    if (resolution.kind === 'existing') {
      counters.issuersExisting += 1;
      issuerRef = issuerPool.find((i) => i.id === resolution.issuerId)!;
      if (!issuerRef.ammcIssuerId) {
        issuerRef.ammcIssuerId = ammcIssuer.issuerId;
        if (!scope.dryRun) {
          try {
            await store.backfillIssuerAmmcId(
              issuerRef.id,
              ammcIssuer.issuerId,
              ammcIssuer.issuerName,
            );
          } catch (error) {
            failures.push({
              stage: 'backfill_ammc_id',
              message: errorMessage(error),
              context: issuerRef.name,
            });
          }
        }
      }
    } else {
      counters.issuersCreated += 1;
      const draft = draftNewIssuer(ammcIssuer);
      let issuerId: string;
      if (scope.dryRun) {
        issuerId = `${DRY_RUN_ISSUER_PREFIX}${ammcIssuer.issuerId}`;
      } else {
        try {
          issuerId = await store.createIssuer(draft);
        } catch (error) {
          failures.push({
            stage: 'create_issuer',
            message: errorMessage(error),
            context: draft.name,
          });
          continue;
        }
      }
      issuerRef = {
        id: issuerId,
        name: draft.name,
        normalizedName: draft.normalizedName,
        ammcIssuerId: draft.ammcIssuerId,
        hasListedSecurity: false,
      };
      issuerPool.push(issuerRef);
    }

    if (issuerRef.hasListedSecurity) counters.issuersLinkedToSecurity += 1;
    else counters.issuersUnlisted += 1;

    await delay(delayMs);
    log(`Syncing issuer ${issuerRef.name} (AMMC ${ammcIssuer.issuerId})`);
    let issuerDocumentCount = 0;
    try {
      // AMMC's per-issuer listing is paginated; a listed company with many years of history
      // (e.g. 10+ years x several report types) spans multiple pages, and the older filings on
      // later pages are just as much "every legitimate annual filing" as page 0's. Walk pages
      // until one comes back empty (the natural end of the listing, not a failure) rather than
      // silently stopping after page 0.
      const listingRows: AmmcListingRow[] = [];
      const MAX_LISTING_PAGES = 50;
      for (let page = 0; page < MAX_LISTING_PAGES; page += 1) {
        const response = await fetchImpl(ammcListingUrl({ issuerId: ammcIssuer.issuerId, page }));
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const listing = parseAmmcFinancialStatementsListing(await response.text());
        if (listing.errors.includes('AMMC_LISTING_NO_ROWS')) {
          // Page 0 empty means this issuer genuinely has zero reports indexed
          // (NO_REPORTS_AVAILABLE, handled below via issuerDocumentCount === 0) -- not a
          // failure. Any later page coming back empty just means pagination has reached the end
          // -- also not a failure, and also not "no reports" (earlier pages already had some).
          break;
        }
        for (const err of listing.errors) {
          failures.push({ stage: 'listing', message: err, context: issuerRef.name });
        }
        listingRows.push(...listing.rows);
        if (page + 1 < MAX_LISTING_PAGES) await delay(delayMs);
      }

      const annualRows = listingRows.filter((row) => row.classification === 'annual');
      for (const row of annualRows) {
        const fiscalYear = Number.parseInt(row.fiscalYearLabel, 10);
        if (!Number.isFinite(fiscalYear)) {
          failures.push({
            stage: 'listing_row',
            message: `INVALID_FISCAL_YEAR: "${row.fiscalYearLabel}"`,
            context: issuerRef.name,
          });
          continue;
        }
        if (scope.year && fiscalYear !== scope.year) continue;

        await delay(delayMs);
        const detailResponse = await fetchImpl(row.detailUrl);
        if (!detailResponse.ok) {
          failures.push({
            stage: 'detail_fetch',
            message: `HTTP ${detailResponse.status}`,
            context: row.detailUrl,
          });
          continue;
        }
        const detailResult = parseAmmcDocumentDetail(await detailResponse.text());
        if (!detailResult.detail) {
          failures.push({
            stage: 'detail_parse',
            message: detailResult.errors.join(','),
            context: row.detailUrl,
          });
          continue;
        }

        const { attachments, reportTypeLabel } = detailResult.detail;
        for (const attachment of attachments) {
          counters.documentsDiscovered += 1;
          issuerDocumentCount += 1;
          let fileSizeBytes: number | null = null;
          let status: 'published' | 'unavailable' = 'published';
          if (!scope.dryRun) {
            await delay(delayMs);
            const probe = await probeAttachment(attachment.url, fetchImpl);
            fileSizeBytes = probe.fileSizeBytes;
            status = probe.available ? 'published' : 'unavailable';
          }
          discovered.push({
            issuerId: issuerRef.id,
            documentType: 'annual_report',
            fiscalYear,
            title: buildDocumentTitle(
              reportTypeLabel ?? row.reportTypeLabel,
              fiscalYear,
              attachment,
              attachments.length,
            ),
            sourceRecordUrl: row.detailUrl,
            sourceUrl: attachment.url,
            publicationDate: null,
            language: null,
            fileName: attachment.fileName,
            fileSizeBytes,
            status,
          });
        }
      }
    } catch (error) {
      failures.push({
        stage: 'issuer_sync',
        message: errorMessage(error),
        context: issuerRef.name,
      });
    }

    // A validly-resolved issuer with zero annual reports is NOT a failure -- AMMC simply has
    // none indexed for it (NO_REPORTS_AVAILABLE), distinct from the 'listing'/'detail_fetch'/
    // 'issuer_sync' failure stages above (SOURCE_FETCH_FAILED-equivalent).
    if (issuerDocumentCount > 0) counters.issuersWithReports += 1;
    else counters.issuersWithoutReports += 1;
  }

  const persistableRaw = discovered.filter(
    (doc) => !doc.issuerId.startsWith(DRY_RUN_ISSUER_PREFIX),
  );

  // A single upsert batch can only touch one conflict target once (Postgres: "ON CONFLICT DO
  // UPDATE command cannot affect row a second time"), so the in-memory dedup key here must be
  // exactly the DB's identity: (sourceRecordUrl, sourceUrl) -- the AMMC filing/detail-page URL
  // plus the PDF asset URL, matching company_documents_source_identity_key. Deduping by
  // sourceUrl alone (the previous, incorrect assumption) would wrongly collapse two distinct
  // filing records that happen to share one PDF -- see docs/COMPANY_DOCUMENTS.md "Filing
  // identity". Only an identical (sourceRecordUrl, sourceUrl) pair -- the same filing discovered
  // twice, e.g. a listing/pagination overlap -- is a true duplicate here.
  const byFilingIdentity = new Map<string, DiscoveredDocument>();
  for (const doc of persistableRaw) {
    const key = `${doc.sourceRecordUrl} ${doc.sourceUrl}`;
    const existing = byFilingIdentity.get(key);
    if (existing) {
      // A true duplicate from AMMC in practice carries identical metadata (it's the same
      // listing entry re-parsed); this tiebreak only matters if it ever doesn't. Prefer whichever
      // copy populated more optional fields; never "whichever happened to be seen last" -- ties
      // keep the first-discovered copy (stable directory/listing/row order).
      const richness = (d: DiscoveredDocument) =>
        (d.publicationDate ? 1 : 0) + (d.language ? 1 : 0) + (d.fileSizeBytes !== null ? 1 : 0);
      const winner = richness(doc) > richness(existing) ? doc : existing;
      failures.push({
        stage: 'document_duplicate',
        message: `TRUE_DUPLICATE_FILING: same filing record and asset discovered twice, kept "${winner.title}"`,
        context: doc.sourceUrl,
      });
      byFilingIdentity.set(key, winner);
      continue;
    }
    byFilingIdentity.set(key, doc);
  }
  const persistable = [...byFilingIdentity.values()];

  if (scope.dryRun) {
    counters.documentsInserted = 0;
    counters.documentsUpdated = 0;
    counters.documentsUnchanged = 0;
    return {
      runId: null,
      status: failures.some((f) => f.stage === 'issuer_directory') ? 'failed' : 'completed',
      ...counters,
      failures,
    };
  }

  const runId = await store.createRun({ scope, createdBy });
  let counts: DocumentUpsertCounts = { inserted: 0, updated: 0, unchanged: 0 };
  try {
    counts = await store.upsertDocuments(persistable);
    await store.upsertAmbiguousIssuers(ambiguous);
  } catch (error) {
    failures.push({ stage: 'persist', message: errorMessage(error) });
  }
  counters.documentsInserted = counts.inserted;
  counters.documentsUpdated = counts.updated;
  counters.documentsUnchanged = counts.unchanged;

  const status = failures.some((f) => f.stage === 'issuer_directory' || f.stage === 'persist')
    ? 'failed'
    : 'completed';
  await store.finalizeRun(runId, { status, counters, failures });

  return { runId, status, ...counters, failures };
}

async function finish(
  store: ReportsStore,
  scope: SyncScope,
  createdBy: string,
  counters: SyncCounters,
  failures: SyncFailure[],
  ambiguous: AmbiguousIssuer[],
): Promise<SyncSummary> {
  if (scope.dryRun) {
    return { runId: null, status: 'failed', ...counters, failures };
  }
  const runId = await store.createRun({ scope, createdBy });
  await store.upsertAmbiguousIssuers(ambiguous);
  await store.finalizeRun(runId, { status: 'failed', counters, failures });
  return { runId, status: 'failed', ...counters, failures };
}
