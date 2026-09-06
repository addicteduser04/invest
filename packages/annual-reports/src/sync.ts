import {
  ammcListingUrl,
  parseAmmcDocumentDetail,
  parseAmmcFinancialStatementsListing,
  parseAmmcIssuerDirectory,
  type AmmcAttachment,
  type AmmcIssuerOption,
} from '@bvc/market-data/ammc-reports';
import { ammcHardenedFetch, delay, probeAttachment, type AmmcFetchImpl } from './ammc-fetch';
import {
  resolveIssuerForSecurity,
  resolveSecurityForIssuer,
  suggestCandidateSecurity,
} from './matching';
import type { ReportsStore } from './store';
import type {
  DiscoveredDocument,
  DocumentUpsertCounts,
  SecurityRef,
  SyncFailure,
  SyncScope,
  SyncSummary,
  UnmatchedIssuer,
} from './types';

export interface SyncDeps {
  fetchImpl?: AmmcFetchImpl;
  log?: (message: string) => void;
  /** Delay between AMMC requests, in ms -- keeps the crawl bounded/respectful. */
  delayMs?: number;
}

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

/**
 * The single canonical annual-report sync pipeline -- used identically by the CLI
 * (`pnpm reports:sync`) and the admin "Sync annual reports" button (via
 * /api/admin/reports/sync), so there is exactly one implementation of this logic.
 *
 * Issuer-driven, not security-driven: it walks the official AMMC issuer directory and, for
 * each issuer, resolves a SaifInvest security via the deterministic priority-1 (alias) /
 * priority-2 (exact normalized name) rule. An issuer that resolves to zero or more than one
 * security is recorded as unmatched for admin review and its reports are never fetched --
 * never guessed. Only rows AMMC itself labels as an annual variant ("Rapports annuels",
 * "...consolidés annuels", "...sociaux annuels") are kept; half-year rows are discarded.
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
  const aliases = await store.listAliases();

  const failures: SyncFailure[] = [];
  let issuerDirectory: AmmcIssuerOption[] = [];
  try {
    const response = await fetchImpl(ammcListingUrl());
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const directory = parseAmmcIssuerDirectory(await response.text());
    issuerDirectory = directory.issuers;
    for (const err of directory.errors) failures.push({ stage: 'issuer_directory', message: err });
  } catch (error) {
    failures.push({ stage: 'issuer_directory', message: errorMessage(error) });
  }

  let targetIssuers: Array<{ issuer: AmmcIssuerOption; security: SecurityRef }>;
  const unmatchedIssuers = new Map<string, UnmatchedIssuer>();

  if (scope.ticker) {
    const security = securities.find((s) => s.ticker.toUpperCase() === scope.ticker!.toUpperCase());
    if (!security) {
      return finish(
        store,
        null,
        scope,
        'failed',
        0,
        { inserted: 0, updated: 0, unchanged: 0 },
        [],
        [
          {
            stage: 'resolve_ticker',
            message: `UNKNOWN_TICKER: "${scope.ticker}" is not a currently active/suspended security`,
          },
        ],
      );
    }
    const issuer = resolveIssuerForSecurity(security, aliases, issuerDirectory);
    if (!issuer) {
      failures.push({
        stage: 'resolve_ticker',
        message: `NO_AMMC_ISSUER_MATCH: no alias or exact-name AMMC issuer found for ${security.ticker}`,
        context: security.ticker,
      });
      targetIssuers = [];
    } else {
      targetIssuers = [{ issuer, security }];
    }
  } else {
    targetIssuers = [];
    for (const issuer of issuerDirectory) {
      const match = resolveSecurityForIssuer(issuer, aliases, securities);
      if (!match.securityId) {
        unmatchedIssuers.set(issuer.issuerId, {
          sourceIssuerId: issuer.issuerId,
          sourceIssuerName: issuer.issuerName,
          candidateSecurityId: suggestCandidateSecurity(issuer, securities),
        });
        continue;
      }
      const security = securities.find((s) => s.id === match.securityId)!;
      targetIssuers.push({ issuer, security });
    }
  }

  const discovered: DiscoveredDocument[] = [];
  let discoveredCount = 0;

  for (const { issuer, security } of targetIssuers) {
    await delay(delayMs);
    log(`Syncing ${security.ticker} (AMMC issuer ${issuer.issuerId}: ${issuer.issuerName})`);
    try {
      const response = await fetchImpl(ammcListingUrl({ issuerId: issuer.issuerId }));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const listing = parseAmmcFinancialStatementsListing(await response.text());
      for (const err of listing.errors) {
        failures.push({ stage: 'listing', message: err, context: security.ticker });
      }

      const annualRows = listing.rows.filter((row) => row.classification === 'annual');
      for (const row of annualRows) {
        const fiscalYear = Number.parseInt(row.fiscalYearLabel, 10);
        if (!Number.isFinite(fiscalYear)) {
          failures.push({
            stage: 'listing_row',
            message: `INVALID_FISCAL_YEAR: "${row.fiscalYearLabel}"`,
            context: security.ticker,
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
          discoveredCount += 1;
          await delay(delayMs);
          const probe = await probeAttachment(attachment.url, fetchImpl);
          discovered.push({
            securityId: security.id,
            documentType: 'annual_report',
            fiscalYear,
            title: buildDocumentTitle(
              reportTypeLabel ?? row.reportTypeLabel,
              fiscalYear,
              attachment,
              attachments.length,
            ),
            sourceUrl: attachment.url,
            publicationDate: null,
            language: null,
            fileName: attachment.fileName,
            fileSizeBytes: probe.fileSizeBytes,
            status: probe.available ? 'published' : 'unavailable',
          });
        }
      }
    } catch (error) {
      failures.push({
        stage: 'security_sync',
        message: errorMessage(error),
        context: security.ticker,
      });
    }
  }

  if (scope.dryRun) {
    return {
      runId: null,
      status: failures.some((f) => f.stage === 'issuer_directory') ? 'failed' : 'completed',
      documentsDiscovered: discoveredCount,
      documentsMatched: discovered.length,
      documentsInserted: 0,
      documentsUpdated: 0,
      documentsUnchanged: 0,
      unmatchedIssuers: [...unmatchedIssuers.values()],
      failures,
    };
  }

  const runId = await store.createRun({ scope, createdBy });
  let counts: DocumentUpsertCounts = { inserted: 0, updated: 0, unchanged: 0 };
  try {
    counts = await store.upsertDocuments(discovered);
    await store.upsertUnmatchedIssuers([...unmatchedIssuers.values()]);
  } catch (error) {
    failures.push({ stage: 'persist', message: errorMessage(error) });
  }
  const status = failures.some((f) => f.stage === 'issuer_directory' || f.stage === 'persist')
    ? 'failed'
    : 'completed';
  await store.finalizeRun(runId, {
    status,
    discovered: discoveredCount,
    counts,
    unmatchedIssuers: [...unmatchedIssuers.values()],
    failures,
  });

  return {
    runId,
    status,
    documentsDiscovered: discoveredCount,
    documentsMatched: discovered.length,
    documentsInserted: counts.inserted,
    documentsUpdated: counts.updated,
    documentsUnchanged: counts.unchanged,
    unmatchedIssuers: [...unmatchedIssuers.values()],
    failures,
  };
}

async function finish(
  store: ReportsStore,
  runId: string | null,
  scope: SyncScope,
  status: 'completed' | 'failed',
  discovered: number,
  counts: DocumentUpsertCounts,
  unmatchedIssuers: UnmatchedIssuer[],
  failures: SyncFailure[],
): Promise<SyncSummary> {
  if (!scope.dryRun) {
    const createdBy = await store.ensureSystemActor();
    const createdRunId = await store.createRun({ scope, createdBy });
    await store.finalizeRun(createdRunId, {
      status,
      discovered,
      counts,
      unmatchedIssuers,
      failures,
    });
    runId = createdRunId;
  }
  return {
    runId,
    status,
    documentsDiscovered: discovered,
    documentsMatched: 0,
    documentsInserted: counts.inserted,
    documentsUpdated: counts.updated,
    documentsUnchanged: counts.unchanged,
    unmatchedIssuers,
    failures,
  };
}
