import { redirect } from 'next/navigation';
import type { Locale } from '@bvc/contracts';
import { createClient } from '@/lib/supabase/server';
import { asLocale, direction, getUi } from '@/lib/i18n';
import { readPortfolioPerformance, readPortfolioValuation } from '@/lib/portfolio-read';
import { createPortfolio, logout } from '../auth-actions';
import { SiteNav } from '@/components/site-nav';
import { TransactionForm } from '@/components/transaction-form';
import { calculateRiskSummary, type RiskBand } from '@/lib/risk';
import { PortfolioAiInsight } from '@/components/portfolio-ai-insight';

const money = (value: string | null | undefined, locale: Locale) =>
  value === null || value === undefined
    ? '—'
    : new Intl.NumberFormat(locale === 'ar' ? 'ar-MA' : locale === 'fr' ? 'fr-MA' : 'en-MA', {
        style: 'currency',
        currency: 'MAD',
        maximumFractionDigits: 2,
      }).format(Number(value));

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

const percent = (value: string | null | undefined, locale: Locale) =>
  value === null || value === undefined
    ? '—'
    : new Intl.NumberFormat(locale === 'ar' ? 'ar-MA' : locale === 'fr' ? 'fr-MA' : 'en-MA', {
        style: 'percent',
        maximumFractionDigits: 2,
      }).format(Number(value));

const performanceStart = (period: '1m' | '3m' | '1y' | 'all', now: Date) => {
  if (period === 'all') return undefined;
  const value = new Date(now);
  if (period === '1m') value.setUTCMonth(value.getUTCMonth() - 1);
  if (period === '3m') value.setUTCMonth(value.getUTCMonth() - 3);
  if (period === '1y') value.setUTCFullYear(value.getUTCFullYear() - 1);
  return value;
};

const priceStatusLabel = (status: 'current' | 'stale' | 'missing', locale: Locale) => {
  const t = getUi(locale);
  if (status === 'stale') return t.priceStale;
  if (status === 'missing') return t.priceMissing;
  return t.priceCurrent;
};

