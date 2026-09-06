export interface SecurityRef {
  id: string;
  ticker: string;
  issuerName: string | null;
}

export interface AliasRow {
  securityId: string;
  sourceIssuerId: string;
  sourceIssuerName: string;
}

export interface UnmatchedIssuer {
  sourceIssuerId: string;
  sourceIssuerName: string;
  candidateSecurityId: string | null;
}

export type DocumentStatus = 'published' | 'unavailable';

export interface DiscoveredDocument {
  securityId: string;
  documentType: 'annual_report';
  fiscalYear: number;
  title: string;
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

export interface SyncSummary {
  runId: string | null;
  status: SyncStatus;
  documentsDiscovered: number;
  documentsMatched: number;
  documentsInserted: number;
  documentsUpdated: number;
  documentsUnchanged: number;
  unmatchedIssuers: UnmatchedIssuer[];
  failures: SyncFailure[];
}

export interface DocumentUpsertCounts {
  inserted: number;
  updated: number;
  unchanged: number;
}
