import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SecurityAnnualReportsSection } from './security-annual-reports-section';
import type { AnnualReportView } from '@/lib/reports-read';

function report(overrides: Partial<AnnualReportView> = {}): AnnualReportView {
  return {
    id: 'doc-1',
    fiscalYear: 2024,
    title: 'Rapports annuels 2024',
    sourceProviderId: 'ammc_public_documents',
    sourceUrl: 'https://www.ammc.ma/sites/default/files/Maroc_Telecom_RFA_2024.pdf',
    publicationDate: null,
    language: null,
    fileName: 'Maroc_Telecom_RFA_2024.pdf',
    fileSizeBytes: 4_690_000,
    ...overrides,
  };
}

describe('SecurityAnnualReportsSection', () => {
  it('renders the empty state when there are no indexed reports', () => {
    const html = renderToStaticMarkup(
      createElement(SecurityAnnualReportsSection, { locale: 'en', reports: [] }),
    );
    expect(html).toContain('No annual reports are currently indexed for this company.');
    expect(html).not.toContain('<table');
  });

  it('renders newest-first as provided, with year/title/source/download for each report', () => {
    const html = renderToStaticMarkup(
      createElement(SecurityAnnualReportsSection, {
        locale: 'en',
        reports: [report({ fiscalYear: 2024 }), report({ id: 'doc-2', fiscalYear: 2023 })],
      }),
    );
    const firstIndex = html.indexOf('2024');
    const secondIndex = html.indexOf('2023');
    expect(firstIndex).toBeGreaterThanOrEqual(0);
    expect(firstIndex).toBeLessThan(secondIndex);
    expect(html).toContain('Rapports annuels 2024');
    expect(html).toContain('Download PDF');
  });

  it('shows a human attribution label, never the raw provider id, for AMMC-sourced reports', () => {
    const html = renderToStaticMarkup(
      createElement(SecurityAnnualReportsSection, {
        locale: 'en',
        reports: [report({ sourceProviderId: 'ammc_public_documents' })],
      }),
    );
    expect(html).toContain('AMMC');
    expect(html).not.toContain('ammc_public_documents');
  });

  it('shows a distinct attribution label for manually-entered reports', () => {
    const html = renderToStaticMarkup(
      createElement(SecurityAnnualReportsSection, {
        locale: 'en',
        reports: [report({ sourceProviderId: 'admin_manual' })],
      }),
    );
    expect(html).toContain('SaifInvest');
  });

  it('links the download button directly to the official source URL, opened in a new tab', () => {
    const html = renderToStaticMarkup(
      createElement(SecurityAnnualReportsSection, { locale: 'en', reports: [report()] }),
    );
    expect(html).toContain(
      'href="https://www.ammc.ma/sites/default/files/Maroc_Telecom_RFA_2024.pdf"',
    );
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('falls back to "Publication date unknown" when unknown, never fabricating one', () => {
    const html = renderToStaticMarkup(
      createElement(SecurityAnnualReportsSection, {
        locale: 'en',
        reports: [report({ publicationDate: null })],
      }),
    );
    expect(html).toContain('Publication date unknown');
  });

  it('renders French and Arabic labels for the section title', () => {
    const fr = renderToStaticMarkup(
      createElement(SecurityAnnualReportsSection, { locale: 'fr', reports: [report()] }),
    );
    expect(fr).toContain('Rapports annuels');

    const ar = renderToStaticMarkup(
      createElement(SecurityAnnualReportsSection, { locale: 'ar', reports: [] }),
    );
    expect(ar).toContain('التقارير السنوية');
  });
});
