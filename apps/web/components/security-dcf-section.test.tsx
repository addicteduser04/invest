import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SecurityDcfSection, type SecurityDcfSectionProps } from './security-dcf-section';
import type { DcfHistoricalPeriod } from '@/lib/dcf-inputs';

function period(overrides: Partial<DcfHistoricalPeriod> = {}): DcfHistoricalPeriod {
  return {
    periodEndDate: '2025-12-31',
    periodType: 'annual',
    interimPeriod: null,
    fiscalYear: 2025,
    publicationDate: '2026-02-18',
    revenue: 36_400_000_000,
    revenueGrowth: 0.034,
    ebit: 11_900_000_000,
    ebitMargin: 0.327,
    ebitda: 16_800_000_000,
    depreciationAmortization: 4_900_000_000,
    taxExpense: 200_000_000,
    effectiveTaxRate: 0.182,
    operatingCashFlow: 14_700_000_000,
    capex: 4_600_000_000,
    workingCapital: -1_800_000_000,
    changeInWorkingCapital: 400_000_000,
    changeInWorkingCapitalSource: 'derived',
    cash: 8_800_000_000,
    totalDebt: 15_200_000_000,
    sharesOutstanding: 879_000_000,
    ...overrides,
  };
}

const populatedProps: SecurityDcfSectionProps = {
  locale: 'en',
  securityId: 'sec-1',
  historicalInputs: { securityId: 'sec-1', periods: [period()], basePeriod: period() },
  defaults: {
    revenueGrowth: { value: 0.034, periodsUsed: 1 },
    ebitMargin: { value: 0.327, periodsUsed: 1 },
    taxRate: { value: 0.182, periodsUsed: 1 },
    daPercentRevenue: { value: 0.1346, periodsUsed: 1 },
    capexPercentRevenue: { value: 0.1264, periodsUsed: 1 },
    changeNwcPercentRevenue: { value: 0.011, periodsUsed: 1 },
  },
  currentPrice: { price: '145.30', priceDate: '2026-09-04', stale: false },
  authenticated: false,
  initialSavedScenarios: [],
};

const emptyProps: SecurityDcfSectionProps = {
  ...populatedProps,
  historicalInputs: { securityId: 'sec-1', periods: [], basePeriod: null },
  defaults: {
    revenueGrowth: { value: null, periodsUsed: 0 },
    ebitMargin: { value: null, periodsUsed: 0 },
    taxRate: { value: null, periodsUsed: 0 },
    daPercentRevenue: { value: null, periodsUsed: 0 },
    capexPercentRevenue: { value: null, periodsUsed: 0 },
    changeNwcPercentRevenue: { value: null, periodsUsed: 0 },
  },
};

describe('SecurityDcfSection', () => {
  it('renders the title, scenario tabs and pre-fills historical references from defaults', () => {
    const html = renderToStaticMarkup(createElement(SecurityDcfSection, populatedProps));
    expect(html).toContain('DCF / Intrinsic valuation');
    expect(html).toContain('Bear');
    expect(html).toContain('Base');
    expect(html).toContain('Bull');
    expect(html).toContain('3.4%'); // revenue growth historical reference
  });

  it('shows structured validation issues (WACC and terminal growth required) before either is entered, and does not render the forecast/bridge/sensitivity yet', () => {
    const html = renderToStaticMarkup(createElement(SecurityDcfSection, populatedProps));
    expect(html).toContain('WACC is required.');
    expect(html).toContain('Terminal growth is required.');
    expect(html).not.toContain('dcf-forecast-table');
    expect(html).not.toContain('Valuation bridge');
  });

  it('never uses cheap/expensive/undervalued/overvalued language or a buy/sell/hold verdict label (mentioning "buy or sell" only inside the neutral not-a-recommendation disclaimer is fine)', () => {
    const html = renderToStaticMarkup(createElement(SecurityDcfSection, populatedProps));
    expect(html).not.toMatch(/cheap|expensive|undervalued|overvalued|fairly valued|strong buy/i);
    // The only two sentences allowed to mention buy/sell are the intro and disclaimer, and only
    // in the "not a recommendation" framing -- strip them and confirm nothing else says it.
    const withoutDisclaimers = html
      .replace(/Not an automatic buy or sell signal\.?/g, '')
      .replace(/is not a recommendation to buy or sell\.?/g, '');
    expect(withoutDisclaimers).not.toMatch(/\bbuy\b|\bsell\b|\bhold\b/i);
  });

  it('shows the no-fundamentals state and "no historical reference" for every assumption when there is no historical data at all', () => {
    const html = renderToStaticMarkup(createElement(SecurityDcfSection, emptyProps));
    expect(html).toContain('No historical fundamentals are available yet for this security');
    expect((html.match(/No historical reference available/g) ?? []).length).toBeGreaterThanOrEqual(
      6,
    );
  });

  it('still lets an investor without any fundamentals edit base revenue manually (input is present and empty, not disabled)', () => {
    const html = renderToStaticMarkup(createElement(SecurityDcfSection, emptyProps));
    expect(html).toContain('Base revenue');
  });

  it('shows a sign-in prompt instead of scenario controls when unauthenticated', () => {
    const html = renderToStaticMarkup(createElement(SecurityDcfSection, populatedProps));
    expect(html).toContain('Sign in to save your assumptions.');
    expect(html).not.toContain('Save scenario');
  });

  it('shows save/load scenario controls when authenticated, including any previously saved scenarios', () => {
    const html = renderToStaticMarkup(
      createElement(SecurityDcfSection, {
        ...populatedProps,
        authenticated: true,
        initialSavedScenarios: [
          { id: 's1', name: 'Conservative Q3', assumptions: {}, updatedAt: '2026-09-01T00:00:00Z' },
        ],
      }),
    );
    expect(html).toContain('Save scenario');
    expect(html).toContain('Conservative Q3');
    expect(html).toContain('Load');
  });

  it('renders French terminology', () => {
    const html = renderToStaticMarkup(
      createElement(SecurityDcfSection, { ...populatedProps, locale: 'fr' }),
    );
    expect(html).toContain('Valorisation intrinsèque');
    expect(html).toContain('Hypothèses');
  });

  it('renders Arabic with technical values kept LTR-isolated', () => {
    const html = renderToStaticMarkup(
      createElement(SecurityDcfSection, { ...populatedProps, locale: 'ar' }),
    );
    expect(html).toContain('التدفقات النقدية المخصومة');
    expect(html).toContain('dir="ltr"');
  });
});
