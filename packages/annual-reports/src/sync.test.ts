import { describe, expect, it } from 'vitest';
import { syncAnnualReports } from './sync';
import type { ReportsStore } from './store';
import type {
  AmbiguousIssuer,
  DiscoveredDocument,
  DocumentUpsertCounts,
  IssuerRef,
  NewIssuerDraft,
  SecurityRef,
  SyncCounters,
  SyncFailure,
  SyncScope,
  SyncStatus,
} from './types';

class FakeReportsStore implements ReportsStore {
  documents = new Map<string, DiscoveredDocument>();
  ambiguous = new Map<string, AmbiguousIssuer>();
  createdIssuers: NewIssuerDraft[] = [];
  backfills: Array<{ issuerId: string; ammcIssuerId: string }> = [];
  runs: Array<{ scope: SyncScope; status?: SyncStatus; counters?: SyncCounters }> = [];
  private issuerSeq = 0;

  constructor(
    private readonly securities: SecurityRef[],
    private issuers: IssuerRef[] = [],
  ) {}

  async ensureSystemActor() {
    return 'system-actor';
  }
  async listActiveSecurities() {
    return this.securities;
  }
  async listExistingIssuers() {
    return this.issuers.map((i) => ({ ...i }));
  }
  async createIssuer(draft: NewIssuerDraft) {
    this.issuerSeq += 1;
    const id = `created-issuer-${this.issuerSeq}`;
    this.createdIssuers.push(draft);
    this.issuers.push({
      id,
      name: draft.name,
      normalizedName: draft.normalizedName,
      ammcIssuerId: draft.ammcIssuerId,
      hasListedSecurity: false,
    });
    return id;
  }
  async backfillIssuerAmmcId(issuerId: string, ammcIssuerId: string) {
    this.backfills.push({ issuerId, ammcIssuerId });
    const issuer = this.issuers.find((i) => i.id === issuerId);
    if (issuer) issuer.ammcIssuerId = ammcIssuerId;
  }
  async createRun(input: { scope: SyncScope; createdBy: string }) {
    const id = `run-${this.runs.length + 1}`;
    this.runs.push({ scope: input.scope });
    return id;
  }
  async finalizeRun(runId: string, input: { status: SyncStatus; counters: SyncCounters }) {
    const run = this.runs.find((_, index) => `run-${index + 1}` === runId);
    if (run) {
      run.status = input.status;
      run.counters = input.counters;
    }
  }
  async upsertDocuments(documents: DiscoveredDocument[]): Promise<DocumentUpsertCounts> {
    // Mirrors the real DB identity (source_provider_id,source_record_url,source_url): two
    // documents only collide here when both the filing record AND the asset URL match.
    let inserted = 0;
    let updated = 0;
    let unchanged = 0;
    for (const doc of documents) {
      const key = `${doc.sourceRecordUrl}::${doc.sourceUrl}`;
      const existing = this.documents.get(key);
      if (!existing) inserted += 1;
      else if (JSON.stringify(existing) === JSON.stringify(doc)) unchanged += 1;
      else updated += 1;
      this.documents.set(key, doc);
    }
    return { inserted, updated, unchanged };
  }
  async upsertAmbiguousIssuers(ambiguous: AmbiguousIssuer[]) {
    for (const issuer of ambiguous) this.ambiguous.set(issuer.sourceIssuerId, issuer);
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

const iamIssuer: IssuerRef = {
  id: 'issuer-iam',
  name: 'ITISSALAT AL-MAGHRIB',
  normalizedName: 'ITISSALAT AL MAGHRIB',
  ammcIssuerId: '2798',
  hasListedSecurity: true,
};
const iamSecurity: SecurityRef = { id: 'sec-iam', ticker: 'IAM', issuerId: 'issuer-iam' };

function fakeFetch(
  routes: Record<string, { status?: number; body: string; headers?: Record<string, string> }>,
) {
  return async (url: string, init?: RequestInit): Promise<Response> => {
    const path = url.replace('https://www.ammc.ma', '');
    const route = routes[path];
    if (!route) {
      // Matches real AMMC behavior (verified live): a listing page past the end of an issuer's
      // history returns HTTP 200 with an empty table, not a 404 -- so a test fixture only needs
      // to define page 0 for a single-page issuer; pagination terminates naturally here exactly
      // as it does against the real site. Any other unmapped route (issuer directory, detail
      // page, attachment) still 404s, since those ARE meant to simulate a genuine fetch failure
      // in some tests.
      if (/\/fr\/liste-etats-financiers-emetteurs\?.*[?&]page=\d+/.test(path)) {
        return new Response(listingHtml([]), { status: 200 });
      }
      return new Response('', { status: 404 });
    }
    if (init?.method === 'HEAD') {
      return new Response(null, {
        status: route.status ?? 200,
        headers: route.headers ?? { 'content-length': '123456' },
      });
    }
    return new Response(route.body, { status: route.status ?? 200 });
  };
}

const mtRoutes = {
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
};

describe('syncAnnualReports', () => {
  const scope = (overrides: Partial<SyncScope> = {}): SyncScope => ({
    dryRun: false,
    ...overrides,
  });

  it('first import: discovers and inserts one annual report for an already-linked issuer', async () => {
    const store = new FakeReportsStore([iamSecurity], [iamIssuer]);
    const summary = await syncAnnualReports(scope({ ticker: 'IAM' }), store, {
      fetchImpl: fakeFetch(mtRoutes),
      delayMs: 0,
    });

    expect(summary.status).toBe('completed');
    expect(summary.issuersExisting).toBe(1);
    expect(summary.issuersCreated).toBe(0);
    expect(summary.issuersLinkedToSecurity).toBe(1);
    expect(summary.issuersUnlisted).toBe(0);
    expect(summary.issuersWithReports).toBe(1);
    expect(summary.documentsInserted).toBe(1);
    const doc = [...store.documents.values()][0]!;
    expect(doc.issuerId).toBe('issuer-iam');
    expect(doc.status).toBe('published');
  });

  it('creates a new unlisted issuer for an AMMC entry with no existing match -- not an error', async () => {
    const store = new FakeReportsStore([iamSecurity], [iamIssuer]);
    const summary = await syncAnnualReports(scope(), store, {
      fetchImpl: fakeFetch(mtRoutes),
      delayMs: 0,
    });

    expect(summary.issuersCreated).toBe(1);
    expect(summary.issuersUnlisted).toBe(1);
    expect(summary.issuersWithoutReports).toBe(1); // the unrelated French company has no listing route -> HTTP 404 -> failure, still counted as "without reports"
    expect(store.createdIssuers).toHaveLength(1);
    expect(store.createdIssuers[0]!.name).toBe('SOME UNRELATED FRENCH COMPANY');
    expect(store.createdIssuers[0]!.equityListingStatus).toBe('no_listed_bvc_equity');
  });

  it('an identical rerun is idempotent: same document counts as unchanged, and no duplicate issuer is created', async () => {
    const store = new FakeReportsStore([iamSecurity], [iamIssuer]);
    const fetchImpl = fakeFetch(mtRoutes);
    await syncAnnualReports(scope(), store, { fetchImpl, delayMs: 0 });
    const second = await syncAnnualReports(scope(), store, { fetchImpl, delayMs: 0 });

    expect(second.documentsInserted).toBe(0);
    expect(second.documentsUnchanged).toBe(1);
    expect(store.documents.size).toBe(1);
    // The issuer created on the first run must be found via ammc_issuer_id on the second --
    // never re-created.
    expect(second.issuersCreated).toBe(0);
    expect(second.issuersExisting).toBe(2);
    expect(store.createdIssuers).toHaveLength(1);
  });

  it('persists two distinct filings that happen to share one PDF attachment URL, not just one (real Meditelecom case)', async () => {
    // A FILE is not a FILING: AMMC can genuinely list two different filing records (different
    // detail pages, different fiscal years) that both attach the identical PDF -- observed live
    // for Meditelecom's 2015 and 2017 "Rapports sociaux annuels". Identity is
    // (source_record_url,source_url), not source_url alone, so both must persist as separate
    // rows -- collapsing them into one would silently lose a real filing.
    const store = new FakeReportsStore([iamSecurity], [iamIssuer]);
    const routes = {
      '/fr/liste-etats-financiers-emetteurs': { body: ISSUER_DIRECTORY_HTML },
      '/fr/liste-etats-financiers-emetteurs?field_emetteur_target_id_verf=2798': {
        body: listingHtml([
          { slug: 'maroc-telecom-rsa-2017', year: '2017', typeLabel: 'Rapports annuels' },
          { slug: 'maroc-telecom-rsa-2015', year: '2015', typeLabel: 'Rapports annuels' },
        ]),
      },
      '/fr/espace-emetteurs/etats-financiers/maroc-telecom-rsa-2017': {
        body: detailHtml({
          issuer: 'MAROC TELECOM',
          year: '2017',
          typeLabel: 'Rapports annuels',
          fileName: 'SHARED.pdf',
        }),
      },
      '/fr/espace-emetteurs/etats-financiers/maroc-telecom-rsa-2015': {
        body: detailHtml({
          issuer: 'MAROC TELECOM',
          year: '2015',
          typeLabel: 'Rapports annuels',
          fileName: 'SHARED.pdf',
        }),
      },
      '/sites/default/files/SHARED.pdf': { body: '' },
    };
    const summary = await syncAnnualReports(scope({ ticker: 'IAM' }), store, {
      fetchImpl: fakeFetch(routes),
      delayMs: 0,
    });

    expect(summary.status).toBe('completed');
    expect(summary.documentsDiscovered).toBe(2);
    expect(summary.documentsInserted).toBe(2);
    expect(store.documents.size).toBe(2);
    expect(
      summary.failures.filter((f: SyncFailure) => f.stage === 'document_duplicate'),
    ).toHaveLength(0);
    const years = [...store.documents.values()].map((d) => d.fiscalYear).sort();
    expect(years).toEqual([2015, 2017]);
  });

  it('persists two distinct annual filings for the same issuer and fiscal year (e.g. consolidated + social)', async () => {
    const store = new FakeReportsStore([iamSecurity], [iamIssuer]);
    const routes = {
      '/fr/liste-etats-financiers-emetteurs': { body: ISSUER_DIRECTORY_HTML },
      '/fr/liste-etats-financiers-emetteurs?field_emetteur_target_id_verf=2798': {
        body: listingHtml([
          { slug: 'maroc-telecom-consolide-2024', year: '2024', typeLabel: 'Rapports annuels' },
          { slug: 'maroc-telecom-social-2024', year: '2024', typeLabel: 'Rapports annuels' },
        ]),
      },
      '/fr/espace-emetteurs/etats-financiers/maroc-telecom-consolide-2024': {
        body: detailHtml({
          issuer: 'MAROC TELECOM',
          year: '2024',
          typeLabel: 'Rapports annuels consolidés',
          fileName: 'MT_CONSOLIDE_2024.pdf',
        }),
      },
      '/fr/espace-emetteurs/etats-financiers/maroc-telecom-social-2024': {
        body: detailHtml({
          issuer: 'MAROC TELECOM',
          year: '2024',
          typeLabel: 'Rapports annuels sociaux',
          fileName: 'MT_SOCIAL_2024.pdf',
        }),
      },
    };
    const summary = await syncAnnualReports(scope({ ticker: 'IAM' }), store, {
      fetchImpl: fakeFetch(routes),
      delayMs: 0,
    });

    expect(summary.documentsInserted).toBe(2);
    expect(store.documents.size).toBe(2);
    const fileNames = [...store.documents.values()].map((d) => d.fileName).sort();
    expect(fileNames).toEqual(['MT_CONSOLIDE_2024.pdf', 'MT_SOCIAL_2024.pdf']);
  });

  it('collapses a true duplicate -- the identical filing record and asset discovered twice -- to one row without crashing', async () => {
    // A genuine duplicate: the very same AMMC listing row surfaces twice (e.g. a
    // listing/pagination overlap), so both discovered documents share the exact same
    // (source_record_url,source_url) pair. This must dedupe to one persisted row and keep the
    // run "completed", never a Postgres ON CONFLICT cardinality error.
    const store = new FakeReportsStore([iamSecurity], [iamIssuer]);
    const routes = {
      '/fr/liste-etats-financiers-emetteurs': { body: ISSUER_DIRECTORY_HTML },
      '/fr/liste-etats-financiers-emetteurs?field_emetteur_target_id_verf=2798': {
        body: listingHtml([
          { slug: 'maroc-telecom-rfa-2024', year: '2024', typeLabel: 'Rapports annuels' },
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
    };
    const summary = await syncAnnualReports(scope({ ticker: 'IAM' }), store, {
      fetchImpl: fakeFetch(routes),
      delayMs: 0,
    });

    expect(summary.status).toBe('completed');
    expect(summary.documentsDiscovered).toBe(2);
    expect(summary.documentsInserted).toBe(1);
    expect(store.documents.size).toBe(1);
    expect(
      summary.failures.some(
        (f: SyncFailure) =>
          f.stage === 'document_duplicate' && f.message.includes('TRUE_DUPLICATE_FILING'),
      ),
    ).toBe(true);
  });

  it("follows an issuer's listing pagination instead of stopping after page 0", async () => {
    // A listed issuer with many years of history spans more than one listing page; page 0
    // being non-empty must not stop the crawl short of the older filings on later pages.
    const store = new FakeReportsStore([iamSecurity], [iamIssuer]);
    const routes = {
      '/fr/liste-etats-financiers-emetteurs': { body: ISSUER_DIRECTORY_HTML },
      '/fr/liste-etats-financiers-emetteurs?field_emetteur_target_id_verf=2798': {
        body: listingHtml([
          { slug: 'maroc-telecom-rfa-2024', year: '2024', typeLabel: 'Rapports annuels' },
        ]),
      },
      '/fr/liste-etats-financiers-emetteurs?field_emetteur_target_id_verf=2798&page=1': {
        body: listingHtml([
          { slug: 'maroc-telecom-rfa-2015', year: '2015', typeLabel: 'Rapports annuels' },
        ]),
      },
      '/fr/liste-etats-financiers-emetteurs?field_emetteur_target_id_verf=2798&page=2': {
        body: listingHtml([]),
      },
      '/fr/espace-emetteurs/etats-financiers/maroc-telecom-rfa-2024': {
        body: detailHtml({
          issuer: 'MAROC TELECOM',
          year: '2024',
          typeLabel: 'Rapports annuels',
          fileName: 'MT_RFA_2024.pdf',
        }),
      },
      '/fr/espace-emetteurs/etats-financiers/maroc-telecom-rfa-2015': {
        body: detailHtml({
          issuer: 'MAROC TELECOM',
          year: '2015',
          typeLabel: 'Rapports annuels',
          fileName: 'MT_RFA_2015.pdf',
        }),
      },
    };
    const summary = await syncAnnualReports(scope({ ticker: 'IAM' }), store, {
      fetchImpl: fakeFetch(routes),
      delayMs: 0,
    });

    expect(summary.documentsInserted).toBe(2);
    const years = [...store.documents.values()].map((d) => d.fiscalYear).sort();
    expect(years).toEqual([2015, 2024]);
  });

  it('dry run discovers and classifies but never persists anything', async () => {
    const store = new FakeReportsStore([iamSecurity], [iamIssuer]);
    const summary = await syncAnnualReports(scope({ dryRun: true }), store, {
      fetchImpl: fakeFetch(mtRoutes),
      delayMs: 0,
    });

    expect(summary.runId).toBeNull();
    expect(summary.issuersCreated).toBe(1);
    expect(summary.documentsDiscovered).toBe(1);
    expect(summary.documentsInserted).toBe(0);
    expect(store.documents.size).toBe(0);
    expect(store.createdIssuers).toHaveLength(0);
    expect(store.runs).toHaveLength(0);
  });

  it('surfaces a genuine name collision as ambiguous, never guessing which issuer it is', async () => {
    const dupeIssuers: IssuerRef[] = [
      {
        id: 'a',
        name: 'MAROC TELECOM',
        normalizedName: 'MAROC TELECOM',
        ammcIssuerId: null,
        hasListedSecurity: false,
      },
      {
        id: 'b',
        name: 'Maroc Telecom',
        normalizedName: 'MAROC TELECOM',
        ammcIssuerId: null,
        hasListedSecurity: false,
      },
    ];
    const store = new FakeReportsStore([], dupeIssuers);
    const summary = await syncAnnualReports(scope(), store, {
      fetchImpl: fakeFetch({
        '/fr/liste-etats-financiers-emetteurs': { body: ISSUER_DIRECTORY_HTML },
      }),
      delayMs: 0,
    });

    expect(summary.issuersAmbiguous).toBeGreaterThanOrEqual(1);
    expect(store.ambiguous.has('2798')).toBe(true);
    expect(store.createdIssuers.some((d) => d.ammcIssuerId === '2798')).toBe(false);
  });

  it('a --ticker run for a security whose issuer has no resolvable AMMC entry fails clearly', async () => {
    const orphanIssuer: IssuerRef = {
      id: 'issuer-zzz',
      name: 'TOTALLY UNRELATED NAME',
      normalizedName: 'TOTALLY UNRELATED NAME',
      ammcIssuerId: null,
      hasListedSecurity: true,
    };
    const store = new FakeReportsStore(
      [{ id: 'sec-zzz', ticker: 'ZZZ', issuerId: 'issuer-zzz' }],
      [orphanIssuer],
    );
    const summary = await syncAnnualReports(scope({ ticker: 'ZZZ' }), store, {
      fetchImpl: fakeFetch({
        '/fr/liste-etats-financiers-emetteurs': { body: ISSUER_DIRECTORY_HTML },
      }),
      delayMs: 0,
    });

    expect(summary.documentsInserted).toBe(0);
    expect(summary.failures.some((f: SyncFailure) => f.stage === 'resolve_ticker')).toBe(true);
  });

  it('a validly-resolved issuer with zero reports is counted as issuersWithoutReports, not a failure', async () => {
    const store = new FakeReportsStore([iamSecurity], [iamIssuer]);
    const routes = {
      '/fr/liste-etats-financiers-emetteurs': { body: ISSUER_DIRECTORY_HTML },
      '/fr/liste-etats-financiers-emetteurs?field_emetteur_target_id_verf=2798': {
        body: listingHtml([]),
      },
    };
    const summary = await syncAnnualReports(scope({ ticker: 'IAM' }), store, {
      fetchImpl: fakeFetch(routes),
      delayMs: 0,
    });

    expect(summary.issuersWithoutReports).toBe(1);
    expect(summary.failures.filter((f: SyncFailure) => f.context === iamIssuer.name)).toHaveLength(
      0,
    );
  });

  it('excludes half-year rows and only keeps the requested fiscal year when --year is set', async () => {
    const store = new FakeReportsStore([iamSecurity], [iamIssuer]);
    const routes = {
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
    };
    const summary = await syncAnnualReports(scope({ year: 2024 }), store, {
      fetchImpl: fakeFetch(routes),
      delayMs: 0,
    });

    expect(summary.documentsInserted).toBe(1);
    expect([...store.documents.values()][0]!.fiscalYear).toBe(2024);
  });
});
