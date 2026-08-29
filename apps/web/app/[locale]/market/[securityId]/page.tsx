import { notFound } from 'next/navigation';
import type { Locale } from '@bvc/contracts';
import { createClient } from '@/lib/supabase/server';
import { asLocale, direction, getUi } from '@/lib/i18n';
import { SiteNav } from '@/components/site-nav';
import { MarketPriceChart } from '@/components/market-price-chart';

const money = (value: string | null, locale: Locale) =>
  value
    ? new Intl.NumberFormat(locale === 'ar' ? 'ar-MA' : locale === 'fr' ? 'fr-MA' : 'en-MA', {
        style: 'currency',
        currency: 'MAD',
        maximumFractionDigits: 2,
      }).format(Number(value))
    : '—';

const providerLabel = (provider: string | null, locale: Locale) => {
  if (!provider) return '—';
  if (provider === 'synthetic')
    return locale === 'ar'
      ? 'بيانات اصطناعية'
      : locale === 'fr'
        ? 'Données synthétiques'
        : 'Synthetic data';
  if (provider === 'admin_csv')
    return locale === 'ar'
      ? 'ملف مسؤول موثّق'
      : locale === 'fr'
        ? 'CSV administrateur validé'
        : 'Validated administrator CSV';
  if (provider === 'licensed_api')
    return locale === 'ar'
      ? 'واجهة بيانات مرخصة'
      : locale === 'fr'
        ? 'API sous licence'
        : 'Licensed API';
  if (provider === 'licensed_sftp')
    return locale === 'ar'
      ? 'تغذية SFTP مرخصة'
      : locale === 'fr'
        ? 'Flux SFTP sous licence'
        : 'Licensed SFTP feed';
  if (provider === 'bvc_public_testing')
    return locale === 'ar'
      ? 'اختبار عام خاص فقط'
      : locale === 'fr'
        ? 'Test public privé uniquement'
        : 'Private public-data test';
  return provider;
};

