import { normalizeAmmcIssuerName, type AmmcIssuerOption } from '@bvc/market-data/ammc-reports';
import type { AliasRow, SecurityRef } from './types';

export type MatchReason = 'alias' | 'exact_name' | 'ambiguous_name' | 'unmatched';

export interface MatchResult {
  securityId: string | null;
  reason: MatchReason;
}

/**
 * Deterministic issuer -> security resolution. Priority 1: an explicit, admin-maintained
 * alias (keyed by the AMMC issuer id, which never changes even if AMMC edits the display
 * name). Priority 2: an exact match on normalized issuer name, but ONLY when it resolves to
 * exactly one security -- two securities colliding on the same normalized name is treated the
 * same as no match at all, never resolved by guessing. There is no priority-3 identifier match
 * yet (AMMC's directory does not expose ISIN), so an issuer that clears neither priority stays
 * unmatched for admin review; it is never silently attached to a "close enough" candidate.
 */
export function resolveSecurityForIssuer(
  issuer: AmmcIssuerOption,
  aliases: readonly AliasRow[],
  securities: readonly SecurityRef[],
): MatchResult {
  const alias = aliases.find((a) => a.sourceIssuerId === issuer.issuerId);
  if (alias) return { securityId: alias.securityId, reason: 'alias' };

  const normalizedIssuer = normalizeAmmcIssuerName(issuer.issuerName);
  const candidates = securities.filter(
    (security) =>
      security.issuerName !== null &&
      normalizeAmmcIssuerName(security.issuerName) === normalizedIssuer,
  );
  if (candidates.length === 1) return { securityId: candidates[0]!.id, reason: 'exact_name' };
  if (candidates.length > 1) return { securityId: null, reason: 'ambiguous_name' };
  return { securityId: null, reason: 'unmatched' };
}

/** The reverse direction of resolveSecurityForIssuer -- used for --ticker scoped runs, which
 * start from a known security and need to find its AMMC issuer entry rather than the other
 * way around. Same two-priority rule, same refusal to guess on an ambiguous name. */
export function resolveIssuerForSecurity(
  security: SecurityRef,
  aliases: readonly AliasRow[],
  issuers: readonly AmmcIssuerOption[],
): AmmcIssuerOption | null {
  const alias = aliases.find((a) => a.securityId === security.id);
  if (alias) {
    return (
      issuers.find((i) => i.issuerId === alias.sourceIssuerId) ?? {
        issuerId: alias.sourceIssuerId,
        issuerName: alias.sourceIssuerName,
      }
    );
  }
  if (!security.issuerName) return null;
  const normalizedSecurity = normalizeAmmcIssuerName(security.issuerName);
  const candidates = issuers.filter(
    (i) => normalizeAmmcIssuerName(i.issuerName) === normalizedSecurity,
  );
  return candidates.length === 1 ? candidates[0]! : null;
}

/** Best-effort candidate to surface for admin review of an unmatched issuer -- informational
 * only, never auto-attached. */
export function suggestCandidateSecurity(
  issuer: AmmcIssuerOption,
  securities: readonly SecurityRef[],
): string | null {
  const normalizedIssuer = normalizeAmmcIssuerName(issuer.issuerName);
  if (normalizedIssuer.length < 3) return null;
  const partial = securities.find(
    (security) =>
      security.issuerName !== null &&
      (normalizeAmmcIssuerName(security.issuerName).includes(normalizedIssuer) ||
        normalizedIssuer.includes(normalizeAmmcIssuerName(security.issuerName))),
  );
  return partial?.id ?? null;
}
