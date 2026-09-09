import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ammcListingUrl,
  classifyAmmcReportType,
  normalizeAmmcIssuerName,
  parseAmmcDocumentDetail,
  parseAmmcFinancialStatementsListing,
  parseAmmcIssuerDirectory,
} from './ammc-reports';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__');
const fixture = (name: string) => readFileSync(join(fixturesDir, name), 'utf8');

describe('ammcListingUrl', () => {
  it('builds the base listing URL with no filters', () => {
    expect(ammcListingUrl()).toBe('https://www.ammc.ma/fr/liste-etats-financiers-emetteurs');
  });

  it('adds the issuer filter param', () => {
    expect(ammcListingUrl({ issuerId: '2798' })).toBe(
      'https://www.ammc.ma/fr/liste-etats-financiers-emetteurs?field_emetteur_target_id_verf=2798',
    );
  });

  it('adds a page param', () => {
    expect(ammcListingUrl({ issuerId: '2798', page: 2 })).toBe(
      'https://www.ammc.ma/fr/liste-etats-financiers-emetteurs?field_emetteur_target_id_verf=2798&page=2',
    );
  });
});

describe('classifyAmmcReportType', () => {
  it('classifies plain annual labels', () => {
    expect(classifyAmmcReportType('Rapports annuels')).toBe('annual');
  });

  it('classifies consolidated and standalone annual variants', () => {
    expect(classifyAmmcReportType('Rapports consolidés annuels')).toBe('annual');
    expect(classifyAmmcReportType('Rapports sociaux annuels')).toBe('annual');
  });

  it('classifies half-year labels, including the "1er semestre" phrasing', () => {
    expect(classifyAmmcReportType('Rapports 1er semestre')).toBe('half_year');
    expect(classifyAmmcReportType('Rapports consolidés 1er semestre')).toBe('half_year');
  });

  it('falls back to unknown for an unrecognized label', () => {
    expect(classifyAmmcReportType('Communiqué de presse')).toBe('unknown');
  });
});

describe('parseAmmcIssuerDirectory', () => {
  it('extracts every issuer option except the "All" placeholder', () => {
    const result = parseAmmcIssuerDirectory(fixture('ammc-listing.html'));
    expect(result.errors).toEqual([]);
    expect(result.issuers.length).toBeGreaterThan(150);
    expect(result.issuers.find((i) => i.issuerId === 'All')).toBeUndefined();
  });

  it('resolves known mission-example issuers to their real AMMC ids', () => {
    const { issuers } = parseAmmcIssuerDirectory(fixture('ammc-listing.html'));
    const byName = Object.fromEntries(issuers.map((i) => [i.issuerName, i.issuerId]));
    expect(byName['ATTIJARIWAFA BANK']).toBe('2734');
    expect(byName['Banque Centrale Populaire (BCP)']).toBe('2739');
    expect(byName['MAROC TELECOM']).toBe('2798');
    expect(byName['Bank of Africa - Groupe BMCE (BOA)']).toBe('2741');
  });

  it('decodes HTML entities in issuer names (e.g. apostrophes)', () => {
    const { issuers } = parseAmmcIssuerDirectory(fixture('ammc-listing.html'));
    expect(issuers.some((i) => i.issuerName === "Ciment de l'Atlas")).toBe(true);
  });

  it('reports an error for a page with no select element', () => {
    const result = parseAmmcIssuerDirectory('<html><body>no form here</body></html>');
    expect(result.issuers).toEqual([]);
    expect(result.errors).toContain('AMMC_ISSUER_SELECT_NOT_FOUND');
  });
});

describe('parseAmmcFinancialStatementsListing', () => {
  it('parses every row on the base (mixed-issuer) listing page', () => {
    const result = parseAmmcFinancialStatementsListing(fixture('ammc-listing.html'));
    expect(result.errors).toEqual([]);
    expect(result.rows.length).toBeGreaterThan(0);
    const first = result.rows[0]!;
    expect(first.issuerName).toBe('AUTO NEJMA');
    expect(first.detailUrl).toBe(
      'https://www.ammc.ma/fr/espace-emetteurs/etats-financiers/auto-nejma-rfa-2025',
    );
    expect(first.reportTypeLabel).toBe('Rapports annuels');
    expect(first.classification).toBe('annual');
    expect(first.fiscalYearLabel).toBe('2025');
  });

  it('reads the last-page number from the pager', () => {
    const result = parseAmmcFinancialStatementsListing(fixture('ammc-listing.html'));
    expect(result.lastPage).toBe(425);
  });

  it('classifies a mixed annual/half-year issuer listing correctly, excluding none silently', () => {
    const result = parseAmmcFinancialStatementsListing(fixture('ammc-listing-filtered-iam.html'));
    expect(result.errors).toEqual([]);
    expect(result.rows.length).toBe(15);
    const annual = result.rows.filter((r) => r.classification === 'annual');
    const halfYear = result.rows.filter((r) => r.classification === 'half_year');
    expect(annual.length).toBe(8);
    expect(halfYear.length).toBe(7);
    // Every row must be classified -- no silent "unknown" that would need manual triage.
    expect(result.rows.every((r) => r.classification !== 'unknown')).toBe(true);
  });

  it('returns an error and no rows for an unrelated page', () => {
    const result = parseAmmcFinancialStatementsListing('<html><body><table></table></body></html>');
    expect(result.rows).toEqual([]);
    expect(result.errors).toContain('AMMC_LISTING_NO_ROWS');
  });
});

