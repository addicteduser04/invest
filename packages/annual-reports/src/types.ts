export interface SecurityRef {
  id: string;
  ticker: string;
  issuerId: string;
}

export interface IssuerRef {
  id: string;
  name: string;
  normalizedName: string;
  ammcIssuerId: string | null;
  hasListedSecurity: boolean;
}

export type IssuerResolutionKind = 'existing' | 'created' | 'ambiguous';

export interface ResolvedIssuer {
  kind: IssuerResolutionKind;
  issuerId: string | null;
}

export interface NewIssuerDraft {
  name: string;
  normalizedName: string;
  ammcIssuerId: string;
  ammcIssuerName: string;
  issuerType: 'unlisted_company' | 'foreign_issuer' | 'other';
  equityListingStatus: 'no_listed_bvc_equity' | 'unknown';
  countryCode: string | null;
  countryName: string | null;
}

export interface AmbiguousIssuer {
  sourceIssuerId: string;
  sourceIssuerName: string;
  candidateIssuerId: string | null;
}

export type DocumentStatus = 'published' | 'unavailable';

export interface DiscoveredDocument {
  issuerId: string;
  documentType: 'annual_report';
  fiscalYear: number;
  title: string;
  /** The AMMC filing/detail-page URL -- distinct from sourceUrl (the PDF asset). A FILE is not
   * a FILING: two different filing records can share one PDF, and one filing record can carry
   * more than one PDF. See docs/COMPANY_DOCUMENTS.md "Filing identity". */
  sourceRecordUrl: string;
  sourceUrl: string;
  publicationDate: string | null;
  language: string | null;
  fileName: string | null;
  fileSizeBytes: number | null;
  status: DocumentStatus;
}

export interface SyncScope {
  ticker?: string;
  year?: number;
  all?: boolean;
  dryRun: boolean;
}

export interface SyncFailure {
  stage: string;
  message: string;
  context?: string;
}

export type SyncStatus = 'completed' | 'failed';

export interface DocumentUpsertCounts {
  inserted: number;
  updated: number;
  unchanged: number;
}

export interface SyncCounters {
  issuersDiscovered: number;
  issuersExisting: number;
  issuersCreated: number;
  issuersLinkedToSecurity: number;
  issuersUnlisted: number;
  issuersAmbiguous: number;
  issuersWithReports: number;
  issuersWithoutReports: number;
  documentsDiscovered: number;
  documentsInserted: number;
  documentsUpdated: number;
  documentsUnchanged: number;
}

export interface SyncSummary extends SyncCounters {
  runId: string | null;
  status: SyncStatus;
  failures: SyncFailure[];
}