export default async function SecurityPage({
  params,
}: {
  params: Promise<{ locale: string; securityId: string }>;
}) {
  const { locale: rawLocale, securityId } = await params;
  const locale = asLocale(rawLocale);
  const t = getUi(locale);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const [{ data: security }, { data: history }] = await Promise.all([
    supabase
      .from('market_security_overview')
      .select(
        'id,name,ticker,sector,listing_status,listed_on,is_synthetic,latest_market_date,latest_close_price,previous_market_date,previous_close_price,daily_change_percent,latest_price_provisional,latest_provider_id',
      )
      .eq('id', securityId)
      .maybeSingle(),
    supabase
      .from('market_price_history')
      .select('market_date,open_price,high_price,low_price,close_price,volume,status,provider_id')
      .eq('security_id', securityId)
      .order('market_date', { ascending: false })
      .limit(800),
  ]);
  if (!security) notFound();
  const ordered = [...(history ?? [])].reverse();
  const values = ordered.map((row) => Number(row.close_price)).filter(Number.isFinite);
  const max = Math.max(...values, 1);
  const min = Math.min(...values, max);
  const change =
    security.daily_change_percent === null ? null : Number(security.daily_change_percent);
  const first = ordered[0];
  const last = ordered.at(-1);
  const historyChange =
    first && last && Number(first.close_price) > 0
      ? (Number(last.close_price) / Number(first.close_price) - 1) * 100
      : null;

  return (
    <main className="app-shell" dir={direction(locale)}>
      <SiteNav locale={locale} authenticated={Boolean(user)} />
      <a className="text-link breadcrumb" href={`/${locale}/market`}>
        ← {t.backToMarket}
      </a>
      <section className="security-hero">
        <div>
          <div className="security-title-line">
            <span className="ticker-chip">{security.ticker}</span>
            {security.is_synthetic ? (
              <span className="mode-badge virtual">{t.synthetic}</span>
            ) : null}
            {security.latest_price_provisional ? (
              <span className="mode-badge">{t.provisional}</span>
            ) : null}
            {security.listing_status !== 'active' ? (
              <span className="mode-badge virtual">
                {security.listing_status === 'suspended' ? t.suspendedStatus : t.delistedStatus}
              </span>
            ) : null}
          </div>
          <h1>{security.name}</h1>
          <p className="muted">
            {security.sector ?? '—'} ·{' '}
            {security.listing_status === 'active'
              ? t.activeStatus
              : security.listing_status === 'suspended'
                ? t.suspendedStatus
                : t.delistedStatus}
          </p>
        </div>
        <div className="quote-block">
          <strong className="technical" dir="ltr">
            {money(
              security.latest_close_price ? String(security.latest_close_price) : null,
              locale,
            )}
          </strong>
          <span className={change === null ? '' : change >= 0 ? 'positive' : 'negative'} dir="ltr">
            {change === null ? '—' : `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`}
          </span>
          <small>{security.latest_market_date ?? t.noPrice}</small>
        </div>
      </section>

      <div className="dashboard-grid">
        <section className="card span-2">
          <div className="section-heading">
            <div>
              <p className="eyebrow">{t.priceHistory}</p>
              <h2>{security.ticker} / MAD</h2>
            </div>
            {historyChange !== null ? (
              <strong
                className={`technical ${historyChange >= 0 ? 'positive' : 'negative'}`}
                dir="ltr"
              >
                {historyChange >= 0 ? '+' : ''}
                {historyChange.toFixed(2)}%
              </strong>
            ) : null}
          </div>
          {ordered.length ? (
            <MarketPriceChart
              locale={locale}
              ticker={security.ticker}
              history={ordered.map((row) => ({
                market_date: row.market_date,
                open_price: row.open_price === null ? null : String(row.open_price),
                high_price: row.high_price === null ? null : String(row.high_price),
                low_price: row.low_price === null ? null : String(row.low_price),
                close_price: String(row.close_price),
                volume: row.volume === null ? null : String(row.volume),
              }))}
            />
          ) : (
            <p className="empty-state">{t.noPriceHistory}</p>
          )}
          {ordered.length ? (
            <div className="chart-stats">
              <span>
                <small>{t.priceHistory}</small>
                <strong>{ordered.length}</strong>
              </span>
              <span>
                <small>{t.chartLow}</small>
                <strong className="technical" dir="ltr">
                  {money(String(min), locale)}
                </strong>
              </span>
              <span>
                <small>{t.chartHigh}</small>
                <strong className="technical" dir="ltr">
                  {money(String(max), locale)}
                </strong>
              </span>
            </div>
          ) : null}
        </section>

        <section className="card">
          <p className="eyebrow">{t.companyOverview}</p>
          <dl className="facts-list">
            <div>
              <dt>{t.ticker}</dt>
              <dd>{security.ticker}</dd>
            </div>
            <div>
              <dt>{t.sector}</dt>
              <dd>{security.sector ?? '—'}</dd>
            </div>
            <div>
              <dt>{t.listingStatus}</dt>
              <dd>
                {security.listing_status === 'active'
                  ? t.activeStatus
                  : security.listing_status === 'suspended'
                    ? t.suspendedStatus
                    : t.delistedStatus}
              </dd>
            </div>
            <div>
              <dt>{t.latestPrice}</dt>
              <dd>
                {money(
                  security.latest_close_price ? String(security.latest_close_price) : null,
                  locale,
                )}
              </dd>
            </div>
            <div>
              <dt>{t.priceDate}</dt>
              <dd>{security.latest_market_date ?? '—'}</dd>
            </div>
            <div>
              <dt>{t.source}</dt>
              <dd>{providerLabel(security.latest_provider_id, locale)}</dd>
            </div>
          </dl>
          <p className="microcopy">{t.noFabricatedData}</p>
        </section>
      </div>

      <section className="card fundamentals-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">{t.fundamentals}</p>
            <h2>{t.fundamentals}</h2>
          </div>
        </div>
        <div className="fundamental-grid">
          {[t.marketCap, t.peRatio, t.roe, t.dividendYield].map((label) => (
            <div key={label}>
              <span>{label}</span>
              <strong>{t.unavailable}</strong>
            </div>
          ))}
        </div>
        <p className="microcopy">{t.fundamentalsUnavailable}</p>
      </section>
    </main>
  );
}
