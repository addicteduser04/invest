import { describe, expect, it } from 'vitest';
import { syncAnnualReports } from './sync';
import type { ReportsStore } from './store';
import type {
  AliasRow,
  DiscoveredDocument,
  DocumentUpsertCounts,
  SecurityRef,
  SyncFailure,
  SyncScope,
  SyncStatus,
  UnmatchedIssuer,
} from './types';

class FakeReportsStore implements ReportsStore {
  documents = new Map<string, DiscoveredDocument>();
  unmatched = new Map<string, UnmatchedIssuer>();
  runs: Array<{ scope: SyncScope; status?: SyncStatus }> = [];

  constructor(
    private readonly securities: SecurityRef[],
    private readonly aliases: AliasRow[] = [],
  ) {}

  async ensureSystemActor() {
    return 'system-actor';
  }
  async listActiveSecurities() {
    return this.securities;
  }
  async listAliases() {
    return this.aliases;
  }
  async createRun(input: { scope: SyncScope; createdBy: string }) {
    const id = `run-${this.runs.length + 1}`;
    this.runs.push({ scope: input.scope });
    return id;
  }
  async finalizeRun(runId: string, input: { status: SyncStatus }) {
    const run = this.runs.find((_, index) => `run-${index + 1}` === runId);
    if (run) run.status = input.status;
  }
  async upsertDocuments(documents: DiscoveredDocument[]): Promise<DocumentUpsertCounts> {
    let inserted = 0;
    let updated = 0;
    let unchanged = 0;
    for (const doc of documents) {
      const existing = this.documents.get(doc.sourceUrl);
      if (!existing) {
        inserted += 1;
      } else if (JSON.stringify(existing) === JSON.stringify(doc)) {
        unchanged += 1;
      } else {
        updated += 1;
      }
      this.documents.set(doc.sourceUrl, doc);
    }
    return { inserted, updated, unchanged };
  }
  async upsertUnmatchedIssuers(unmatched: UnmatchedIssuer[]) {
    for (const issuer of unmatched) this.unmatched.set(issuer.sourceIssuerId, issuer);
  }
  async close() {}
}

const ISSUER_DIRECTORY_HTML = `<html><body><select name="field_emetteur_target_id_verf">
<option value="All">- Tout -</option>
<option value="2798">MAROC TELECOM</option>
<option value="9999">SOME UNRELATED FRENCH COMPANY</option>
</select></body></html>`;

function listingHtml(rows: Array<{ slug: string; year: string; typeLabel: string }>): string {
  const trs = rows
    .map(
      (r) => `<tr><td class="views-field views-field-nothing"></td>
      <td headers="view-field-emetteur-table-column" class="views-field views-field-field-emetteur"><a href="/fr/espace-emetteurs/etats-financiers/${r.slug}"><a href="/fr/espace-emetteurs/x" hreflang="fr">MAROC TELECOM</a></a></td>
      <td headers="view-field-annee-table-column" class="views-field views-field-field-annee"><time datetime="${r.year}-12-31T00:00:00Z">${r.year}</time></td>
      <td headers="view-field-type-rapp-ef-em-table-column" class="views-field views-field-field-type-rapp-ef-em"><a href="/fr/espace-emetteurs/etats-financiers/${r.slug}">${r.typeLabel}</a></td>
      </tr>`,
    )
    .join('\n');
  return `<html><body><table><tbody>${trs}</tbody></table></body></html>`;
}

function detailHtml(input: {
  issuer: string;
  year: string;
  typeLabel: string;
  fileName: string;
}): string {
  return `<html><body><article><table>
    <tr><td><b>Emetteur</b></td><td><a href="/x" hreflang="fr">${input.issuer}</a><br></td></tr>
    <tr><td><b>Année</b></td><td><time datetime="${input.year}-12-31T00:00:00Z">${input.year}</time><br></td></tr>
    <tr><td><b>Rapports financiers</b></td><td>${input.typeLabel}<br></td></tr>
    <tr><td><b>Pièce jointe</b></td><div class="multiple file field_attachement"><td>
      <span class="file file--mime-application-pdf file--application-pdf"><a href="/sites/default/files/${input.fileName}" type="application/pdf">${input.fileName}</a></span>
      <span>(1.00 Mo)</span><br></td></div></tr>
    </table></article></body></html>`;
}

const iam: SecurityRef = { id: 'sec-iam', ticker: 'IAM', issuerName: 'ITISSALAT AL-MAGHRIB' };
const iamAlias: AliasRow = {
  securityId: 'sec-iam',
  sourceIssuerId: '2798',
  sourceIssuerName: 'MAROC TELECOM',
};

function fakeFetch(
  routes: Record<string, { status?: number; body: string; headers?: Record<string, string> }>,
) {
  return async (url: string, init?: RequestInit): Promise<Response> => {
    const path = url.replace('https://www.ammc.ma', '');
    const route = routes[path];
    if (!route) return new Response('', { status: 404 });
    if (init?.method === 'HEAD') {
      return new Response(null, {
        status: route.status ?? 200,
        headers: route.headers ?? { 'content-length': '123456' },
      });
    }
    return new Response(route.body, { status: route.status ?? 200 });
  };
}

