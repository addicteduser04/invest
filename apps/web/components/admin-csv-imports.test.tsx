import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AdminCsvImports, type CsvImportRun } from './admin-csv-imports';

const UPLOADER_ID = '00000000-0000-4000-8000-000000000001';
const OTHER_ADMIN_ID = '00000000-0000-4000-8000-000000000002';

function run(overrides: Partial<CsvImportRun> = {}): CsvImportRun {
  return {
    id: 'run-1',
    status: 'previewed',
    source_hash: 'a'.repeat(64),
    original_object_path: `db-private://market-ingestion/${overrides.id ?? 'run-1'}/iam-prices.csv`,
    proposed_by: UPLOADER_ID,
    reviewed_by: null,
    created_at: '2026-09-04T10:00:00Z',
    published_at: null,
    candidate_count: 42,
    validation_report: null,
    ...overrides,
  };
}

describe('AdminCsvImports', () => {
  it('renders the CSV imports eyebrow and upload area (EN)', () => {
    const html = renderToStaticMarkup(
      createElement(AdminCsvImports, { locale: 'en', currentUserId: UPLOADER_ID, runs: [] }),
    );
    expect(html).toContain('Upload a CSV');
    expect(html).toContain('Drop CSV here');
    expect(html).toContain('Choose CSV');
  });

  it('shows the empty-history state when there are no runs', () => {
    const html = renderToStaticMarkup(
      createElement(AdminCsvImports, { locale: 'en', currentUserId: UPLOADER_ID, runs: [] }),
    );
    expect(html).toContain('No imports yet');
  });

  it('never renders the removed BVC public-data testing panel', () => {
    const html = renderToStaticMarkup(
      createElement(AdminCsvImports, { locale: 'en', currentUserId: UPLOADER_ID, runs: [run()] }),
    );
    expect(html).not.toMatch(/BVC public-data testing export/i);
    expect(html).not.toMatch(/Fetch testing CSV/i);
    expect(html).not.toMatch(/Fetch security master/i);
    expect(html).not.toMatch(/Fetch MASI history/i);
  });

  it('links to the canonical market-data admin page', () => {
    const html = renderToStaticMarkup(
      createElement(AdminCsvImports, { locale: 'en', currentUserId: UPLOADER_ID, runs: [] }),
    );
    expect(html).toContain('href="/en/admin/market-data"');
  });

  it('shows the two-admin explanation instead of an approval control when the current user is the uploader', () => {
    const html = renderToStaticMarkup(
      createElement(AdminCsvImports, {
        locale: 'en',
        currentUserId: UPLOADER_ID,
        runs: [run({ proposed_by: UPLOADER_ID })],
      }),
    );
    expect(html).toContain('a different data administrator');
    expect(html).not.toContain('approval-control');
  });

  it('shows the real approval control for an eligible second admin', () => {
    const html = renderToStaticMarkup(
      createElement(AdminCsvImports, {
        locale: 'en',
        currentUserId: OTHER_ADMIN_ID,
        runs: [run({ proposed_by: UPLOADER_ID })],
      }),
    );
    expect(html).toContain('Approve &amp; publish');
    expect(html).toContain('approval-control');
  });

  it('shows a dash (no action) for a run that is not awaiting review', () => {
    const html = renderToStaticMarkup(
      createElement(AdminCsvImports, {
        locale: 'en',
        currentUserId: OTHER_ADMIN_ID,
        runs: [
          run({
            status: 'published',
            proposed_by: UPLOADER_ID,
            reviewed_by: OTHER_ADMIN_ID,
            published_at: '2026-09-04T12:00:00Z',
          }),
        ],
      }),
    );
    expect(html).toContain('status-chip is-healthy');
  });

  it('extracts just the filename from the internal storage path, never leaking the private object path prefix', () => {
    const html = renderToStaticMarkup(
      createElement(AdminCsvImports, {
        locale: 'en',
        currentUserId: UPLOADER_ID,
        runs: [run({ original_object_path: 'db-private://market-ingestion/run-1/iam-prices.csv' })],
      }),
    );
    expect(html).toContain('iam-prices.csv');
    expect(html).not.toContain('db-private://');
  });

  it('renders French terminology', () => {
    const html = renderToStaticMarkup(
      createElement(AdminCsvImports, { locale: 'fr', currentUserId: UPLOADER_ID, runs: [] }),
    );
    expect(html).toContain('Importer un CSV');
    expect(html).toContain('Déposez le CSV ici');
  });

  it('renders Arabic with technical values kept LTR-isolated', () => {
    const html = renderToStaticMarkup(
      createElement(AdminCsvImports, {
        locale: 'ar',
        currentUserId: UPLOADER_ID,
        runs: [run({ status: 'quarantined' })],
      }),
    );
    expect(html).toContain('رفع ملف CSV');
    expect(html).toContain('dir="ltr"');
  });
});