describe('parseAmmcDocumentDetail', () => {
  it('parses a single-attachment annual report detail page', () => {
    const result = parseAmmcDocumentDetail(fixture('ammc-detail-annual.html'));
    expect(result.errors).toEqual([]);
    expect(result.detail).not.toBeNull();
    expect(result.detail!.issuerName).toBe('AUTO NEJMA');
    expect(result.detail!.fiscalYearLabel).toBe('2025');
    expect(result.detail!.reportTypeLabel).toBe('Rapports annuels');
    expect(result.detail!.classification).toBe('annual');
    expect(result.detail!.attachments).toEqual([
      {
        url: 'https://www.ammc.ma/sites/default/files/Auto_Nejma_RFA_2025.pdf',
        fileName: 'Auto_Nejma_RFA_2025.pdf',
        fileSizeLabel: '9.38 Mo',
      },
    ]);
  });

  it('extracts every attachment from a multi-attachment detail page', () => {
    const result = parseAmmcDocumentDetail(fixture('ammc-detail-multi-attachment.html'));
    expect(result.errors).toEqual([]);
    expect(result.detail!.attachments).toHaveLength(2);
    expect(result.detail!.attachments.map((a) => a.fileName)).toEqual([
      'Maroc_Telecom_RFA_2024.pdf',
      'Maroc_Teecom_Document_enregistrement_universel_2024.pdf',
    ]);
    expect(result.detail!.attachments[0]!.fileSizeLabel).toBe('4.47 Mo');
    expect(result.detail!.attachments[1]!.fileSizeLabel).toBe('7.41 Mo');
  });

  it('reports an unavailable attachment (no PDF link) without throwing', () => {
    const html = `<html><body><article><table><tr><td><b>Emetteur</b></td><td>TEST CO<br></td></tr>
      <tr><td><b>Année</b></td><td><time datetime="2024-01-01">2024</time><br></td></tr>
      <tr><td><b>Rapports financiers</b></td><td>Rapports annuels<br></td></tr>
      <tr><td><b>Pièce jointe</b></td><div class="multiple file field_attachement"><td><br></td></div></tr>
      </table></article></body></html>`;
    const result = parseAmmcDocumentDetail(html);
    expect(result.detail).not.toBeNull();
    expect(result.detail!.attachments).toEqual([]);
    expect(result.errors).toContain('AMMC_DETAIL_NO_ATTACHMENT');
  });

  it('returns a null detail and an error for a malformed/unrelated page', () => {
    const result = parseAmmcDocumentDetail('<html><body>not a report page</body></html>');
    expect(result.detail).toBeNull();
    expect(result.errors).toContain('AMMC_DETAIL_UNPARSEABLE');
  });
});

describe('normalizeAmmcIssuerName', () => {
  it('produces the same normalized form for equivalent BVC and AMMC spellings', () => {
    expect(normalizeAmmcIssuerName('AFRIC INDUSTRIES SA')).toBe(
      normalizeAmmcIssuerName('AFRIC INDUSTRIES SA'),
    );
    expect(normalizeAmmcIssuerName('LABEL VIE S.A.')).toBe(normalizeAmmcIssuerName('LABEL VIE'));
  });

  it('strips accents so they do not block a match', () => {
    expect(normalizeAmmcIssuerName('Ciment de l’Atlas')).toContain('CIMENT');
    expect(normalizeAmmcIssuerName('Attijariwafa Bank')).toBe('ATTIJARIWAFA BANK');
  });

  it('does not collapse two genuinely different issuers to the same key', () => {
    expect(normalizeAmmcIssuerName('HOLCIM')).not.toBe(normalizeAmmcIssuerName('HOLCIM MAROC'));
  });

  it('strips a trailing "(ex ...)" former-name parenthetical so it does not block a match', () => {
    expect(normalizeAmmcIssuerName('MED PAPER (ex Papelera de Tetuan)')).toBe(
      normalizeAmmcIssuerName('MED PAPER'),
    );
    expect(normalizeAmmcIssuerName('Taqa Morocco (ex JLEC)')).toBe(
      normalizeAmmcIssuerName('TAQA MOROCCO'),
    );
  });
});
