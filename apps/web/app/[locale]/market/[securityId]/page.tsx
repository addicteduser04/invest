import { notFound } from 'next/navigation';
import type { Locale } from '@bvc/contracts';
import { asLocale, direction, getUi } from '@/lib/i18n';
import { createClient } from '@/lib/supabase/server';
import { MarketPriceChart } from '@/components/market-price-chart';
import { MarketTicker, type TickerItem } from '@/components/public/market-ticker';
import { PublicNav } from '@/components/public/public-nav';
import { PublicFooter } from '@/components/public/public-footer';
import { SecurityFundamentalsSection } from '@/components/security-fundamentals-section';
import { readSecurityFundamentals } from '@/lib/fundamentals-read';

type PeriodKey = '1M' | '3M' | 'YTD' | '1Y' | '3Y';

interface SecurityRow {
  id: string;
  name: string;
  ticker: string;
  sector: string | null;
  listing_status: string;
  listed_on: string | null;
  is_synthetic: boolean;
  latest_market_date: string | null;
  latest_close_price: string | null;
  previous_market_date: string | null;
  previous_close_price: string | null;
  daily_change_percent: string | number | null;
  latest_price_provisional: boolean | null;
  latest_provider_id: string | null;
}

interface HistoryRow {
  market_date: string;
  open_price: string | null;
  high_price: string | null;
  low_price: string | null;
  close_price: string;
  volume: string | null;
  status: string;
  provider_id: string | null;
}

interface IndexRow {
  id: string;
  code: string;
  name: string;
  latest_market_date: string | null;
  latest_close_value: string | null;
  daily_change_percent: string | number | null;
}

interface IndexHistoryRow {
  market_date: string;
  close_value: string;
}

interface DetailMetric {
  label: string;
  value: string;
  tone?: string;
}

const periods: readonly PeriodKey[] = ['1M', '3M', 'YTD', '1Y', '3Y'];

const money = (value: string | number | null | undefined, locale: Locale) =>
  value === null || value === undefined || !Number.isFinite(Number(value))
    ? '—'
    : new Intl.NumberFormat(locale === 'ar' ? 'ar-MA' : locale === 'fr' ? 'fr-MA' : 'en-MA', {
        style: 'currency',
        currency: 'MAD',
        maximumFractionDigits: 2,
      }).format(Number(value));

const compactNumber = (value: string | number | null | undefined, locale: Locale) =>
  value === null || value === undefined || !Number.isFinite(Number(value))
    ? '—'
    : new Intl.NumberFormat(locale === 'ar' ? 'ar-MA' : locale === 'fr' ? 'fr-MA' : 'en-MA', {
        maximumFractionDigits: 0,
      }).format(Number(value));

const percent = (value: number | null | undefined, locale: Locale) =>
  value === null || value === undefined || !Number.isFinite(value)
    ? '—'
    : new Intl.NumberFormat(locale === 'ar' ? 'ar-MA' : locale === 'fr' ? 'fr-MA' : 'en-MA', {
        style: 'percent',
        maximumFractionDigits: 2,
      }).format(value / 100);

const signedMoney = (value: number | null, locale: Locale) =>
  value === null || !Number.isFinite(value)
    ? '—'
    : `${value >= 0 ? '+' : ''}${money(value, locale)}`;

const signedPercent = (value: number | null, locale: Locale) =>
  value === null || !Number.isFinite(value)
    ? '—'
    : `${value >= 0 ? '+' : ''}${percent(value, locale)}`;

const statusLabel = (status: string, locale: Locale) => {
  const t = getUi(locale);
  if (status === 'active') return t.activeStatus;
  if (status === 'suspended') return t.suspendedStatus;
  if (status === 'delisted') return t.delistedStatus;
  return status;
};

const providerLabel = (provider: string | null, locale: Locale) => {
  const t = getUi(locale);
  if (!provider) return '—';
  if (provider === 'synthetic') return t.synthetic;
  if (provider === 'admin_csv') return t.adminCsvProvider;
  if (provider === 'licensed_api') return t.licensedApiProvider;
  if (provider === 'licensed_sftp') return t.licensedSftpProvider;
  if (provider === 'bvc_public_testing') return t.bvcPublicTestingProvider;
  return provider;
};

