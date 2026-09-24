import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const { AdminSecurityImport } = await import('./admin-security-import');

describe('AdminSecurityImport', () => {
  it.each([
    ['en', 'Import from BVC'],
    ['fr', 'Importer depuis la BVC'],
    ['ar', 'استيراد من بورصة الدار البيضاء'],
  ] as const)('renders the localized BVC import button (%s)', (locale, label) => {
    const html = renderToStaticMarkup(createElement(AdminSecurityImport, { locale, rows: [] }));
    expect(html).toContain(label);
  });

  it('keeps the CSV upload controls alongside the BVC button', () => {
    const html = renderToStaticMarkup(
      createElement(AdminSecurityImport, { locale: 'en', rows: [] }),
    );
    expect(html).toContain('type="file"');
    expect(html).toContain('Validate file');
    expect(html).toContain('Import from BVC');
  });
});
