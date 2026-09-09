/**
 * Pure parsing for the AMMC (Autorité Marocaine du Marché des Capitaux) public issuer
 * financial-statements directory -- the official regulator source for annual reports. No
 * network I/O and no Postgres dependency here; the ingestion-side fetch/match/persist
 * orchestration lives in @bvc/annual-reports, mirroring how the BVC parsers above stay
 * separate from @bvc/market-ingestion's PgIngestionStore.
 *
 * Site shape (verified against the live site, see the fixtures in ./__fixtures__):
 * - /fr/liste-etats-financiers-emetteurs is a Drupal Views listing, paginated, with an
 *   `field_emetteur_target_id_verf` GET filter (a numeric AMMC issuer id -- not a slug).
 * - Filtering by a single issuer returns EVERY report type for that issuer mixed together
 *   (annual, half-year, consolidated, standalone/"social") -- the "Type rapport" column text
 *   is the only reliable classifier; the listing URL itself is not annual-only.
 * - Each row links to a per-document detail page with a small field table (Emetteur, Année,
 *   Rapports financiers, Pièce jointe) and one or more PDF attachments -- a single detail page
 *   can carry more than one attachment (e.g. an annual report plus a separate universal
 *   registration document). Neither the detail-page URL nor the attachment URL is a reliable
 *   identity alone: the same PDF can be attached to two distinct filing records (different
 *   detail pages/fiscal years -- observed live for Meditelecom), and one detail page can carry
 *   more than one attachment. The true per-document identity is the pair (see
 *   docs/COMPANY_DOCUMENTS.md "Filing identity").
 * - The "Année" field is the fiscal year AMMC tags the filing under, not a genuine publication
 *   date (it is often stamped to the last days of that same fiscal year, before a real annual
 *   report could exist) -- never treated as publicationDate here.
 */

export const AMMC_PROVIDER_ID = 'ammc_public_documents' as const;
export const AMMC_BASE_URL = 'https://www.ammc.ma';
export const AMMC_FINANCIAL_STATEMENTS_LIST_PATH = '/fr/liste-etats-financiers-emetteurs';
export const AMMC_ISSUER_FILTER_PARAM = 'field_emetteur_target_id_verf';
export const AMMC_YEAR_FILTER_PARAM = 'field_annee_value_1';

export function ammcListingUrl(input: { issuerId?: string; page?: number } = {}): string {
  const url = new URL(AMMC_FINANCIAL_STATEMENTS_LIST_PATH, AMMC_BASE_URL);
  if (input.issuerId) url.searchParams.set(AMMC_ISSUER_FILTER_PARAM, input.issuerId);
  if (input.page) url.searchParams.set('page', String(input.page));
  return url.toString();
}

export function ammcAbsoluteUrl(hrefOrPath: string): string {
  return new URL(hrefOrPath, AMMC_BASE_URL).toString();
}

// --- Issuer directory (the exposed-filter <select>, used to resolve priority-2 exact-name
// matches and to display candidates for admin review) -------------------------------------

export interface AmmcIssuerOption {
  issuerId: string;
  issuerName: string;
}

export interface AmmcIssuerDirectoryResult {
  issuers: AmmcIssuerOption[];
  errors: string[];
}

const ISSUER_SELECT_RE =
  /<select[^>]*name="field_emetteur_target_id_verf"[^>]*>([\s\S]*?)<\/select>/;
const OPTION_RE = /<option value="([^"]+)"[^>]*>([^<]*)<\/option>/g;

export function parseAmmcIssuerDirectory(html: string): AmmcIssuerDirectoryResult {
  const errors: string[] = [];
  const selectMatch = ISSUER_SELECT_RE.exec(html);
  if (!selectMatch) {
    errors.push('AMMC_ISSUER_SELECT_NOT_FOUND');
    return { issuers: [], errors };
  }
  const issuers: AmmcIssuerOption[] = [];
  for (const match of selectMatch[1]!.matchAll(OPTION_RE)) {
    const issuerId = match[1]!.trim();
    if (issuerId === 'All') continue;
    const issuerName = decodeHtmlEntities(match[2]!).trim();
    if (!issuerName) continue;
    issuers.push({ issuerId, issuerName });
  }
  if (!issuers.length) errors.push('AMMC_ISSUER_LIST_EMPTY');
  return { issuers, errors };
}