const movementClass = (value: number | null | undefined) =>
  value === null || value === undefined || !Number.isFinite(value)
    ? ''
    : value >= 0
      ? 'positive'
      : 'negative';

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

  const [securityResult, historyResult, indicesResult, masiHistoryResult, fundamentals] =
    await Promise.all([
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
        .limit(900),
      supabase
        .from('market_index_overview')
        .select('id,code,name,latest_market_date,latest_close_value,daily_change_percent')
        .in('code', ['MASI', 'MSI20', 'ESGI', 'MASIMS'])
        .order('code'),
      supabase
        .from('market_index_history')
        .select('market_date,close_value')
        .eq('code', 'MASI')
        .order('market_date', { ascending: true })
        .limit(900),
      readSecurityFundamentals(securityId),
    ]);

  const security = securityResult.data as SecurityRow | null;
  if (!security) notFound();

  const history = ((historyResult.data ?? []) as HistoryRow[]).reverse();
  const indices = (indicesResult.data ?? []) as IndexRow[];
  const masiHistory = (masiHistoryResult.data ?? []) as IndexHistoryRow[];
  const tickerItems = buildTickerItems(locale, indices, security);
  const latestPrice = security.latest_close_price ? Number(security.latest_close_price) : null;
  const previousPrice = security.previous_close_price
    ? Number(security.previous_close_price)
    : null;
  const dailyAbsoluteChange =
    latestPrice !== null && previousPrice !== null ? latestPrice - previousPrice : null;
  const dailyPercent =
    security.daily_change_percent === null ? null : Number(security.daily_change_percent);
  const latestVolume = history.at(-1)?.volume ?? null;
  const metrics = buildMetrics(history, locale);
  const benchmarkRows = buildBenchmarkRows(history, masiHistory, locale);
  const relatedResult =
    security.sector === null
      ? { data: [] }
      : await supabase
          .from('market_security_overview')
          .select('id,name,ticker,sector,latest_close_price,daily_change_percent,listing_status')
          .neq('id', security.id)
          .eq('listing_status', 'active')
          .eq('sector', security.sector)
          .limit(4);
  const related = (relatedResult.data ?? []) as Array<
    Pick<
      SecurityRow,
      'id' | 'name' | 'ticker' | 'sector' | 'latest_close_price' | 'daily_change_percent'
    >
  >;

  return (
    <main className="public-page security-v2-page" dir={direction(locale)}>
      <PublicNav locale={locale} authenticated={Boolean(user)} />
      <MarketTicker locale={locale} items={tickerItems} />

      <section className="security-v2-hero">
        <div className="security-v2-identity">
          <a className="security-v2-back" href={`/${locale}/market`}>
            {t.backToMarket}
          </a>
          <p className="public-eyebrow">{security.sector ?? t.securityDetailEyebrow}</p>
          <h1 dir="ltr">{security.ticker}</h1>
          <strong>{security.name}</strong>
          <div className="security-v2-badges">
            <span>{security.sector ?? t.unavailable}</span>
            <span>{statusLabel(security.listing_status, locale)}</span>
            {security.is_synthetic ? <span>{t.synthetic}</span> : null}
            {security.latest_price_provisional ? <span>{t.provisional}</span> : null}
          </div>
        </div>

        <div className="security-v2-quote">
          <span>{t.latestPrice}</span>
          <strong className="technical" dir="ltr">
            {money(security.latest_close_price, locale)}
          </strong>
          <div>
            <em className={movementClass(dailyAbsoluteChange)} dir="ltr">
              {signedMoney(dailyAbsoluteChange, locale)}
            </em>
            <em className={movementClass(dailyPercent)} dir="ltr">
              {signedPercent(dailyPercent, locale)}
            </em>
          </div>
          <small>
            {t.latestMarketDate}: <b dir="ltr">{security.latest_market_date ?? '—'}</b>
          </small>
        </div>
      </section>

      <section className="security-v2-chart-section">
        <div className="security-v2-section-head">
          <div>
            <p className="public-eyebrow">{t.priceHistory}</p>
            <h2>{security.ticker} / MAD</h2>
          </div>
          <span>
            {history.length} {t.marketSessions}
          </span>
        </div>
        {history.length ? (
          <MarketPriceChart
            locale={locale}
            ticker={security.ticker}
            history={history.map((row) => ({
              market_date: row.market_date,
              open_price: row.open_price === null ? null : String(row.open_price),
              high_price: row.high_price === null ? null : String(row.high_price),
              low_price: row.low_price === null ? null : String(row.low_price),
              close_price: String(row.close_price),
              volume: row.volume === null ? null : String(row.volume),
            }))}
          />
        ) : (
          <p className="security-v2-empty">{t.noPriceHistory}</p>
        )}
      </section>

      <section className="security-v2-grid">
        <div className="security-v2-panel">
          <div className="security-v2-section-head">
            <div>
              <p className="public-eyebrow">{t.performance}</p>
              <h2>{t.performanceMetricsTitle}</h2>
            </div>
          </div>
          <div className="security-v2-metrics">
            {metrics.map((metric) => (
              <article key={metric.label}>
                <span>{metric.label}</span>
                <strong className={`technical ${metric.tone ?? ''}`} dir="ltr">
                  {metric.value}
                </strong>
              </article>
            ))}
            <article>
              <span>{t.latestVolume}</span>
              <strong className="technical" dir="ltr">
                {compactNumber(latestVolume, locale)}
              </strong>
            </article>
          </div>
        </div>

        <div className="security-v2-panel security-v2-context">
          <div className="security-v2-section-head">
            <div>
              <p className="public-eyebrow">{t.benchmark}</p>
              <h2>{t.securityVsMasi}</h2>
            </div>
          </div>
          {benchmarkRows.length ? (
            <div className="security-v2-benchmark">
              {benchmarkRows.map((row) => (
                <div key={row.period}>
                  <span>{row.period}</span>
                  <strong className={movementClass(row.securityReturn)} dir="ltr">
                    {signedPercent(row.securityReturn, locale)}
                  </strong>
                  <em className={movementClass(row.masiReturn)} dir="ltr">
                    MASI {signedPercent(row.masiReturn, locale)}
                  </em>
                </div>
              ))}
            </div>
          ) : (
            <p className="security-v2-note">{t.benchmarkUnavailable}</p>
          )}
        </div>
      </section>

      <SecurityFundamentalsSection locale={locale} fundamentals={fundamentals} />

      <section className="security-v2-info">
        <div>
          <p className="public-eyebrow">{t.companyOverview}</p>
          <h2>{security.name}</h2>
          <p>{t.noFabricatedData}</p>
        </div>
        <dl>
          <div>
            <dt>{t.ticker}</dt>
            <dd dir="ltr">{security.ticker}</dd>
          </div>
          <div>
            <dt>{t.company}</dt>
            <dd>{security.name}</dd>
          </div>
          <div>
            <dt>{t.sector}</dt>
            <dd>{security.sector ?? '—'}</dd>
          </div>
          <div>
            <dt>{t.listingStatus}</dt>
            <dd>{statusLabel(security.listing_status, locale)}</dd>
          </div>
          <div>
            <dt>{t.listedOn}</dt>
            <dd dir="ltr">{security.listed_on ?? '—'}</dd>
          </div>
          <div>
            <dt>{t.source}</dt>
            <dd>{providerLabel(security.latest_provider_id, locale)}</dd>
          </div>
        </dl>
      </section>

      {related.length ? (
        <section className="security-v2-related">
          <div className="security-v2-section-head">
            <div>
              <p className="public-eyebrow">{t.discovery}</p>
              <h2>{t.relatedSecurities}</h2>
            </div>
          </div>
          <div>
            {related.map((row) => {
              const change =
                row.daily_change_percent === null ? null : Number(row.daily_change_percent);
              return (
                <a href={`/${locale}/market/${row.id}`} key={row.id}>
                  <span dir="ltr">{row.ticker}</span>
                  <strong>{row.name}</strong>
                  <em className={movementClass(change)} dir="ltr">
                    {row.latest_close_price ? money(row.latest_close_price, locale) : '—'} ·{' '}
                    {signedPercent(change, locale)}
                  </em>
                </a>
              );
            })}
          </div>
        </section>
      ) : null}
      <PublicFooter locale={locale} authenticated={Boolean(user)} />
    </main>
  );
}

