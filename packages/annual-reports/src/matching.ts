import { normalizeAmmcIssuerName, type AmmcIssuerOption } from '@bvc/market-data/ammc-reports';
import type { IssuerRef, NewIssuerDraft, ResolvedIssuer } from './types';

/**
 * Known foreign-parent markers AMMC appends to a cross-listed issuer's display name. Verified
 * against the live issuer directory (see packages/market-data/src/__fixtures__/ammc-listing.html)
 * -- France is, in practice, the only pattern actually observed there. Deliberately narrow: an
 * unrecognized name is left issuer_type=null/country=null (unknown) rather than guessed, per
 * "do not guess historical status if unknown".
 */
const FOREIGN_COUNTRY_MARKERS: Record<string, { code: string; name: string }> = {
  FRANCE: { code: 'FR', name: 'France' },
};

const TRAILING_COUNTRY_RE = /\(\s*([A-Za-zÀ-ÿ]+)\s*\)\s*$/;

export function detectForeignCountry(ammcName: string): { code: string; name: string } | null {
  const match = TRAILING_COUNTRY_RE.exec(ammcName);
  if (!match) return null;
  const key = match[1]!.toUpperCase();
  return FOREIGN_COUNTRY_MARKERS[key] ?? null;
}

/**
 * Deterministic issuer resolution for one AMMC issuer directory entry. Priority 1: an issuer
 * that already carries this exact ammc_issuer_id (market.issuers.ammc_issuer_id -- see
 * docs/COMPANY_DOCUMENTS.md for why this folds the old alias-table concept into a direct
 * column). Priority 2: exact normalized-name match against existing issuers, only when it
 * resolves to exactly one -- a collision with more than one existing issuer is "ambiguous" and
 * is never auto-resolved. Priority 3: no match at all -- draftNewIssuer() below describes how
 * to create one; this function itself never creates anything, it only decides whether to.
 */
export function resolveIssuer(
  ammcIssuer: AmmcIssuerOption,
  existingIssuers: readonly IssuerRef[],
): ResolvedIssuer {
  const byAmmcId = existingIssuers.find((i) => i.ammcIssuerId === ammcIssuer.issuerId);
  if (byAmmcId) return { kind: 'existing', issuerId: byAmmcId.id };

  const normalized = normalizeAmmcIssuerName(ammcIssuer.issuerName);
  const nameMatches = existingIssuers.filter((i) => i.normalizedName === normalized);
  if (nameMatches.length === 1) return { kind: 'existing', issuerId: nameMatches[0]!.id };
  if (nameMatches.length > 1) return { kind: 'ambiguous', issuerId: null };

  return { kind: 'created', issuerId: null };
}

/** Best-effort candidate to surface for admin review of an ambiguous issuer -- informational
 * only, never auto-applied. */
export function suggestCandidateIssuer(
  ammcIssuer: AmmcIssuerOption,
  existingIssuers: readonly IssuerRef[],
): string | null {
  const normalized = normalizeAmmcIssuerName(ammcIssuer.issuerName);
  if (normalized.length < 3) return null;
  const partial = existingIssuers.find(
    (i) => i.normalizedName.includes(normalized) || normalized.includes(i.normalizedName),
  );
  return partial?.id ?? null;
}

/** Shapes a brand-new issuer row for an AMMC issuer with no existing match at all. Country/
 * foreign-issuer classification is a narrow, disclosed heuristic (see detectForeignCountry);
 * anything not recognized stays 'unlisted_company'/'unknown' rather than guessed -- this is
 * only ever reached from resolveIssuer's 'created' outcome, i.e. genuinely no existing issuer
 * collided on either the AMMC id or the normalized name. */
export function draftNewIssuer(ammcIssuer: AmmcIssuerOption): NewIssuerDraft {
  const country = detectForeignCountry(ammcIssuer.issuerName);
  return {
    name: ammcIssuer.issuerName,
    normalizedName: normalizeAmmcIssuerName(ammcIssuer.issuerName),
    ammcIssuerId: ammcIssuer.issuerId,
    ammcIssuerName: ammcIssuer.issuerName,
    issuerType: country ? 'foreign_issuer' : 'unlisted_company',
    equityListingStatus: 'no_listed_bvc_equity',
    countryCode: country?.code ?? null,
    countryName: country?.name ?? null,
  };
}
