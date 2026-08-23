import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ImportWorkflow } from './import-workflow';

const portfolios = [{ id: '00000000-0000-4000-8000-000000000001', name: 'Pilote' }];
describe('localized import workflow', () => {
  it('renders the French upload and mapping boundary with accessible labels and status', () => {
    const html = renderToStaticMarkup(createElement(ImportWorkflow, { locale: 'fr', portfolios }));
    expect(html).toContain('Fichier CSV original');
    expect(html).toContain('Portefeuille');
    expect(html).toContain('role="status"');
    expect(html).toContain('Créer la prévisualisation');
  });
  it('renders the Arabic upload and mapping boundary without translating technical defaults', () => {
    const html = renderToStaticMarkup(createElement(ImportWorkflow, { locale: 'ar', portfolios }));
    expect(html).toContain('ملف CSV الأصلي');
    expect(html).toContain('المحفظة');
    expect(html).toContain('aria-live="polite"');
  });
});