function buildMetrics(history: HistoryRow[], locale: Locale): DetailMetric[] {
  const rows = history
    .filter((row) => Number.isFinite(Number(row.close_price)))
    .sort((a, b) => a.market_date.localeCompare(b.market_date));
  const returns = periods.map((period) => {
    const value = periodReturn(rows, period);
    return {
      label: period === 'YTD' ? getUi(locale).yearToDate : period,
      value: signedPercent(value, locale),
      tone: movementClass(value),
    };
  });
  const lastDate = rows.at(-1)?.market_date;
  const fiftyTwoWeekRows = lastDate
    ? rows.filter((row) => row.market_date >= offsetDate(lastDate, 366))
    : [];
  const high = fiftyTwoWeekRows.length
    ? Math.max(...fiftyTwoWeekRows.map((row) => Number(row.high_price ?? row.close_price)))
    : null;
  const low = fiftyTwoWeekRows.length
    ? Math.min(...fiftyTwoWeekRows.map((row) => Number(row.low_price ?? row.close_price)))
    : null;
  const volumeRows = rows
    .map((row) => (row.volume === null ? null : Number(row.volume)))
    .filter((value): value is number => value !== null && Number.isFinite(value));
  const averageVolume = volumeRows.length
    ? volumeRows.reduce((sum, value) => sum + value, 0) / volumeRows.length
    : null;
  const volatility = annualizedVolatility(rows);
  const t = getUi(locale);
  return [
    ...returns,
    { label: t.fiftyTwoWeekHigh, value: money(high, locale) },
    { label: t.fiftyTwoWeekLow, value: money(low, locale) },
    { label: t.averageVolume, value: compactNumber(averageVolume, locale) },
    { label: t.volatility, value: percent(volatility, locale) },
  ];
}