// --- Financial-statements listing table -----------------------------------------------------

export type AmmcReportClassification = 'annual' | 'half_year' | 'unknown';

export function classifyAmmcReportType(label: string): AmmcReportClassification {
  const normalized = label.toLowerCase();
  if (normalized.includes('semestr')) return 'half_year';
  if (normalized.includes('annuel')) return 'annual';
  return 'unknown';
}

export interface AmmcListingRow {
  row: number;
  issuerName: string;
  detailUrl: string;
  reportTypeLabel: string;
  classification: AmmcReportClassification;
  fiscalYearLabel: string;
}

export interface AmmcListingPreview {
  rows: AmmcListingRow[];
  /** 0-indexed last ?page= value from the pager, or null when the listing fits on one page. */
  lastPage: number | null;
  errors: string[];
}

const ROW_RE = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
const EMETTEUR_CELL_RE = /views-field-field-emetteur"><a href="([^"]+)">(?:<a[^>]*>)?([^<]+)/;
const ANNEE_CELL_RE = /views-field-field-annee"><time[^>]*>([^<]+)<\/time>/;
const TYPE_CELL_RE = /views-field-field-type-rapp-ef-em"><a[^>]*>([^<]+)<\/a>/;
const LAST_PAGE_RE = /href="\?page=(\d+)"[^>]*\s+title="Aller à la dernière page"/;

export function parseAmmcFinancialStatementsListing(html: string): AmmcListingPreview {
  const errors: string[] = [];
  const rows: AmmcListingRow[] = [];
  let rowIndex = 0;
  for (const rowMatch of html.matchAll(ROW_RE)) {
    const block = rowMatch[1]!;
    const emetteur = EMETTEUR_CELL_RE.exec(block);
    if (!emetteur) continue; // header row or unrelated <tr>, not a data row
    const annee = ANNEE_CELL_RE.exec(block);
    const type = TYPE_CELL_RE.exec(block);
    rowIndex += 1;
    if (!annee || !type) {
      errors.push(`AMMC_LISTING_ROW_INCOMPLETE:${rowIndex}`);
      continue;
    }
    const reportTypeLabel = decodeHtmlEntities(type[1]!).trim();
    rows.push({
      row: rowIndex,
      issuerName: decodeHtmlEntities(emetteur[2]!).trim(),
      detailUrl: ammcAbsoluteUrl(emetteur[1]!),
      reportTypeLabel,
      classification: classifyAmmcReportType(reportTypeLabel),
      fiscalYearLabel: decodeHtmlEntities(annee[1]!).trim(),
    });
  }
  if (!rows.length) errors.push('AMMC_LISTING_NO_ROWS');
  const lastPageMatch = LAST_PAGE_RE.exec(html);
  return { rows, lastPage: lastPageMatch ? Number(lastPageMatch[1]) : null, errors };
}

// --- Document detail page ------------------------------------------------------------------

export interface AmmcAttachment {
  url: string;
  fileName: string;
  /** Raw AMMC-displayed size text (e.g. "9.38 Mo"), not parsed to bytes -- an exact
   * Content-Length is fetched with a HEAD request by the ingestion layer instead. */
  fileSizeLabel: string | null;
}

export interface AmmcDocumentDetail {
  issuerName: string | null;
  fiscalYearLabel: string | null;
  reportTypeLabel: string | null;
  classification: AmmcReportClassification;
  attachments: AmmcAttachment[];
}

export interface AmmcDocumentDetailResult {
  detail: AmmcDocumentDetail | null;
  errors: string[];
}

function extractFieldBlock(html: string, label: string): string | null {
  // The value cell normally follows the label cell immediately (`</td>\s*<td>`), but the
  // "Pièce jointe" row wraps its value cell in an extra `<div class="... field_attachement">`
  // first -- so the gap between the two `<td>`s is matched loosely, not as pure whitespace.
  const re = new RegExp(
    `<b>${escapeRegExp(label)}</b>[\\s\\S]*?<\\/td>[\\s\\S]*?<td>([\\s\\S]*?)<\\/tr>`,
  );
  const match = re.exec(html);
  return match ? match[1]! : null;
}

const DETAIL_ANCHOR_TEXT_RE = /<a[^>]*>([^<]+)<\/a>/;
const DETAIL_TIME_RE = /<time[^>]*>([^<]+)<\/time>/;
const ATTACHMENT_RE =
  /<a href="([^"]+)"[^>]*type="application\/pdf">([^<]+)<\/a>(?:<\/span>)?\s*(?:<span>\(([^)]*)\)<\/span>)?/g;

