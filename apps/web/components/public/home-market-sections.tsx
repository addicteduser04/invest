import type { Locale } from '@bvc/contracts';
import { getUi } from '@/lib/i18n';

export interface SecuritySnapshot {
  id: string;
  ticker: string;
  name: string;
  sector: string | null;
  latest_market_date: string | null;
  latest_close_price: string | null;
  daily_change_percent: string | number | null;
  volume?: string | number | null;
}

export interface IndexSnapshot {
  id: string;
  code: string;
  name: string;
  latest_market_date: string | null;
  latest_close_value: string | null;
  daily_change_percent: string | number | null;
}

export interface SecuritySparkline {
  securityId: string;
  points: Array<{ market_date: string; close_price: string }>;
}

export interface PortfolioPreviewData {
  authenticated: boolean;
  portfolioName: string | null;
  totalValue: string | null;
  securitiesValue: string | null;
  cashValue: string | null;
  totalGain: string | null;
  positionCount: number;
}

export function MarketSnapshot({
  locale,
  indices,
  movers,
}: {
  locale: Locale;
  indices: IndexSnapshot[];
  movers: { gainers: SecuritySnapshot[]; losers: SecuritySnapshot[]; active: SecuritySnapshot[] };
}) {
  const t = getUi(locale);
  const featured = indices.slice(0, 3);
  return (
    <section className="public-section market-snapshot-section">
      <SectionIntro
        eyebrow="BVC"
        title={t.marketSnapshotTitle}
        subtitle={t.marketSnapshotSubtitle}
      />
      <div className="market-snapshot-grid">
        <div className="index-board">
          {featured.length ? (
            featured.map((index) => (
              <article key={index.id} className="index-tile">
                <span>{index.code}</span>
                <strong className="technical" dir="ltr">
                  {formatIndex(index.latest_close_value, locale)}
                </strong>
                <em className={movementClass(index.daily_change_percent)} dir="ltr">
                  {formatPercent(index.daily_change_percent)}
                </em>
                <small>{index.latest_market_date ?? t.unavailable}</small>
              </article>
            ))
          ) : (
            <p className="empty-state">{t.masiChartUnavailable}</p>
          )}
        </div>
        <MoversColumn title={t.topGainers} rows={movers.gainers} locale={locale} />
        <MoversColumn title={t.topLosers} rows={movers.losers} locale={locale} />
        {movers.active.length ? (
          <MoversColumn title={t.mostActive} rows={movers.active} locale={locale} />
        ) : null}
      </div>
    </section>
  );
}

export function EquityDiscovery({
  locale,
  securities,
  sparklines,
}: {
  locale: Locale;
  securities: SecuritySnapshot[];
  sparklines: Map<string, SecuritySparkline['points']>;
}) {
  const t = getUi(locale);
  return (
    <section className="public-section equity-discovery-section">
      <SectionIntro
        eyebrow={t.navStocks}
        title={t.discoverEquitiesTitle}
        subtitle={t.discoverEquitiesSubtitle}
      />
      <div className="equity-list">
        {securities.map((security) => (
          <a className="equity-row-v2" href={`/${locale}/market/${security.id}`} key={security.id}>
            <span className="equity-symbol" dir="ltr">
              {security.ticker}
            </span>
            <span className="equity-name">
              <strong>{security.name}</strong>
              <small>{security.sector ?? t.unavailable}</small>
            </span>
            <MiniSparkline points={sparklines.get(security.id) ?? []} />
            <span className="equity-price technical" dir="ltr">
              <strong>{formatMoney(security.latest_close_price, locale)}</strong>
              <em className={movementClass(security.daily_change_percent)}>
                {formatPercent(security.daily_change_percent)}
              </em>
            </span>
          </a>
        ))}
      </div>
    </section>
  );
}