function periodReturn(rows: HistoryRow[], period: PeriodKey) {
  const last = rows.at(-1);
  if (!last) return null;
  const cutoff =
    period === 'YTD'
      ? `${last.market_date.slice(0, 4)}-01-01`
      : offsetDate(
          last.market_date,
          period === '1M' ? 31 : period === '3M' ? 93 : period === '1Y' ? 366 : 1098,
        );
  const start = rows.find((row) => row.market_date >= cutoff) ?? (period === '3Y' ? rows[0] : null);
  if (!start || Number(start.close_price) <= 0) return null;
  return (Number(last.close_price) / Number(start.close_price) - 1) * 100;
}

function annualizedVolatility(rows: HistoryRow[]) {
  const returns: number[] = [];
  for (let index = 1; index < rows.length; index += 1) {
    const previous = Number(rows[index - 1]?.close_price);
    const current = Number(rows[index]?.close_price);
    if (previous > 0 && Number.isFinite(current)) returns.push(current / previous - 1);
  }
  if (returns.length < 20) return null;
  const average = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + (value - average) ** 2, 0) / returns.length;
  return Math.sqrt(variance) * Math.sqrt(252) * 100;
}

function buildBenchmarkRows(history: HistoryRow[], masiHistory: IndexHistoryRow[], locale: Locale) {
  const rows = [...history].sort((a, b) => a.market_date.localeCompare(b.market_date));
  const masiRows = [...masiHistory].sort((a, b) => a.market_date.localeCompare(b.market_date));
  return periods.flatMap((period) => {
    const securityReturn = periodReturn(rows, period);
    const masiReturn = indexPeriodReturn(masiRows, rows.at(-1)?.market_date, period);
    if (securityReturn === null || masiReturn === null) return [];
    return [
      {
        period: period === 'YTD' ? getUi(locale).yearToDate : period,
        securityReturn,
        masiReturn,
      },
    ];
  });
}

function indexPeriodReturn(
  rows: IndexHistoryRow[],
  latestDate: string | undefined,
  period: PeriodKey,
) {
  if (!latestDate) return null;
  const eligible = rows.filter((row) => row.market_date <= latestDate);
  const last = eligible.at(-1);
  if (!last) return null;
  const cutoff =
    period === 'YTD'
      ? `${last.market_date.slice(0, 4)}-01-01`
      : offsetDate(
          last.market_date,
          period === '1M' ? 31 : period === '3M' ? 93 : period === '1Y' ? 366 : 1098,
        );
  const start =
    eligible.find((row) => row.market_date >= cutoff) ?? (period === '3Y' ? eligible[0] : null);
  if (!start || Number(start.close_value) <= 0) return null;
  return (Number(last.close_value) / Number(start.close_value) - 1) * 100;
}

function offsetDate(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - days);
  return value.toISOString().slice(0, 10);
}

function buildTickerItems(
  locale: Locale,
  indices: IndexRow[],
  security: SecurityRow,
): TickerItem[] {
  return [
    ...indices.map((index) => ({
      id: index.id,
      ticker: index.code,
      name: index.name,
      price: index.latest_close_value,
      changePercent:
        index.daily_change_percent === null || index.daily_change_percent === undefined
          ? null
          : index.daily_change_percent,
      href: `/${locale}/market`,
      kind: 'index' as const,
    })),
    {
      id: security.id,
      ticker: security.ticker,
      name: security.name,
      price: security.latest_close_price,
      changePercent:
        security.daily_change_percent === null || security.daily_change_percent === undefined
          ? null
          : security.daily_change_percent,
      href: `/${locale}/market/${security.id}`,
      kind: 'security' as const,
    },
  ];
}
