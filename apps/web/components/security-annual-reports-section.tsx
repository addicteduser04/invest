import React from 'react';
import type { Locale } from '@bvc/contracts';
import { getUi } from '@/lib/i18n';
import type { AnnualReportView } from '@/lib/reports-read';

const intlLocale = (locale: Locale) =>
  locale === 'ar' ? 'ar-MA' : locale === 'fr' ? 'fr-MA' : 'en-MA';

const formatDate = (value: string | null, locale: Locale) =>
  value ? new Date(`${value}T00:00:00Z`).toLocaleDateString(intlLocale(locale)) : null;

const formatFileSize = (bytes: number | null) => {
  if (bytes === null || !Number.isFinite(bytes)) return null;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

// Never shows the raw source_provider_id string in the UI (docs/COMPANY_DOCUMENTS.md) --
// always a human attribution label.
function sourceLabel(reportProviderId: string, t: ReturnType<typeof getUi>) {
  return reportProviderId === 'ammc_public_documents'
    ? t.annualReportsSourceAmmc
    : t.annualReportsSourceAdmin;
}

export function SecurityAnnualReportsSection({
  locale,
  reports,
}: {
  locale: Locale;
  reports: AnnualReportView[];
}) {
  const t = getUi(locale);

  return (
    <section className="security-v2-fundamentals">
      <div className="security-v2-panel">
        <div className="security-v2-section-head">
          <div>
            <p className="public-eyebrow">{t.annualReportsEyebrow}</p>
            <h2>{t.annualReportsTitle}</h2>
          </div>
        </div>

        {reports.length === 0 ? (
          <p className="security-v2-note">{t.annualReportsEmpty}</p>
        ) : (
          <div className="table-scroll">
            <table className="table responsive-table">
              <thead>
                <tr>
                  <th data-numeric>{t.annualReportsColYear}</th>
                  <th>{t.annualReportsColReport}</th>
                  <th>{t.annualReportsColPublished}</th>
                  <th>{t.annualReportsColSource}</th>
                  <th>{t.annualReportsColDownload}</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((report) => (
                  <tr key={report.id}>
                    <td
                      data-label={t.annualReportsColYear}
                      data-numeric
                      className="technical"
                      dir="ltr"
                    >
                      {report.fiscalYear}
                    </td>
                    <td data-label={t.annualReportsColReport}>{report.title}</td>
                    <td data-label={t.annualReportsColPublished} className="technical" dir="ltr">
                      {formatDate(report.publicationDate, locale) ??
                        t.fundamentalsPublicationUnknown}
                    </td>
                    <td data-label={t.annualReportsColSource}>
                      <span dir="ltr">{sourceLabel(report.sourceProviderId, t)}</span>
                    </td>
                    <td data-label={t.annualReportsColDownload}>
                      <a
                        className="button compact secondary"
                        href={report.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {t.annualReportsDownload}
                        {formatFileSize(report.fileSizeBytes) ? (
                          <span className="technical" dir="ltr">
                            {' '}
                            ({formatFileSize(report.fileSizeBytes)})
                          </span>
                        ) : null}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