describe('syncAnnualReports', () => {
  const scope = (overrides: Partial<SyncScope> = {}): SyncScope => ({
    dryRun: false,
    ...overrides,
  });

  it('first import: discovers and inserts one annual report for the aliased security', async () => {
    const store = new FakeReportsStore([iam], [iamAlias]);
    const fetchImpl = fakeFetch({
      '/fr/liste-etats-financiers-emetteurs': { body: ISSUER_DIRECTORY_HTML },
      '/fr/liste-etats-financiers-emetteurs?field_emetteur_target_id_verf=2798': {
        body: listingHtml([
          { slug: 'maroc-telecom-rfa-2024', year: '2024', typeLabel: 'Rapports annuels' },
        ]),
      },
      '/fr/espace-emetteurs/etats-financiers/maroc-telecom-rfa-2024': {
        body: detailHtml({
          issuer: 'MAROC TELECOM',
          year: '2024',
          typeLabel: 'Rapports annuels',
          fileName: 'MT_RFA_2024.pdf',
        }),
      },
      '/sites/default/files/MT_RFA_2024.pdf': { body: '' },
    });

    const summary = await syncAnnualReports(scope(), store, { fetchImpl, delayMs: 0 });

    expect(summary.status).toBe('completed');
    expect(summary.documentsInserted).toBe(1);
    expect(summary.documentsUpdated).toBe(0);
    expect(store.documents.size).toBe(1);
    const doc = [...store.documents.values()][0]!;
    expect(doc.securityId).toBe('sec-iam');
    expect(doc.fiscalYear).toBe(2024);
    expect(doc.status).toBe('published');
    expect(doc.fileSizeBytes).toBe(123456);
  });

  it('an identical rerun is idempotent: same document counts as unchanged, not re-inserted', async () => {
    const store = new FakeReportsStore([iam], [iamAlias]);
    const fetchImpl = fakeFetch({
      '/fr/liste-etats-financiers-emetteurs': { body: ISSUER_DIRECTORY_HTML },
      '/fr/liste-etats-financiers-emetteurs?field_emetteur_target_id_verf=2798': {
        body: listingHtml([
          { slug: 'maroc-telecom-rfa-2024', year: '2024', typeLabel: 'Rapports annuels' },
        ]),
      },
      '/fr/espace-emetteurs/etats-financiers/maroc-telecom-rfa-2024': {
        body: detailHtml({
          issuer: 'MAROC TELECOM',
          year: '2024',
          typeLabel: 'Rapports annuels',
          fileName: 'MT_RFA_2024.pdf',
        }),
      },
    });

    await syncAnnualReports(scope(), store, { fetchImpl, delayMs: 0 });
    const second = await syncAnnualReports(scope(), store, { fetchImpl, delayMs: 0 });

    expect(second.documentsInserted).toBe(0);
    expect(second.documentsUnchanged).toBe(1);
    expect(store.documents.size).toBe(1);
  });

  it('a changed attachment (e.g. new file size) is recorded as an update, not a duplicate', async () => {
    const store = new FakeReportsStore([iam], [iamAlias]);
    const routes = {
      '/fr/liste-etats-financiers-emetteurs': { body: ISSUER_DIRECTORY_HTML },
      '/fr/liste-etats-financiers-emetteurs?field_emetteur_target_id_verf=2798': {
        body: listingHtml([
          { slug: 'maroc-telecom-rfa-2024', year: '2024', typeLabel: 'Rapports annuels' },
        ]),
      },
      '/fr/espace-emetteurs/etats-financiers/maroc-telecom-rfa-2024': {
        body: detailHtml({
          issuer: 'MAROC TELECOM',
          year: '2024',
          typeLabel: 'Rapports annuels',
          fileName: 'MT_RFA_2024.pdf',
        }),
      },
    };
    await syncAnnualReports(scope(), store, { fetchImpl: fakeFetch(routes), delayMs: 0 });

    const updatedRoutes = {
      ...routes,
      '/sites/default/files/MT_RFA_2024.pdf': { body: '', headers: { 'content-length': '999' } },
    };
    const fetchWithNewSize = async (url: string, init?: RequestInit) => {
      if (init?.method === 'HEAD')
        return new Response(null, { status: 200, headers: { 'content-length': '999' } });
      return fakeFetch(routes)(url, init);
    };
    const second = await syncAnnualReports(scope(), store, {
      fetchImpl: fetchWithNewSize,
      delayMs: 0,
    });

    expect(second.documentsUpdated).toBe(1);
    expect(second.documentsInserted).toBe(0);
    expect([...store.documents.values()][0]!.fileSizeBytes).toBe(999);
  });

  it('dry run discovers documents but never persists anything', async () => {
    const store = new FakeReportsStore([iam], [iamAlias]);
    const fetchImpl = fakeFetch({
      '/fr/liste-etats-financiers-emetteurs': { body: ISSUER_DIRECTORY_HTML },
      '/fr/liste-etats-financiers-emetteurs?field_emetteur_target_id_verf=2798': {
        body: listingHtml([
          { slug: 'maroc-telecom-rfa-2024', year: '2024', typeLabel: 'Rapports annuels' },
        ]),
      },
      '/fr/espace-emetteurs/etats-financiers/maroc-telecom-rfa-2024': {
        body: detailHtml({
          issuer: 'MAROC TELECOM',
          year: '2024',
          typeLabel: 'Rapports annuels',
          fileName: 'MT_RFA_2024.pdf',
        }),
      },
    });

    const summary = await syncAnnualReports(scope({ dryRun: true }), store, {
      fetchImpl,
      delayMs: 0,
    });

    expect(summary.runId).toBeNull();
    expect(summary.documentsMatched).toBe(1);
    expect(store.documents.size).toBe(0);
    expect(store.runs.length).toBe(0);
  });

  it('surfaces an AMMC issuer with no matching security as unmatched, with a null candidate when nothing plausible overlaps', async () => {
    const store = new FakeReportsStore([iam], [iamAlias]);
    const fetchImpl = fakeFetch({
      '/fr/liste-etats-financiers-emetteurs': { body: ISSUER_DIRECTORY_HTML },
    });

    const summary = await syncAnnualReports(scope(), store, { fetchImpl, delayMs: 0 });

    expect(summary.unmatchedIssuers).toEqual([
      {
        sourceIssuerId: '9999',
        sourceIssuerName: 'SOME UNRELATED FRENCH COMPANY',
        candidateSecurityId: null,
      },
    ]);
    expect(store.unmatched.has('9999')).toBe(true);
  });

  it('a --ticker run for a security with no resolvable AMMC issuer fails clearly instead of guessing', async () => {
    const store = new FakeReportsStore([
      { id: 'sec-x', ticker: 'ZZZ', issuerName: 'TOTALLY UNRELATED NAME' },
    ]);
    const fetchImpl = fakeFetch({
      '/fr/liste-etats-financiers-emetteurs': { body: ISSUER_DIRECTORY_HTML },
    });

    const summary = await syncAnnualReports(scope({ ticker: 'ZZZ' }), store, {
      fetchImpl,
      delayMs: 0,
    });

    expect(summary.documentsInserted).toBe(0);
    expect(summary.failures.some((f: SyncFailure) => f.stage === 'resolve_ticker')).toBe(true);
  });

  it('a single failing detail-page fetch does not abort the rest of the run (partial failure)', async () => {
    const store = new FakeReportsStore([iam], [iamAlias]);
    const fetchImpl = fakeFetch({
      '/fr/liste-etats-financiers-emetteurs': { body: ISSUER_DIRECTORY_HTML },
      '/fr/liste-etats-financiers-emetteurs?field_emetteur_target_id_verf=2798': {
        body: listingHtml([
          { slug: 'maroc-telecom-rfa-2023', year: '2023', typeLabel: 'Rapports annuels' },
          { slug: 'maroc-telecom-rfa-2024', year: '2024', typeLabel: 'Rapports annuels' },
        ]),
      },
      '/fr/espace-emetteurs/etats-financiers/maroc-telecom-rfa-2023': { status: 500, body: '' },
      '/fr/espace-emetteurs/etats-financiers/maroc-telecom-rfa-2024': {
        body: detailHtml({
          issuer: 'MAROC TELECOM',
          year: '2024',
          typeLabel: 'Rapports annuels',
          fileName: 'MT_RFA_2024.pdf',
        }),
      },
    });

    const summary = await syncAnnualReports(scope(), store, { fetchImpl, delayMs: 0 });

    expect(summary.documentsInserted).toBe(1);
    expect(summary.failures.some((f: SyncFailure) => f.stage === 'detail_fetch')).toBe(true);
    expect(summary.status).toBe('completed');
  });

  it('excludes half-year rows and only keeps the requested fiscal year when --year is set', async () => {
    const store = new FakeReportsStore([iam], [iamAlias]);
    const fetchImpl = fakeFetch({
      '/fr/liste-etats-financiers-emetteurs': { body: ISSUER_DIRECTORY_HTML },
      '/fr/liste-etats-financiers-emetteurs?field_emetteur_target_id_verf=2798': {
        body: listingHtml([
          { slug: 'maroc-telecom-rfa-2024', year: '2024', typeLabel: 'Rapports annuels' },
          { slug: 'maroc-telecom-rfa-2023', year: '2023', typeLabel: 'Rapports annuels' },
          { slug: 'maroc-telecom-rfs-2024', year: '2024', typeLabel: 'Rapports 1er semestre' },
        ]),
      },
      '/fr/espace-emetteurs/etats-financiers/maroc-telecom-rfa-2024': {
        body: detailHtml({
          issuer: 'MAROC TELECOM',
          year: '2024',
          typeLabel: 'Rapports annuels',
          fileName: 'MT_RFA_2024.pdf',
        }),
      },
    });

    const summary = await syncAnnualReports(scope({ year: 2024 }), store, {
      fetchImpl,
      delayMs: 0,
    });

    expect(summary.documentsInserted).toBe(1);
    expect([...store.documents.values()][0]!.fiscalYear).toBe(2024);
  });
});
