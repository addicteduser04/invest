import { describe, expect, it } from 'vitest';
import {
  resolveIssuerForSecurity,
  resolveSecurityForIssuer,
  suggestCandidateSecurity,
} from './matching';
import type { AliasRow, SecurityRef } from './types';

const iam: SecurityRef = { id: 'sec-iam', ticker: 'IAM', issuerName: 'ITISSALAT AL-MAGHRIB' };
const atw: SecurityRef = { id: 'sec-atw', ticker: 'ATW', issuerName: 'ATTIJARIWAFA BANK' };
const holcim: SecurityRef = { id: 'sec-lhm', ticker: 'LHM', issuerName: 'Holcim Maroc S.A' };
const securities: SecurityRef[] = [iam, atw, holcim];

describe('resolveSecurityForIssuer', () => {
  it('priority 1: resolves via an explicit alias even when names differ completely', () => {
    const aliases: AliasRow[] = [
      { securityId: iam.id, sourceIssuerId: '2798', sourceIssuerName: 'MAROC TELECOM' },
    ];
    const result = resolveSecurityForIssuer(
      { issuerId: '2798', issuerName: 'MAROC TELECOM' },
      aliases,
      securities,
    );
    expect(result).toEqual({ securityId: iam.id, reason: 'alias' });
  });

  it('priority 2: resolves via exact normalized name when no alias exists', () => {
    const result = resolveSecurityForIssuer(
      { issuerId: '2734', issuerName: 'ATTIJARIWAFA BANK' },
      [],
      securities,
    );
    expect(result).toEqual({ securityId: atw.id, reason: 'exact_name' });
  });

  it('never collapses a foreign parent and its Moroccan subsidiary to the same match', () => {
    const result = resolveSecurityForIssuer(
      { issuerId: '2778', issuerName: 'HOLCIM' },
      [],
      securities,
    );
    expect(result.securityId).toBeNull();
    expect(result.reason).toBe('unmatched');
  });

  it('does not silently pick a winner when two securities normalize to the same name', () => {
    const ambiguous: SecurityRef[] = [
      { id: 'a', ticker: 'AAA', issuerName: 'SAME NAME' },
      { id: 'b', ticker: 'BBB', issuerName: 'SAME NAME' },
    ];
    const result = resolveSecurityForIssuer(
      { issuerId: '1', issuerName: 'SAME NAME' },
      [],
      ambiguous,
    );
    expect(result).toEqual({ securityId: null, reason: 'ambiguous_name' });
  });

  it('returns unmatched for an issuer with no alias and no name match', () => {
    const result = resolveSecurityForIssuer(
      { issuerId: '9999', issuerName: 'SOME UNRELATED FRENCH COMPANY' },
      [],
      securities,
    );
    expect(result).toEqual({ securityId: null, reason: 'unmatched' });
  });
});

describe('resolveIssuerForSecurity', () => {
  const issuers = [
    { issuerId: '2798', issuerName: 'MAROC TELECOM' },
    { issuerId: '2734', issuerName: 'ATTIJARIWAFA BANK' },
  ];

  it('resolves via alias for a security whose name has no relation to the AMMC name', () => {
    const aliases: AliasRow[] = [
      { securityId: iam.id, sourceIssuerId: '2798', sourceIssuerName: 'MAROC TELECOM' },
    ];
    const result = resolveIssuerForSecurity(iam, aliases, issuers);
    expect(result).toEqual({ issuerId: '2798', issuerName: 'MAROC TELECOM' });
  });

  it('resolves via exact normalized name with no alias', () => {
    const result = resolveIssuerForSecurity(atw, [], issuers);
    expect(result).toEqual({ issuerId: '2734', issuerName: 'ATTIJARIWAFA BANK' });
  });

  it('returns null when nothing resolves', () => {
    const result = resolveIssuerForSecurity(holcim, [], issuers);
    expect(result).toBeNull();
  });
});

describe('suggestCandidateSecurity', () => {
  it('suggests a partial (not exact) substring match for admin review only', () => {
    const candidate = suggestCandidateSecurity(
      { issuerId: '2784', issuerName: 'HOLCIM MAROC INDUSTRIE' },
      securities,
    );
    expect(candidate).toBe(holcim.id);
  });

  it('returns null when nothing plausibly overlaps', () => {
    const candidate = suggestCandidateSecurity(
      { issuerId: '1', issuerName: 'ZZZ UNRELATED' },
      securities,
    );
    expect(candidate).toBeNull();
  });
});
