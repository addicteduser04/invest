import { describe, expect, it } from 'vitest';
import {
  detectForeignCountry,
  draftNewIssuer,
  resolveIssuer,
  suggestCandidateIssuer,
} from './matching';
import type { IssuerRef } from './types';

const iam: IssuerRef = {
  id: 'issuer-iam',
  name: 'ITISSALAT AL-MAGHRIB',
  normalizedName: 'ITISSALAT AL MAGHRIB',
  ammcIssuerId: '2798',
  hasListedSecurity: true,
};
const atw: IssuerRef = {
  id: 'issuer-atw',
  name: 'ATTIJARIWAFA BANK',
  normalizedName: 'ATTIJARIWAFA BANK',
  ammcIssuerId: null,
  hasListedSecurity: true,
};
const holcimMaroc: IssuerRef = {
  id: 'issuer-lhm',
  name: 'Holcim Maroc S.A',
  normalizedName: 'HOLCIM MAROC',
  ammcIssuerId: null,
  hasListedSecurity: true,
};
const issuers: IssuerRef[] = [iam, atw, holcimMaroc];

describe('resolveIssuer', () => {
  it('priority 1: resolves via ammc_issuer_id even when names differ completely', () => {
    const result = resolveIssuer({ issuerId: '2798', issuerName: 'MAROC TELECOM' }, issuers);
    expect(result).toEqual({ kind: 'existing', issuerId: iam.id });
  });

  it('priority 2: resolves via exact normalized name when no ammc_issuer_id is set yet', () => {
    const result = resolveIssuer({ issuerId: '2734', issuerName: 'ATTIJARIWAFA BANK' }, issuers);
    expect(result).toEqual({ kind: 'existing', issuerId: atw.id });
  });

  it('never collapses a foreign parent and its Moroccan subsidiary to the same match', () => {
    const result = resolveIssuer({ issuerId: '2778', issuerName: 'HOLCIM' }, issuers);
    expect(result.kind).toBe('created');
  });

  it('does not silently pick a winner when two issuers normalize to the same name (ambiguous)', () => {
    const dupes: IssuerRef[] = [
      {
        id: 'a',
        name: 'SAME NAME',
        normalizedName: 'SAME NAME',
        ammcIssuerId: null,
        hasListedSecurity: false,
      },
      {
        id: 'b',
        name: 'SAME NAME',
        normalizedName: 'SAME NAME',
        ammcIssuerId: null,
        hasListedSecurity: false,
      },
    ];
    const result = resolveIssuer({ issuerId: '1', issuerName: 'SAME NAME' }, dupes);
    expect(result).toEqual({ kind: 'ambiguous', issuerId: null });
  });

  it('resolves to "created" for a genuinely new issuer -- not an error', () => {
    const result = resolveIssuer({ issuerId: '9999', issuerName: 'OCP' }, issuers);
    expect(result).toEqual({ kind: 'created', issuerId: null });
  });
});

describe('draftNewIssuer', () => {
  it('drafts an unlisted Moroccan issuer by default', () => {
    const draft = draftNewIssuer({ issuerId: '13927', issuerName: 'OCP' });
    expect(draft.issuerType).toBe('unlisted_company');
    expect(draft.equityListingStatus).toBe('no_listed_bvc_equity');
    expect(draft.countryCode).toBeNull();
  });

  it('classifies a recognized foreign-parent marker as a foreign issuer', () => {
    const draft = draftNewIssuer({ issuerId: '2836', issuerName: 'TOTAL (France)' });
    expect(draft.issuerType).toBe('foreign_issuer');
    expect(draft.countryCode).toBe('FR');
    expect(draft.countryName).toBe('France');
  });

  it('never guesses a country it does not recognize', () => {
    const draft = draftNewIssuer({ issuerId: '1', issuerName: 'SOME COMPANY (Elsewhereland)' });
    expect(draft.issuerType).toBe('unlisted_company');
    expect(draft.countryCode).toBeNull();
  });
});

describe('detectForeignCountry', () => {
  it('recognizes the France marker with irregular spacing, as seen live on AMMC', () => {
    expect(detectForeignCountry('AIR LIQUIDE ( France)')).toEqual({ code: 'FR', name: 'France' });
  });

  it('returns null for a plain Moroccan name', () => {
    expect(detectForeignCountry('MAROC TELECOM')).toBeNull();
  });
});

describe('suggestCandidateIssuer', () => {
  it('suggests a partial (not exact) substring match for admin review only', () => {
    const candidate = suggestCandidateIssuer(
      { issuerId: '2784', issuerName: 'HOLCIM MAROC INDUSTRIE' },
      issuers,
    );
    expect(candidate).toBe(holcimMaroc.id);
  });

  it('returns null when nothing plausibly overlaps', () => {
    const candidate = suggestCandidateIssuer(
      { issuerId: '1', issuerName: 'ZZZ UNRELATED' },
      issuers,
    );
    expect(candidate).toBeNull();
  });
});
