import React from 'react';
import type { Locale } from '@bvc/contracts';
import { getUi } from '@/lib/i18n';
import type { ValuationSnapshot } from '@/lib/valuation-read';

const intlLocale = (locale: Locale) =>
  locale === 'ar' ? 'ar-MA' : locale === 'fr' ? 'fr-MA' : 'en-MA';

const compactMoney = (value: number | null, locale: Locale) => {
  if (value === null || !Number.isFinite(value)) return '—';
  const formatted = new Intl.NumberFormat(intlLocale(locale), {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
  return `${formatted} MAD`;
};

const percentRatio = (value: number | null, locale: Locale) => {
  if (value === null || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat(intlLocale(locale), {
    style: 'percent',
    maximumFractionDigits: 1,
    signDisplay: 'exceptZero',
  }).format(value);
};

const ratioX = (value: number | null, locale: Locale) => {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${new Intl.NumberFormat(intlLocale(locale), { maximumFractionDigits: 2 }).format(value)}x`;
};

const tone = (value: number | null) =>
  value === null || !Number.isFinite(value) ? '' : value >= 0 ? 'positive' : 'negative';

const periodLabel = (period: {
  periodType: 'annual' | 'interim';
  interimPeriod: 'H1' | 'H2' | null;
  fiscalYear: number;
}) =>
  period.periodType === 'annual'
    ? `FY${period.fiscalYear}`
    : `${period.interimPeriod} ${period.fiscalYear}`;

export function SecurityValuationSection({
  locale,
  valuation,
}: {
  locale: Locale;
  valuation: ValuationSnapshot;
}) {
  const t = getUi(locale);

  if (!valuation.hasFundamentals && !valuation.price) {
    return (
      <div className="security-v2-panel">
        <div className="security-v2-section-head">
          <div>
            <p className="public-eyebrow">{t.fundamentalsEyebrow}</p>
            <h2>{t.valuationTitle}</h2>
          </div>
        </div>
        <p className="security-v2-note">{t.valuationEmpty}</p>
      </div>
    );
  }

  const tiles: Array<{ label: string; value: string; toneClass?: string }> = [
    { label: t.valuationMarketCap, value: compactMoney(valuation.marketCap, locale) },
    { label: t.valuationEnterpriseValue, value: compactMoney(valuation.enterpriseValue, locale) },
    { label: t.valuationPe, value: ratioX(valuation.pe, locale) },
    { label: t.valuationPb, value: ratioX(valuation.pb, locale) },
    { label: t.valuationEvEbitda, value: ratioX(valuation.evEbitda, locale) },
    { label: t.valuationDividendYield, value: percentRatio(valuation.dividendYield, locale) },
    {
      label: t.valuationEarningsYield,
      value: percentRatio(valuation.earningsYield, locale),
      toneClass: tone(valuation.earningsYield),
    },
    {
      label: t.valuationFcfYield,
      value: percentRatio(valuation.fcfYield, locale),
      toneClass: tone(valuation.fcfYield),
    },
  ];

  return (
    <div className="security-v2-panel">
      <div className="security-v2-section-head">
        <div>
          <p className="public-eyebrow">{t.fundamentalsEyebrow}</p>
          <h2>{t.valuationTitle}</h2>
        </div>
        {valuation.fundamentalsPeriod ? (
          <span dir="ltr">{periodLabel(valuation.fundamentalsPeriod)}</span>
        ) : null}
      </div>
      <p className="security-v2-note">
        {valuation.priceDate ? (
          <span dir="ltr">
            {t.valuationPriceDate} {valuation.priceDate}
            {valuation.priceStale ? ` (${t.valuationPriceStale})` : ''}
          </span>
        ) : (
          t.valuationNoPrice
        )}
        {valuation.fundamentalsPeriod ? (
          <>
            {' · '}
            {t.fundamentalsPublished}: <span dir="ltr">{valuation.fundamentalsPeriod.publicationDate}</span>
          </>
        ) : null}
      </p>
      <div className="security-v2-metrics">
        {tiles.map((tile) => (
          <article key={tile.label}>
            <span>{tile.label}</span>
            <strong className={`technical ${tile.toneClass ?? ''}`} dir="ltr">
              {tile.value}
            </strong>
          </article>
        ))}
      </div>
    </div>
  );
}
