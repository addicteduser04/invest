import { redirect } from 'next/navigation';
import type { Locale } from '@bvc/contracts';
import { calculateRiskSummary, type RiskBand } from '@/lib/risk';
import { createClient } from '@/lib/supabase/server';
import { asLocale, direction, getUi } from '@/lib/i18n';
import { readPortfolioPerformance, readPortfolioValuation } from '@/lib/portfolio-read';
import { createPortfolio, logout } from '../auth-actions';
import { MarketTicker, type TickerItem } from '@/components/public/market-ticker';
import { PublicNav } from '@/components/public/public-nav';
import { PublicFooter } from '@/components/public/public-footer';
import { PortfolioPerformanceChart } from '@/components/public/portfolio-performance-chart';

type Period = '1m' | '3m' | 'ytd' | '1y' | '3y' | 'all';

interface MarketSecurity {
  id: string;
  ticker: string;
  name: string;
  sector: string | null;
  latest_close_price: string | null;
  daily_change_percent: string | number | null;
}

interface MarketIndex {
  id: string;
  code: string;
  name: string;
  latest_close_value: string | null;
  daily_change_percent: string | number | null;
}

interface TransactionRow {
  id: string;
  transaction_type: string;
  settlement_date: string;
  security_id: string | null;
  quantity: string | null;
  net_amount: string | null;
}

const money = (value: string | null | undefined, locale: Locale) =>
  value === null || value === undefined
    ? '—'
    : new Intl.NumberFormat(locale === 'ar' ? 'ar-MA' : locale === 'fr' ? 'fr-MA' : 'en-MA', {
        style: 'currency',
        currency: 'MAD',
        maximumFractionDigits: 2,
      }).format(Number(value));

const percent = (value: string | null | undefined, locale: Locale) =>
  value === null || value === undefined
    ? '—'
    : new Intl.NumberFormat(locale === 'ar' ? 'ar-MA' : locale === 'fr' ? 'fr-MA' : 'en-MA', {
        style: 'percent',
        maximumFractionDigits: 2,
      }).format(Number(value));

const signedPercent = (value: string | null | undefined) => {
  if (value === null || value === undefined) return '—';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '—';
  return `${numeric >= 0 ? '+' : ''}${(numeric * 100).toFixed(2)}%`;
};

const performanceStart = (period: Period, now: Date) => {
  if (period === 'all') return undefined;
  if (period === 'ytd') return new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const value = new Date(now);
  if (period === '1m') value.setUTCMonth(value.getUTCMonth() - 1);
  if (period === '3m') value.setUTCMonth(value.getUTCMonth() - 3);
  if (period === '1y') value.setUTCFullYear(value.getUTCFullYear() - 1);
  if (period === '3y') value.setUTCFullYear(value.getUTCFullYear() - 3);
  return value;
};

const transactionLabel = (value: string, locale: Locale, trackingMode?: string) => {
  const t = getUi(locale);
  switch (value) {
    case 'deposit':
      return t.deposit;
    case 'withdrawal':
      return t.withdrawal;
    case 'buy':
      return trackingMode === 'virtual' ? t.simulatedBuy : t.buy;
    case 'sell':
      return trackingMode === 'virtual' ? t.simulatedSell : t.sell;
    case 'dividend':
      return t.dividend;
    case 'fee':
      return t.fee;
    case 'tax':
      return t.tax;
    case 'reversal':
      return t.reversal;
    default:
      return value;
  }
};

const priceStatusLabel = (status: 'current' | 'stale' | 'missing', locale: Locale) => {
  const t = getUi(locale);
  if (status === 'stale') return t.priceStale;
  if (status === 'missing') return t.priceMissing;
  return t.priceCurrent;
};

const riskBandLabel = (band: RiskBand | null, locale: Locale) => {
  if (!band) return '—';
  const t = getUi(locale);
  if (band === 'very_low') return t.riskVeryLow;
  if (band === 'low') return t.riskLow;
  if (band === 'moderate') return t.riskModerate;
  if (band === 'high') return t.riskHigh;
  return t.riskVeryHigh;
};

