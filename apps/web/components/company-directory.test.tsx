import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CompanyDirectory } from './company-directory';
import type { IssuerSummary } from '@/lib/issuer-read';

function issuer(overrides: Partial<IssuerSummary> = {}): IssuerSummary {
  return {
    id: 'issuer-1',
    name: 'ITISSALAT AL-MAGHRIB',
    slug: 'itissalat-al-maghrib',
    countryCode: null,
    countryName: null,
    issuerType: 'listed_company',
    equityListingStatus: 'listed_bvc',
    website: null,
    sector: 'Telecommunications',
    securityId: 'sec-iam',
    securityTicker: 'IAM',
    ...overrides,
  };
}

describe('CompanyDirectory', () => {
  it('renders every issuer with its classification badge', () => {
    const issuers = [
      issuer(),
      issuer({
        id: 'issuer-2',
        name: 'OCP',
        slug: 'ocp',
        equityListingStatus: 'no_listed_bvc_equity',
        issuerType: 'unlisted_company',
        securityId: null,
        securityTicker: null,
      }),
      issuer({
        id: 'issuer-3',
        name: 'TOTAL',
        slug: 'total',
        equityListingStatus: 'no_listed_bvc_equity',
        issuerType: 'foreign_issuer',
        countryName: 'France',
        securityId: null,
        securityTicker: null,
      }),
    ];
    const html = renderToStaticMarkup(createElement(CompanyDirectory, { locale: 'en', issuers }));

    expect(html).toContain('ITISSALAT AL-MAGHRIB');
    expect(html).toContain('Listed BVC');
    expect(html).toContain('OCP');
    expect(html).toContain('Unlisted');
    expect(html).toContain('TOTAL');
    expect(html).toContain('Foreign issuer');
  });

  it('links each company card to its /companies/[slug] route', () => {
    const html = renderToStaticMarkup(
      createElement(CompanyDirectory, { locale: 'fr', issuers: [issuer()] }),
    );
    expect(html).toContain('href="/fr/companies/itissalat-al-maghrib"');
  });

  it('renders the empty state when there are no issuers at all', () => {
    const html = renderToStaticMarkup(
      createElement(CompanyDirectory, { locale: 'en', issuers: [] }),
    );
    expect(html).toContain('No companies match this search.');
  });

  it('renders Arabic filter labels', () => {
    const html = renderToStaticMarkup(
      createElement(CompanyDirectory, { locale: 'ar', issuers: [issuer()] }),
    );
    expect(html).toContain('مدرجة في البورصة');
  });
});
