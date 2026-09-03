import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TransactionForm } from './transaction-form';

const securities = [
  { id: '00000000-0000-4000-8000-000000000001', ticker: 'IAM', name: 'ITISSALAT AL-MAGHRIB' },
  { id: '00000000-0000-4000-8000-000000000002', ticker: 'ATW', name: 'ATTIJARIWAFA BANK' },
  { id: '00000000-0000-4000-8000-000000000003', ticker: 'BCP', name: 'BCP' },
];

describe('TransactionForm', () => {
  it('renders the v2 type-first recorder and calculated review', () => {
    const html = renderToStaticMarkup(
      createElement(TransactionForm, {
        locale: 'en',
        portfolioId: '00000000-0000-4000-8000-000000000010',
        trackingMode: 'real_tracking',
        securities,
      }),
    );

    expect(html).toContain('Record selected activity');
    expect(html).toContain('Review before submit');
    expect(html).toContain('Net cash impact');
    expect(html).toContain('Recorded purchase');
    expect(html).toContain('Increase a holding');
    expect(html).not.toContain('broker');
    expect(html).not.toContain('execution');
  });

  it('keeps Arabic rendering usable with LTR financial review values', () => {
    const html = renderToStaticMarkup(
      createElement(TransactionForm, {
        locale: 'ar',
        portfolioId: '00000000-0000-4000-8000-000000000010',
        trackingMode: 'virtual',
        securities,
      }),
    );

    expect(html).toContain('تسجيل النشاط المحدد');
    expect(html).toContain('dir="ltr"');
    expect(html).toContain('شراء افتراضي');
  });
});
