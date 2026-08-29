import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ReversalWorkflow, type ReversalTransaction } from './reversal-workflow';

const transaction: ReversalTransaction = {
  id: '00000000-0000-4000-8000-000000000002',
  portfolioId: '00000000-0000-4000-8000-000000000001',
  portfolioName: 'Pilote',
  type: 'buy',
  tradeDate: '2026-08-20',
  settlementDate: '2026-08-20',
  securityId: '00000000-0000-4000-8000-000000000003',
  securityLabel: 'SYN-IAM',
  quantity: '2.00000000',
  unitPrice: '50.000000',
  fees: '1.000000',
  taxes: '0.500000',
  netAmount: '-101.500000',
  currency: 'MAD',
  importId: '00000000-0000-4000-8000-000000000004',
};

describe('localized reversal workflow', () => {
  it('renders the accessible French correction form and immutable-history warning', () => {
    const html = renderToStaticMarkup(
      createElement(ReversalWorkflow, { locale: 'fr', transaction }),
    );
    expect(html).toContain('L’opération originale restera définitivement');
    expect(html).toContain('Motif détaillé de l’annulation');
    expect(html).toContain('role="status"');
    expect(html).toContain('Import source');
  });

  it('renders the English immutable correction workflow', () => {
    const html = renderToStaticMarkup(
      createElement(ReversalWorkflow, { locale: 'en', transaction }),
    );
    expect(html).toContain('The original transaction remains permanently in history');
    expect(html).toContain('Detailed reversal reason');
  });

  it('renders Arabic labels while isolating financial values in LTR', () => {
    const html = renderToStaticMarkup(
      createElement(ReversalWorkflow, { locale: 'ar', transaction }),
    );
    expect(html).toContain('ستبقى العملية الأصلية محفوظة دائماً');
    expect(html).toContain('السبب المفصل للعكس');
    expect(html).toContain('dir="ltr"');
    expect(html).toContain('+101.500000 MAD');
    expect(html).toContain('aria-live="polite"');
  });
});
