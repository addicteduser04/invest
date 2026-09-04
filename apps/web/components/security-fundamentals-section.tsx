import type { Locale } from '@bvc/contracts';
import { getUi } from '@/lib/i18n';
import type { FundamentalsView } from '@/lib/fundamentals-read';

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

const perShareMoney = (value: string | null, locale: Locale) => {
  const n = value === null ? NaN : Number(value);
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat(intlLocale(locale), {
    style: 'currency',
    currency: 'MAD',
    maximumFractionDigits: 2,
  }).format(n);
};

const compactCount = (value: string | null, locale: Locale) => {
  const n = value === null ? NaN : Number(value);
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat(intlLocale(locale), {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(n);
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

export function SecurityFundamentalsSection({
  locale,
  fundamentals,
}: {
  locale: Locale;
  fundamentals: FundamentalsView;
}) {
  const t = getUi(locale);
  const { latest, metrics, trend } = fundamentals;

  if (!latest) {
    return (
      <section className="security-v2-fundamentals">
        <div className="security-v2-section-head">
          <div>
            <p className="public-eyebrow">{t.fundamentalsEyebrow}</p>
            <h2>{t.fundamentalsTitle}</h2>
          </div>
        </div>
        <p className="security-v2-note">{t.fundamentalsEmpty}</p>
      </section>
    );
  }

  const f = latest.figures;
  const latestTiles: Array<{ label: string; value: string; toneClass?: string }> = [
    {
      label: t.fundamentalsRevenue,
      value: compactMoney(f.revenue === null ? null : Number(f.revenue), locale),
    },
    {
      label: t.fundamentalsEbitda,
      value: compactMoney(f.ebitda === null ? null : Number(f.ebitda), locale),
    },
    {
      label: t.fundamentalsEbit,
      value: compactMoney(f.ebit === null ? null : Number(f.ebit), locale),
    },
    {
      label: t.fundamentalsNetIncome,
      value: compactMoney(f.netIncome === null ? null : Number(f.netIncome), locale),
      toneClass: tone(f.netIncome === null ? null : Number(f.netIncome)),
    },
    { label: t.fundamentalsEps, value: perShareMoney(f.eps, locale) },
    {
      label: t.fundamentalsCash,
      value: compactMoney(
        f.cashAndEquivalents === null ? null : Number(f.cashAndEquivalents),
        locale,
      ),
    },
    {
      label: t.fundamentalsTotalDebt,
      value: compactMoney(f.totalDebt === null ? null : Number(f.totalDebt), locale),
    },
    {
      label: t.fundamentalsNetDebt,
      value: compactMoney(metrics.netDebt, locale),
      toneClass: tone(metrics.netDebt === null ? null : -metrics.netDebt),
    },
    {
      label: t.fundamentalsTotalAssets,
      value: compactMoney(f.totalAssets === null ? null : Number(f.totalAssets), locale),
    },
    {
      label: t.fundamentalsTotalEquity,
      value: compactMoney(f.totalEquity === null ? null : Number(f.totalEquity), locale),
      toneClass: tone(f.totalEquity === null ? null : Number(f.totalEquity)),
    },
    {
      label: t.fundamentalsOperatingCashFlow,
      value: compactMoney(
        f.operatingCashFlow === null ? null : Number(f.operatingCashFlow),
        locale,
      ),
    },
    {
      label: t.fundamentalsFreeCashFlow,
      value: compactMoney(metrics.freeCashFlow, locale),
      toneClass: tone(metrics.freeCashFlow),
    },
    { label: t.fundamentalsSharesOutstanding, value: compactCount(f.sharesOutstanding, locale) },
    { label: t.fundamentalsDividendPerShare, value: perShareMoney(f.dividendPerShare, locale) },
  ];

  const derivedTiles: Array<{ label: string; value: string; toneClass?: string }> = [
    {
      label: t.fundamentalsRevenueGrowth,
      value: percentRatio(metrics.revenueGrowth, locale),
      toneClass: tone(metrics.revenueGrowth),
    },
    {
      label: t.fundamentalsNetIncomeGrowth,
      value: percentRatio(metrics.netIncomeGrowth, locale),
      toneClass: tone(metrics.netIncomeGrowth),
    },
    {
      label: t.fundamentalsEpsGrowth,
      value: percentRatio(metrics.epsGrowth, locale),
      toneClass: tone(metrics.epsGrowth),
    },
    {
      label: t.fundamentalsEbitdaMargin,
      value: percentRatio(metrics.ebitdaMargin, locale),
      toneClass: tone(metrics.ebitdaMargin),
    },
    {
      label: t.fundamentalsEbitMargin,
      value: percentRatio(metrics.ebitMargin, locale),
      toneClass: tone(metrics.ebitMargin),
    },
    {
      label: t.fundamentalsNetMargin,
      value: percentRatio(metrics.netMargin, locale),
      toneClass: tone(metrics.netMargin),
    },
    {
      label: t.fundamentalsFcfMargin,
      value: percentRatio(metrics.fcfMargin, locale),
      toneClass: tone(metrics.fcfMargin),
    },
    { label: t.fundamentalsDebtToEquity, value: ratioX(metrics.debtToEquity, locale) },
    {
      label: t.fundamentalsRoe,
      value: percentRatio(metrics.roe, locale),
      toneClass: tone(metrics.roe),
    },
  ];

  return (
    <section className="security-v2-fundamentals">
      <div className="security-v2-panel">
        <div className="security-v2-section-head">
          <div>
            <p className="public-eyebrow">{t.fundamentalsEyebrow}</p>
            <h2>{t.fundamentalsTitle}</h2>
          </div>
          <span dir="ltr">{periodLabel(latest)}</span>
        </div>
        <p className="security-v2-note">
          {latest.publicationDate
            ? `${t.fundamentalsPublished}: ${latest.publicationDate}`
            : t.fundamentalsPublicationUnknown}
        </p>
        <div className="security-v2-metrics">
          {latestTiles.map((tile) => (
            <article key={tile.label}>
              <span>{tile.label}</span>
              <strong className={`technical ${tile.toneClass ?? ''}`} dir="ltr">
                {tile.value}
              </strong>
            </article>
          ))}
        </div>
      </div>

      <div className="security-v2-panel">
        <div className="security-v2-section-head">
          <div>
            <p className="public-eyebrow">{t.fundamentalsEyebrow}</p>
            <h2>{t.fundamentalsDerivedTitle}</h2>
          </div>
        </div>
        <div className="security-v2-metrics">
          {derivedTiles.map((tile) => (
            <article key={tile.label}>
              <span>{tile.label}</span>
              <strong className={`technical ${tile.toneClass ?? ''}`} dir="ltr">
                {tile.value}
              </strong>
            </article>
          ))}
        </div>
      </div>

      {trend.length >= 2 ? (
        <div className="security-v2-panel">
          <div className="security-v2-section-head">
            <div>
              <p className="public-eyebrow">{t.fundamentalsEyebrow}</p>
              <h2>{t.fundamentalsTrendTitle}</h2>
            </div>
          </div>
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>{t.fundamentalsPeriodEnded}</th>
                  <th>{t.fundamentalsRevenue}</th>
                  <th>{t.fundamentalsNetIncome}</th>
                  <th>{t.fundamentalsFreeCashFlow}</th>
                </tr>
              </thead>
              <tbody>
                {trend.map((point) => (
                  <tr key={point.periodEndDate}>
                    <td dir="ltr">{periodLabel(point)}</td>
                    <td className="technical" dir="ltr">
                      {compactMoney(point.revenue, locale)}
                    </td>
                    <td className={`technical ${tone(point.netIncome)}`} dir="ltr">
                      {compactMoney(point.netIncome, locale)}
                    </td>
                    <td className={`technical ${tone(point.freeCashFlow)}`} dir="ltr">
                      {compactMoney(point.freeCashFlow, locale)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </section>
  );
}