const riskFromPerformance = (points: readonly { periodReturn: string | null }[]) => {
  const returns = points.flatMap((point) =>
    point.periodReturn === null ? [] : [Number(point.periodReturn)],
  );
  if (returns.some((value) => !Number.isFinite(value)))
    return { volatility: null, maxDrawdown: null, observationCount: 0 };
  const volatility =
    returns.length >= 20
      ? Math.sqrt(
          returns.reduce(
            (sum, value) =>
              sum + (value - returns.reduce((a, b) => a + b, 0) / returns.length) ** 2,
            0,
          ) / returns.length,
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

const riskBandLabel = (band: RiskBand | null, locale: Locale) => {
  if (!band) return '—';
  const t = getUi(locale);
  if (band === 'very_low') return t.riskVeryLow;
  if (band === 'low') return t.riskLow;
  if (band === 'moderate') return t.riskModerate;
  if (band === 'high') return t.riskHigh;
  return t.riskVeryHigh;
};

export default async function Dashboard({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ portfolio?: string; period?: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = asLocale(rawLocale);
  const query = await searchParams;
  const period =
    query.period === '1m' || query.period === '3m' || query.period === '1y' ? query.period : 'all';
  const performanceNow = new Date();
  const performanceFrom = performanceStart(period, performanceNow);
  const t = getUi(locale);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/${locale}/login`);

  const { data: portfolios } = await supabase
    .from('portfolios')
    .select('id,name,tracking_mode,status,created_at')
    .eq('status', 'active')
    .order('created_at');
  const selected =
    portfolios?.find((portfolio) => portfolio.id === query.portfolio) ?? portfolios?.[0];
  const { data: securities } = await supabase
    .from('market_security_overview')
    .select('id,ticker,name')
    .eq('listing_status', 'active')
    .order('ticker');

  let valuation: Awaited<ReturnType<typeof readPortfolioValuation>> | undefined;
  let performance: Awaited<ReturnType<typeof readPortfolioPerformance>> | undefined;
  let transactions: Record<string, unknown>[] = [];
  let securityLabels = new Map<string, string>();
  if (selected) {
    [valuation, performance] = await Promise.all([
      readPortfolioValuation(selected.id),
      readPortfolioPerformance(selected.id, performanceNow, performanceFrom),
    ]);
    const { data: transactionRows } = await supabase
      .from('transactions')
      .select(
        'id,transaction_type,settlement_date,security_id,quantity,unit_price,gross_amount,fees,taxes,net_amount,reverses_transaction_id,created_at',
      )
      .eq('portfolio_id', selected.id)
      .order('ledger_sequence', { ascending: false })
      .limit(20);
    transactions = (transactionRows ?? []) as Record<string, unknown>[];
    const ids = [
      ...new Set(transactions.flatMap((row) => (row.security_id ? [String(row.security_id)] : []))),
    ];
    if (ids.length) {
      const { data: labels } = await supabase
        .from('market_security_overview')
        .select('id,ticker')
        .in('id', ids);
      securityLabels = new Map((labels ?? []).map((row) => [row.id, row.ticker]));
    }
  }

  const currentValuation = valuation?.status === 'ok' ? valuation.valuation : null;
  const currentPerformance = performance?.status === 'ok' ? performance.performance : null;
  const openPositions =
    currentValuation?.positions.filter((position) => position.quantity !== '0') ?? [];
  const largestWeight = openPositions.reduce(
    (max, position) => Math.max(max, Number(position.weightPercent ?? '0')),
    0,
  );
  const sectorWeights = [
    ...openPositions
      .reduce((map, position) => {
        const sector = position.sector ?? '—';
        map.set(sector, (map.get(sector) ?? 0) + Number(position.weightPercent ?? '0'));
        return map;
      }, new Map<string, number>())
      .entries(),
  ].sort((a, b) => b[1] - a[1]);
  const insight = !openPositions.length
    ? t.insightEmpty
    : currentValuation?.status === 'missing'
      ? t.insightMissingPrices
      : currentValuation?.status === 'stale'
        ? t.insightStalePrices
        : largestWeight >= 35
          ? t.insightConcentrated
          : t.insightDiversified;
  const riskMetrics = riskFromPerformance(currentPerformance?.points ?? []);
  const riskSummary = calculateRiskSummary({
    positions: openPositions,
    cashValue: currentValuation?.cashValue,
    totalValue: currentValuation?.totalValue,
    annualizedVolatility: riskMetrics.volatility,
    maxDrawdown: riskMetrics.maxDrawdown,
    observationCount: riskMetrics.observationCount,
  });
  const freshestPriceDate =
    openPositions
      .flatMap((position) => (position.marketDate ? [position.marketDate] : []))
      .sort()
      .at(-1) ?? null;
  const periods = [
    ['1m', t.oneMonth],
    ['3m', t.threeMonths],
    ['1y', t.oneYear],
    ['all', t.sinceInception],
  ] as const;

  return (
    <main className="app-shell" dir={direction(locale)}>
      <SiteNav locale={locale} authenticated />
      <div className="page-heading">
        <div>
          <p className="eyebrow">{t.tagline}</p>
          <h1>{t.portfolioTitle}</h1>
        </div>
        <form action={logout}>
          <input type="hidden" name="locale" value={locale} />
          <button className="text-button" type="submit">
            {t.signOut}
          </button>
        </form>
      </div>

      {!selected ? (
        <section className="card onboarding-card">
          <div>
            <span className="section-kicker">01</span>
            <h2>{t.createPortfolio}</h2>
            <p className="muted">{t.notBroker}</p>
          </div>
          <form className="form" action={createPortfolio}>
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
            <p className="microcopy">{t.realTrackingHint}</p>
            <button className="button">{t.create}</button>
          </form>
        </section>
      ) : (
        <>
          <section className="portfolio-toolbar">
            <div>
              <span
                className={`mode-badge ${selected.tracking_mode === 'virtual' ? 'virtual' : ''}`}
              >
                {selected.tracking_mode === 'virtual' ? t.virtual : t.realTracking}
              </span>
              <h2>{selected.name}</h2>
              {freshestPriceDate ? (
                <small className="muted">
                  {t.priceDate}:{' '}
                  <span className="technical" dir="ltr">
                    {freshestPriceDate}
                  </span>
                </small>
              ) : null}
            </div>
            {portfolios && portfolios.length > 1 ? (
              <div className="portfolio-tabs">
                {portfolios.map((portfolio) => (
                  <a
                    key={portfolio.id}
                    className={portfolio.id === selected.id ? 'active' : ''}
                    href={`/${locale}/dashboard?portfolio=${portfolio.id}`}
                  >
                    {portfolio.name}
                  </a>
                ))}
              </div>
            ) : null}
          </section>

          <section className="metric-grid" aria-label={t.portfolioTitle}>
            {[
              [t.totalValue, currentValuation?.totalValue],
              [t.cash, currentValuation?.cashValue],
              [t.securitiesValue, currentValuation?.securitiesValue],
              [t.totalGain, currentValuation?.totalGain],
              [t.realizedGain, currentValuation?.realizedGain],
              [t.unrealizedGain, currentValuation?.unrealizedGain],
              [t.netDividends, currentValuation?.netDividendIncome],
              [t.standaloneExpenses, currentValuation?.standaloneExpenses],
            ].map(([label, value]) => (
              <article className="metric-card" key={label}>
                <span>{label}</span>
                <strong className="technical" dir="ltr">
                  {money(value, locale)}
                </strong>
              </article>
            ))}
          </section>

          {currentValuation?.status === 'missing' ? (
            <p className="notice warning-text">{t.valuationUnavailable}</p>
          ) : currentValuation?.status === 'stale' ? (
            <p className="notice warning-text">{t.stalePrices}</p>
          ) : null}

          <div className="dashboard-grid">
            <section className="card span-2">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">{t.performance}</p>
                  <h2>{t.holdings}</h2>
                </div>
                <a className="text-link" href={`/${locale}/market`}>
                  {t.market} →
                </a>
              </div>
              {currentValuation?.positions.some((position) => position.quantity !== '0') ? (
                <div className="table-scroll">
                  <table className="table holdings-table">
                    <thead>
                      <tr>
                        <th>{t.ticker}</th>
                        <th>{t.quantity}</th>
                        <th>{t.averageCost}</th>
                        <th>{t.marketPrice}</th>
                        <th>{t.marketValue}</th>
                        <th>{t.unrealizedGain}</th>
                        <th>{t.weight}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {currentValuation.positions
                        .filter((position) => position.quantity !== '0')
                        .map((position) => (
                          <tr key={position.securityId}>
                            <td>
                              <a
                                className="ticker-link"
                                href={`/${locale}/market/${position.securityId}`}
                              >
                                {position.ticker}
                              </a>
                              <small>{position.name}</small>
                            </td>
                            <td className="technical" dir="ltr">
                              {position.quantity}
                            </td>
                            <td className="technical" dir="ltr">
                              {money(position.averageCost, locale)}
                            </td>
                            <td className="technical" dir="ltr">
                              {money(position.price, locale)}
                              {position.priceStatus !== 'current' ? (
                                <small className="warning-text">
                                  {priceStatusLabel(position.priceStatus, locale)}
                                </small>
                              ) : null}
                            </td>
                            <td className="technical" dir="ltr">
                              {money(position.marketValue, locale)}
                            </td>
                            <td className="technical" dir="ltr">
                              {money(position.unrealizedGain, locale)}
                            </td>
                            <td className="technical" dir="ltr">
                              {position.weightPercent
                                ? `${Number(position.weightPercent).toFixed(1)}%`
                                : '—'}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="empty-state">{t.noHoldings}</p>
              )}
            </section>

            <section className="card performance-card">
              <p className="eyebrow">{t.performance}</p>
              <div className="period-tabs" aria-label={t.period}>
                {periods.map(([value, label]) => (
                  <a
                    key={value}
                    className={period === value ? 'active' : ''}
                    href={`/${locale}/dashboard?portfolio=${selected.id}&period=${value}`}
                  >
                    {label}
                  </a>
                ))}
              </div>
              <div className="performance-number">
                <span>{t.twr}</span>
                <strong className="technical" dir="ltr">
                  {percent(currentPerformance?.twr, locale)}
                </strong>
              </div>
              <div className="performance-number">
                <span>{t.xirr}</span>
                <strong className="technical" dir="ltr">
                  {percent(currentPerformance?.xirr, locale)}
                </strong>
              </div>
              <div className="mini-chart" aria-label={t.performance}>
                {(currentPerformance?.points ?? []).slice(-24).map((point, index, all) => {
                  const max = Math.max(...all.map((entry) => Number(entry.totalValue)), 1);
                  const height = Math.max(4, (Number(point.totalValue) / max) * 100);
                  return (
                    <span
                      key={point.date}
                      style={{ height: `${height}%` }}
                      title={`${point.date}: ${point.totalValue} MAD`}
                    />
                  );
                })}
              </div>
              <p className="microcopy">{t.benchmarkUnavailable}</p>
            </section>
          </div>

          <div className="dashboard-grid">
            <section className="card">
              <p className="eyebrow">{t.risk}</p>
              <h2>{t.sectorAllocation}</h2>
              <div className="risk-score-row">
                <div>
                  <span>{t.riskScore}</span>
                  <strong className="technical" dir="ltr">
                    {riskSummary.score === null ? '—' : `${riskSummary.score}/100`}
                  </strong>
                </div>
                <em>{riskBandLabel(riskSummary.band, locale)}</em>
              </div>
              <div className="performance-number">
                <span>{t.concentration}</span>
                <strong className="technical" dir="ltr">
                  {riskSummary.largestPositionPercent
                    ? `${riskSummary.largestPositionPercent.toFixed(1)}%`
                    : '—'}
                </strong>
              </div>
              <div className="performance-number">
                <span>{t.topFiveConcentration}</span>
                <strong className="technical" dir="ltr">
                  {riskSummary.topFivePercent ? `${riskSummary.topFivePercent.toFixed(1)}%` : '—'}
                </strong>
              </div>
              <div className="performance-number">
                <span>{t.cashShare}</span>
                <strong className="technical" dir="ltr">
                  {riskSummary.cashPercent === null
                    ? '—'
                    : `${riskSummary.cashPercent.toFixed(1)}%`}
                </strong>
              </div>
              <div className="performance-number">
                <span>{t.volatility}</span>
                <strong className="technical" dir="ltr">
                  {riskMetrics.volatility === null
                    ? '—'
                    : percent(String(riskMetrics.volatility), locale)}
                </strong>
              </div>
              <div className="performance-number">
                <span>{t.maxDrawdown}</span>
                <strong className="technical" dir="ltr">
                  {riskMetrics.maxDrawdown === null
                    ? '—'
                    : percent(String(riskMetrics.maxDrawdown), locale)}
                </strong>
              </div>
              {riskSummary.score === null ? <p className="microcopy">{t.riskUnavailable}</p> : null}
              <p className="microcopy">{t.riskMethodology}</p>
              <div className="allocation-list">
                {sectorWeights.map(([sector, weight]) => (
                  <div key={sector}>
                    <span>{sector}</span>
                    <strong dir="ltr">{weight.toFixed(1)}%</strong>
                    <i>
                      <b style={{ width: `${Math.min(100, weight)}%` }} />
                    </i>
                  </div>
                ))}
              </div>
            </section>
            <section className="card">
              <p className="eyebrow">{t.insights}</p>
              <h2>{t.aiInsight}</h2>
              <PortfolioAiInsight
                portfolioId={selected.id}
                locale={locale}
                defaultSummary={insight}
              />
              <p className="microcopy">{t.noFabricatedData}</p>
            </section>
            <section className="card">
              <p className="eyebrow">
                {selected.tracking_mode === 'virtual' ? t.virtual : t.realTracking}
              </p>
              <h2>{t.recordActivity}</h2>
              <p className="muted">{t.recordHint}</p>
              <TransactionForm
                locale={locale}
                portfolioId={selected.id}
                trackingMode={selected.tracking_mode === 'virtual' ? 'virtual' : 'real_tracking'}
                securities={(securities ?? []) as { id: string; ticker: string; name: string }[]}
              />
              <a className="text-link inline-link" href={`/${locale}/transactions/import`}>
                {t.import} →
              </a>
            </section>

            <section className="card span-2" id="transactions">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">{t.transactions}</p>
                  <h2>{t.recentTransactions}</h2>
                </div>
                <a className="text-link" href={`/${locale}/transactions?portfolio=${selected.id}`}>
                  {t.viewAll} →
                </a>
              </div>
              {transactions.length ? (
                <div className="table-scroll">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>{t.date}</th>
                        <th>{t.type}</th>
                        <th>{t.security}</th>
                        <th>{t.quantity}</th>
                        <th>{t.amount}</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {transactions.map((row) => (
                        <tr key={String(row.id)}>
                          <td>{String(row.settlement_date)}</td>
                          <td>
                            <span className="transaction-type">
                              {transactionLabel(
                                String(row.transaction_type),
                                locale,
                                selected.tracking_mode,
                              )}
                            </span>
                          </td>
                          <td>
                            {row.security_id
                              ? (securityLabels.get(String(row.security_id)) ?? '—')
                              : '—'}
                          </td>
                          <td className="technical" dir="ltr">
                            {row.quantity ? String(row.quantity) : '—'}
                          </td>
                          <td className="technical" dir="ltr">
                            {money(row.net_amount ? String(row.net_amount) : null, locale)}
                          </td>
                          <td>
                            {row.transaction_type !== 'reversal' ? (
                              <a
                                className="text-link"
                                href={`/${locale}/transactions/${String(row.id)}/reverse`}
                              >
                                {t.correction}
                              </a>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="empty-state">—</p>
              )}
            </section>
          </div>
        </>
      )}
      <footer className="app-footer">
        {t.notBroker} · {t.informationDisclaimer}
      </footer>
    </main>
  );
}