export function PortfolioPreview({ locale, data }: { locale: Locale; data: PortfolioPreviewData }) {
  const t = getUi(locale);
  const href = data.authenticated ? `/${locale}/dashboard` : `/${locale}/register`;
  return (
    <section className="public-section portfolio-preview-section">
      <div>
        <p className="public-eyebrow">{t.dashboard}</p>
        <h2>{data.authenticated ? t.portfolioPreviewSignedIn : t.portfolioPreviewTitle}</h2>
        <p>{data.authenticated ? t.portfolioPreviewSignedInCopy : t.portfolioPreviewSubtitle}</p>
        <a className="public-cta dark" href={href}>
          {data.authenticated ? t.dashboard : t.createAccount}
        </a>
      </div>
      <div className="portfolio-preview-terminal">
        <div className="portfolio-preview-head">
          <span>{data.portfolioName ?? t.portfolioTitle}</span>
          <strong>MAD</strong>
        </div>
        <strong className="portfolio-preview-value technical" dir="ltr">
          {formatMoney(data.totalValue, locale)}
        </strong>
        <div className="portfolio-preview-metrics">
          <Metric label={t.cash} value={formatMoney(data.cashValue, locale)} />
          <Metric label={t.securitiesValue} value={formatMoney(data.securitiesValue, locale)} />
          <Metric label={t.totalGain} value={formatMoney(data.totalGain, locale)} />
          <Metric label={t.holdings} value={String(data.positionCount)} />
        </div>
        <div className="allocation-preview" aria-hidden="true">
          <span style={{ width: '58%' }} />
          <span style={{ width: '24%' }} />
          <span style={{ width: '18%' }} />
        </div>
      </div>
    </section>
  );
}

export function SectionIntro({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="public-section-intro">
      <p className="public-eyebrow">{eyebrow}</p>
      <h2>{title}</h2>
      <p>{subtitle}</p>
    </div>
  );
}

function MoversColumn({
  title,
  rows,
  locale,
}: {
  title: string;
  rows: SecuritySnapshot[];
  locale: Locale;
}) {
  const t = getUi(locale);
  return (
    <article className="movers-column">
      <h3>{title}</h3>
      {rows.length ? (
        rows.map((row) => (
          <a href={`/${locale}/market/${row.id}`} key={row.id}>
            <span>
              <strong dir="ltr">{row.ticker}</strong>
              <small>{row.name}</small>
            </span>
            <span className="technical" dir="ltr">
              <b>{formatMoney(row.latest_close_price, locale)}</b>
              <em className={movementClass(row.daily_change_percent)}>
                {formatPercent(row.daily_change_percent)}
              </em>
            </span>
          </a>
        ))
      ) : (
        <p>{t.unavailable}</p>
      )}
    </article>
  );
}

export function MiniSparkline({
  points,
}: {
  points: Array<{ market_date: string; close_price: string }>;
}) {
  if (points.length < 2) return <span className="mini-sparkline empty" aria-hidden="true" />;
  const values = points.map((point) => Number(point.close_price)).filter(Number.isFinite);
  const max = Math.max(...values);
  const min = Math.min(...values);
  const spread = Math.max(max - min, 0.000001);
  return (
    <span className="mini-sparkline" aria-hidden="true">
      {points.slice(-34).map((point) => {
        const height = ((Number(point.close_price) - min) / spread) * 74 + 14;
        return <i key={point.market_date} style={{ height: `${height}%` }} />;
      })}
    </span>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <span>
      <small>{label}</small>
      <strong className="technical" dir="ltr">
        {value}
      </strong>
    </span>
  );
}

export function formatMoney(value: string | number | null | undefined, locale: Locale) {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat(locale === 'ar' ? 'ar-MA' : locale === 'fr' ? 'fr-MA' : 'en-MA', {
    style: 'currency',
    currency: 'MAD',
    maximumFractionDigits: 2,
  }).format(Number(value));
}

function formatIndex(value: string | number | null | undefined, locale: Locale) {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat(locale === 'ar' ? 'ar-MA' : locale === 'fr' ? 'fr-MA' : 'en-MA', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  }).format(Number(value));
}

function formatPercent(value: string | number | null | undefined) {
  if (value === null || value === undefined) return '—';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '—';
  return `${numeric >= 0 ? '+' : ''}${numeric.toFixed(2)}%`;
}

function movementClass(value: string | number | null | undefined) {
  if (value === null || value === undefined) return '';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '';
  return numeric >= 0 ? 'positive' : 'negative';
}