const riskFromPerformance = (points: readonly { periodReturn: string | null }[]) => {
  const returns = points.flatMap((point) =>
    point.periodReturn === null ? [] : [Number(point.periodReturn)],
  );
  if (returns.some((value) => !Number.isFinite(value)))
    return { volatility: null, maxDrawdown: null, observationCount: 0 };
  const average = returns.length
    ? returns.reduce((sum, value) => sum + value, 0) / returns.length
    : 0;
  const volatility =
    returns.length >= 20
      ? Math.sqrt(
          returns.reduce((sum, value) => sum + (value - average) ** 2, 0) / returns.length,
        ) * Math.sqrt(252)
      : null;
  if (!returns.length) return { volatility, maxDrawdown: null, observationCount: 0 };
  let growth = 1;
  let peak = 1;
  let maxDrawdown = 0;
  for (const value of returns) {
    growth *= 1 + value;
    peak = Math.max(peak, growth);
    maxDrawdown = Math.min(maxDrawdown, growth / peak - 1);
  }
  return { volatility, maxDrawdown, observationCount: returns.length };
};

export default async function Dashboard({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ portfolio?: string; period?: string; recorded?: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = asLocale(rawLocale);
  const query = await searchParams;
  const period = parsePeriod(query.period);
  const now = new Date();
  const from = performanceStart(period, now);
  const t = getUi(locale);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/${locale}/login`);

  const [portfoliosResult, securitiesResult, indicesResult] = await Promise.all([
    supabase
      .from('portfolios')
      .select('id,name,tracking_mode,status,created_at')
      .eq('status', 'active')
      .order('created_at'),
    supabase
      .from('market_security_overview')
      .select('id,ticker,name,sector,latest_close_price,daily_change_percent')
      .eq('listing_status', 'active')
      .order('ticker'),
    supabase
      .from('market_index_overview')
      .select('id,code,name,latest_close_value,daily_change_percent')
      .in('code', ['MASI', 'MSI20', 'ESGI', 'MASIMS'])
      .order('code'),
  ]);
  const portfolios = portfoliosResult.data ?? [];
  const selected =
    portfolios.find((portfolio) => portfolio.id === query.portfolio) ?? portfolios[0];
  const marketSecurities = (securitiesResult.data ?? []) as MarketSecurity[];
  const marketIndices = (indicesResult.data ?? []) as MarketIndex[];
  const tickerItems = buildTickerItems(locale, marketIndices, marketSecurities);

  if (!selected) {
    return (
      <main className="public-page portfolio-v2-page" dir={direction(locale)}>
        <PublicNav locale={locale} authenticated />
        <MarketTicker locale={locale} items={tickerItems} />
        <section className="portfolio-v2-empty">
          <div>
            <p className="public-eyebrow">{t.portfolioV2Eyebrow}</p>
            <h1>{t.portfolioEmptyTitle}</h1>
            <p>{t.portfolioEmptySubtitle}</p>
            <div className="portfolio-v2-empty-proof">
              <span>{t.realTrackingHint}</span>
              <span>{t.benchmarkPriceDisclaimer}</span>
            </div>
          </div>
          <form className="portfolio-v2-create-form" action={createPortfolio}>
            <input type="hidden" name="locale" value={locale} />
            <label>
              {t.portfolioName}
              <input required name="name" maxLength={100} />
            </label>
            <label>
              {t.trackingMode}
              <select name="trackingMode" defaultValue="real_tracking">
                <option value="real_tracking">{t.realTracking}</option>
                <option value="virtual">{t.virtual}</option>
              </select>
            </label>
            <button type="submit">{t.createPortfolio}</button>
          </form>
        </section>
        <PublicFooter locale={locale} authenticated />
      </main>
    );
  }

  const [valuation, performance, transactionsResult, masiHistoryResult] = await Promise.all([
    readPortfolioValuation(selected.id),
    readPortfolioPerformance(selected.id, now, from),
    supabase
      .from('transactions')
      .select('id,transaction_type,settlement_date,security_id,quantity,net_amount')
      .eq('portfolio_id', selected.id)
      .order('ledger_sequence', { ascending: false })
      .limit(8),
    loadMasiHistory(supabase, from, now),
  ]);

  const currentValuation = valuation.status === 'ok' ? valuation.valuation : null;
  const currentPerformance = performance.status === 'ok' ? performance.performance : null;
  const transactions = (transactionsResult.data ?? []) as TransactionRow[];
  const openPositions =
    currentValuation?.positions.filter((position) => position.quantity !== '0') ?? [];
  const freshestPriceDate =
    openPositions
      .flatMap((position) => (position.marketDate ? [position.marketDate] : []))
      .sort()
      .at(-1) ??
    currentValuation?.valuationDate ??
    null;
  const totalReturnPercent = currentPerformance?.twr ?? null;
  const totalGain = Number(currentValuation?.totalGain ?? 0);
  const sectorWeights = buildSectorWeights(openPositions);
  const riskMetrics = riskFromPerformance(currentPerformance?.points ?? []);
  const riskSummary = calculateRiskSummary({
    positions: openPositions,
    cashValue: currentValuation?.cashValue,
    totalValue: currentValuation?.totalValue,
    annualizedVolatility: riskMetrics.volatility,
    maxDrawdown: riskMetrics.maxDrawdown,
    observationCount: riskMetrics.observationCount,
  });
  const periods = [
    ['1m', t.oneMonth],
    ['3m', t.threeMonths],
    ['ytd', t.yearToDate],
    ['1y', t.oneYear],
    ['3y', t.threeYears],
    ['all', t.sinceInception],
  ] as const;

  return (
    <main className="public-page portfolio-v2-page" dir={direction(locale)}>
      <PublicNav locale={locale} authenticated />
      <MarketTicker locale={locale} items={tickerItems} />

      <section className="portfolio-v2-hero">
        <div>
          <p className="public-eyebrow">{t.portfolioV2Eyebrow}</p>
          <h1>{selected.name}</h1>
          <div className="portfolio-v2-mode-line">
            <span>{selected.tracking_mode === 'virtual' ? t.virtual : t.realTracking}</span>
            <form action={logout}>
              <input type="hidden" name="locale" value={locale} />
              <button type="submit">{t.signOut}</button>
            </form>
          </div>
        </div>
        <div className="portfolio-v2-value-panel">
          <span>{t.totalValue}</span>
          <strong className="technical" dir="ltr">
            {money(currentValuation?.totalValue, locale)}
          </strong>
          <div>
            <em className={totalGain >= 0 ? 'positive' : 'negative'}>
              {money(currentValuation?.totalGain, locale)}
            </em>
            <em className={movementClass(totalReturnPercent)}>
              {signedPercent(totalReturnPercent)}
            </em>
          </div>
          <small>
            {t.cash}: <b dir="ltr">{money(currentValuation?.cashValue, locale)}</b> ·{' '}
            {t.latestValuationDate}: <b dir="ltr">{freshestPriceDate ?? '—'}</b>
          </small>
          <a href={`/${locale}/transactions/new?portfolio=${selected.id}`}>{t.recordTransaction}</a>
        </div>
      </section>

      {query.recorded === '1' ? (
        <p className="portfolio-v2-success" role="status">
          {t.transactionRecorded}
        </p>
      ) : null}

      {currentValuation?.status === 'missing' ? (
        <p className="portfolio-v2-muted-alert">{t.valuationUnavailable}</p>
      ) : currentValuation?.status === 'stale' ? (
        <p className="portfolio-v2-muted-alert">{t.stalePrices}</p>
      ) : null}

      <section className="portfolio-v2-chart-section">
        <div className="portfolio-v2-section-head">
          <div>
            <p className="public-eyebrow">{t.performance}</p>
            <h2>{t.portfolioPerformanceTitle}</h2>
          </div>
          <nav aria-label={t.period}>
            {periods.map(([value, label]) => (
              <a
                className={period === value ? 'active' : ''}
                href={`/${locale}/dashboard?portfolio=${selected.id}&period=${value}`}
                key={value}
              >
                {label}
              </a>
            ))}
          </nav>
        </div>
        <PortfolioPerformanceChart
          locale={locale}
          portfolio={currentPerformance?.points ?? []}
          benchmark={masiHistoryResult.data}
        />
      </section>

      <section className="portfolio-v2-metrics" aria-label={t.portfolioMetricsTitle}>
        <Metric
          label={t.securitiesValue}
          value={money(currentValuation?.securitiesValue, locale)}
        />
        <Metric label={t.cash} value={money(currentValuation?.cashValue, locale)} />
        <Metric
          label={t.realizedGain}
          value={money(currentValuation?.realizedGain, locale)}
          tone={Number(currentValuation?.realizedGain ?? 0)}
        />
        <Metric
          label={t.unrealizedGain}
          value={money(currentValuation?.unrealizedGain, locale)}
          tone={Number(currentValuation?.unrealizedGain ?? 0)}
        />
        <Metric label={t.netDividends} value={money(currentValuation?.netDividendIncome, locale)} />
        <Metric
          label={t.totalGain}
          value={money(currentValuation?.totalGain, locale)}
          tone={Number(currentValuation?.totalGain ?? 0)}
        />
        <Metric
          label={t.volatility}
          value={
            riskMetrics.volatility === null ? '—' : percent(String(riskMetrics.volatility), locale)
          }
        />
        <Metric
          label={t.maxDrawdown}
          value={
            riskMetrics.maxDrawdown === null
              ? '—'
              : percent(String(riskMetrics.maxDrawdown), locale)
          }
        />
      </section>

      <section className="portfolio-v2-grid">
        <div className="portfolio-v2-positions">
          <div className="portfolio-v2-section-head compact">
            <div>
              <p className="public-eyebrow">{t.holdings}</p>
              <h2>{t.positionsTitle}</h2>
            </div>
            <a href={`/${locale}/market`}>{t.market}</a>
          </div>
          {openPositions.length ? (
            <div className="portfolio-v2-position-table">
              <div className="portfolio-v2-position-head">
                <span>{t.ticker}</span>
                <span>{t.company}</span>
                <span>{t.quantity}</span>
                <span>{t.averageCost}</span>
                <span>{t.latestPrice}</span>
                <span>{t.marketValue}</span>
                <span>{t.weight}</span>
                <span>{t.unrealizedGain}</span>
                <span>{t.returnPercent}</span>
              </div>
              {openPositions.map((position) => {
                const returnPercent = position.averageCost
                  ? String(Number(position.price ?? 0) / Number(position.averageCost) - 1)
                  : null;
                return (
                  <a
                    className="portfolio-v2-position-row"
                    href={`/${locale}/market/${position.securityId}`}
                    key={position.securityId}
                  >
                    <span className="portfolio-v2-symbol" dir="ltr">
                      {position.ticker}
                    </span>
                    <span className="portfolio-v2-company">
                      <strong>{position.name}</strong>
                      <small>{position.sector ?? t.unavailable}</small>
                    </span>
                    <span className="technical" dir="ltr">
                      {position.quantity}
                    </span>
                    <span className="technical" dir="ltr">
                      {money(position.averageCost, locale)}
                    </span>
                    <span className="technical" dir="ltr">
                      {money(position.price, locale)}
                      {position.priceStatus !== 'current' ? (
                        <small>{priceStatusLabel(position.priceStatus, locale)}</small>
                      ) : null}
                    </span>
                    <span className="technical" dir="ltr">
                      {money(position.marketValue, locale)}
                    </span>
                    <span className="technical" dir="ltr">
                      {position.weightPercent
                        ? `${Number(position.weightPercent).toFixed(1)}%`
                        : '—'}
                    </span>
                    <span
                      className={`technical ${Number(position.unrealizedGain ?? 0) >= 0 ? 'positive' : 'negative'}`}
                      dir="ltr"
                    >
                      {money(position.unrealizedGain, locale)}
                    </span>
                    <span className={`technical ${movementClass(returnPercent)}`} dir="ltr">
                      {signedPercent(returnPercent)}
                    </span>
                  </a>
                );
              })}
            </div>
          ) : (
            <p className="portfolio-v2-empty-line">{t.noHoldings}</p>
          )}
        </div>

        <aside className="portfolio-v2-allocation">
          <p className="public-eyebrow">{t.risk}</p>
          <h2>{t.sectorAllocation}</h2>
          <div className="portfolio-v2-risk-score">
            <span>{t.riskScore}</span>
            <strong>{riskSummary.score === null ? '—' : `${riskSummary.score}/100`}</strong>
            <em>{riskBandLabel(riskSummary.band, locale)}</em>
          </div>
          <div className="portfolio-v2-allocation-bars">
            {sectorWeights.length ? (
              sectorWeights.map(([sector, weight]) => (
                <div key={sector}>
                  <span>{sector}</span>
                  <strong dir="ltr">{weight.toFixed(1)}%</strong>
                  <i>
                    <b style={{ width: `${Math.min(100, weight)}%` }} />
                  </i>
                </div>
              ))
            ) : (
              <p>{t.noHoldings}</p>
            )}
          </div>
          <small>{t.riskMethodology}</small>
        </aside>
      </section>

      <section className="portfolio-v2-activity">
        <div className="portfolio-v2-section-head compact">
          <div>
            <p className="public-eyebrow">{t.transactions}</p>
            <h2>{t.recentActivityTitle}</h2>
          </div>
          <div className="portfolio-v2-action-links">
            <a href={`/${locale}/transactions/new?portfolio=${selected.id}`}>
              {t.recordTransaction}
            </a>
            <a href={`/${locale}/transactions?portfolio=${selected.id}`}>{t.viewAll}</a>
          </div>
        </div>
        <div className="portfolio-v2-activity-grid">
          <div className="portfolio-v2-activity-list">
            {transactions.length ? (
              transactions.map((transaction) => (
                <a href={`/${locale}/transactions/${transaction.id}/reverse`} key={transaction.id}>
                  <span>
                    <strong>
                      {transactionLabel(
                        transaction.transaction_type,
                        locale,
                        selected.tracking_mode,
                      )}
                    </strong>
                    <small>{transaction.settlement_date}</small>
                  </span>
                  <span className="technical" dir="ltr">
                    {transaction.security_id
                      ? (marketSecurities.find(
                          (security) => security.id === transaction.security_id,
                        )?.ticker ?? '—')
                      : '—'}
                  </span>
                  <b className="technical" dir="ltr">
                    {money(transaction.net_amount, locale)}
                  </b>
                </a>
              ))
            ) : (
              <div className="portfolio-v2-activity-empty">
                <p>{t.noTransactions}</p>
                <a href={`/${locale}/transactions/new?portfolio=${selected.id}`}>
                  {t.recordDeposit}
                </a>
              </div>
            )}
          </div>
          <aside className="portfolio-v2-record-panel" id="record-transaction">
            <p className="public-eyebrow">{t.recordActivity}</p>
            <h3>{t.recordTransaction}</h3>
            <p>{t.recordHint}</p>
            <a href={`/${locale}/transactions/new?portfolio=${selected.id}`}>
              {t.recordTransaction}
            </a>
          </aside>
        </div>
      </section>
      <PublicFooter locale={locale} authenticated />
    </main>
  );
}

async function loadMasiHistory(
  supabase: Awaited<ReturnType<typeof createClient>>,
  from: Date | undefined,
  now: Date,
) {
  let query = supabase
    .from('market_index_history')
    .select('market_date,close_value')
    .eq('code', 'MASI')
    .lte('market_date', now.toISOString().slice(0, 10))
    .order('market_date', { ascending: true });
  if (from) query = query.gte('market_date', from.toISOString().slice(0, 10));
  const { data } = await query.limit(900);
  return { data: (data ?? []) as Array<{ market_date: string; close_value: string }> };
}

function parsePeriod(value: string | undefined): Period {
  return value === '1m' ||
    value === '3m' ||
    value === 'ytd' ||
    value === '1y' ||
    value === '3y' ||
    value === 'all'
    ? value
    : 'all';
}

function buildTickerItems(locale: Locale, indices: MarketIndex[], securities: MarketSecurity[]) {
  const indexItems: TickerItem[] = indices.map((index) => ({
    id: index.id,
    ticker: index.code,
    name: index.name,
    href: `/${locale}/market`,
    price: index.latest_close_value,
    changePercent: index.daily_change_percent,
    kind: 'index',
  }));
  const securityItems = securities
    .filter((security) => security.latest_close_price !== null)
    .sort(
      (left, right) =>
        priorityRank(left.ticker) - priorityRank(right.ticker) ||
        left.ticker.localeCompare(right.ticker),
    )
    .slice(0, 10)
    .map<TickerItem>((security) => ({
      id: security.id,
      ticker: security.ticker,
      name: security.name,
      href: `/${locale}/market/${security.id}`,
      price: security.latest_close_price,
      changePercent: security.daily_change_percent,
      kind: 'security',
    }));
  return [...indexItems, ...securityItems];
}

function priorityRank(ticker: string) {
  const rank = ['IAM', 'ATW', 'BCP'].indexOf(ticker);
  return rank === -1 ? 99 : rank;
}

function movementClass(value: string | null | undefined) {
  if (value === null || value === undefined) return '';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '';
  return numeric >= 0 ? 'positive' : 'negative';
}

function buildSectorWeights(
  positions: Array<{ sector: string | null; weightPercent: string | null }>,
) {
  return [
    ...positions
      .reduce((map, position) => {
        const sector = position.sector ?? '—';
        map.set(sector, (map.get(sector) ?? 0) + Number(position.weightPercent ?? '0'));
        return map;
      }, new Map<string, number>())
      .entries(),
  ].sort((left, right) => right[1] - left[1]);
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: number }) {
  return (
    <article>
      <span>{label}</span>
      <strong
        className={`technical ${tone === undefined ? '' : tone >= 0 ? 'positive' : 'negative'}`}
        dir="ltr"
      >
        {value}
      </strong>
    </article>
  );
}