export function parseAmmcDocumentDetail(html: string): AmmcDocumentDetailResult {
  const errors: string[] = [];
  const issuerBlock = extractFieldBlock(html, 'Emetteur');
  const yearBlock = extractFieldBlock(html, 'Année');
  const typeBlock = extractFieldBlock(html, 'Rapports financiers');
  const attachmentBlock = extractFieldBlock(html, 'Pièce jointe');

  const issuerName = issuerBlock ? (DETAIL_ANCHOR_TEXT_RE.exec(issuerBlock)?.[1] ?? null) : null;
  const fiscalYearLabel = yearBlock ? (DETAIL_TIME_RE.exec(yearBlock)?.[1] ?? null) : null;
  const reportTypeLabel = typeBlock ? textFromBlock(typeBlock) || null : null;

  const attachments: AmmcAttachment[] = [];
  if (attachmentBlock) {
    for (const match of attachmentBlock.matchAll(ATTACHMENT_RE)) {
      attachments.push({
        url: ammcAbsoluteUrl(match[1]!),
        fileName: decodeHtmlEntities(match[2]!).trim(),
        fileSizeLabel: match[3] ? decodeHtmlEntities(match[3]).trim() : null,
      });
    }
  }

  if (!issuerName || !fiscalYearLabel || !reportTypeLabel) {
    errors.push('AMMC_DETAIL_FIELDS_INCOMPLETE');
  }
  if (!attachments.length) errors.push('AMMC_DETAIL_NO_ATTACHMENT');

  if (!issuerName && !fiscalYearLabel && !reportTypeLabel && !attachments.length) {
    return { detail: null, errors: ['AMMC_DETAIL_UNPARSEABLE'] };
  }

  return {
    detail: {
      issuerName: issuerName ? decodeHtmlEntities(issuerName).trim() : null,
      fiscalYearLabel,
      reportTypeLabel,
      classification: reportTypeLabel ? classifyAmmcReportType(reportTypeLabel) : 'unknown',
      attachments,
    },
    errors,
  };
}

// --- Issuer name normalization (priority-2 exact-match signal) -----------------------------

const COMBINING_DIACRITICS_RE = new RegExp('[\\u0300-\\u036f]', 'g');
// Deliberately does NOT strip "MAROC"/"MOROCCO": AMMC lists both a foreign parent and its
// Moroccan subsidiary as distinct issuers for several names (e.g. "HOLCIM" vs "HOLCIM MAROC",
// "TOTAL (France)" vs "TotalEnergies Marketing Maroc") -- stripping it would silently collide
// two different companies, which priority-2 exact matching must never do.
// Matched separately from NORMALIZE_STOPWORDS_RE: a parenthesized "(ex ...)" group is not itself
// bounded by word characters (the leading "(" breaks \b), so it must be stripped as its own pass
// before the \b-bounded stopword pass below runs.
const NORMALIZE_EX_PAREN_RE = /\(EX[^)]*\)/g;
const NORMALIZE_STOPWORDS_RE = /\b(SA|S\.A\.?|SARL|GROUPE|GROUP|EX)\b/g;

export function normalizeAmmcIssuerName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(COMBINING_DIACRITICS_RE, '')
    .toUpperCase()
    .replace(NORMALIZE_EX_PAREN_RE, ' ')
    .replace(NORMALIZE_STOPWORDS_RE, ' ')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function textFromBlock(block: string): string {
  return decodeHtmlEntities(block.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const HTML_ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&#039;': "'",
  '&apos;': "'",
  '&quot;': '"',
  '&lt;': '<',
  '&gt;': '>',
  '&nbsp;': ' ',
};

function decodeHtmlEntities(value: string): string {
  return value.replace(
    /&#039;|&apos;|&amp;|&quot;|&lt;|&gt;|&nbsp;/g,
    (entity) => HTML_ENTITIES[entity] ?? entity,
  );
}
