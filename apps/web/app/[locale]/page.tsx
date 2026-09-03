import type { Locale } from '@bvc/contracts';
import { createClient } from '@/lib/supabase/server';
import { asLocale, direction, getUi } from '@/lib/i18n';
import { readPortfolioValuation } from '@/lib/portfolio-read';
import { MarketTicker, type TickerItem } from '@/components/public/market-ticker';
import { MasiHeroChart, type IndexPoint } from '@/components/public/masi-hero-chart';
import {
  EquityDiscovery,
  MarketSnapshot,
  PortfolioPreview,
  type IndexSnapshot,
  type PortfolioPreviewData,
  type SecuritySnapshot,
} from '@/components/public/home-market-sections';
import { PublicNav } from '@/components/public/public-nav';
import { PublicFooter } from '@/components/public/public-footer';

interface PricePoint {
  security_id: string;
  market_date: string;
  close_price: string;
}

interface PortfolioRow {
  id: string;
  name: string;
}

const priorityTickers = ['IAM', 'ATW', 'BCP'];

export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: rawLocale } = await params;
  const locale = asLocale(rawLocale);
  const t = getUi(locale);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [securitiesResult, indicesResult, masiHistoryResult, portfoliosResult] = await Promise.all([
    supabase
      .from('market_security_overview')
      .select(
        'id,ticker,name,sector,latest_market_date,latest_close_price,daily_change_percent,listing_status,is_synthetic',
      )
      .eq('listing_status', 'active')
      .order('ticker'),
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
    user
      ? supabase
          .from('portfolios')
          .select('id,name')
          .eq('status', 'active')
          .order('created_at')
          .limit(1)
      : Promise.resolve({ data: null }),
  ]);

  const securities = ((securitiesResult.data ?? []) as SecuritySnapshot[]).filter(
    (security) => !('is_synthetic' in security) || !security.is_synthetic,
  );
  const indices = (indicesResult.data ?? []) as IndexSnapshot[];
  const masiHistory = (masiHistoryResult.data ?? []) as IndexPoint[];
  const selectedSecurities = selectFeaturedSecurities(securities);
  const selectedIds = selectedSecurities.map((security) => security.id);
  const { data: historyRows } = selectedIds.length
    ? await supabase
        .from('market_price_history')
        .select('security_id,market_date,close_price')
        .in('security_id', selectedIds)
        .order('market_date', { ascending: true })
    : { data: [] };

  const sparklines = groupPriceHistory((historyRows ?? []) as PricePoint[]);
  const portfolioPreview = await readPortfolioPreview(
    Boolean(user),
    (portfoliosResult.data ?? []) as PortfolioRow[] | null,
  );
  const masi = indices.find((index) => index.code === 'MASI');
  const tickerItems = buildTickerItems(locale, indices, securities);
  const movers = buildMovers(securities);

  return (
    <main className="public-page" dir={direction(locale)}>
      <PublicNav locale={locale} authenticated={Boolean(user)} />
      <MarketTicker locale={locale} items={tickerItems} />

      <section className="public-hero">
        <div className="public-hero-copy">
          <p className="public-eyebrow">{t.publicHeroEyebrow}</p>
          <h1>{t.publicHeroTitle}</h1>
          <p>{t.publicHeroSubtitle}</p>
          <div className="public-hero-actions">
            <a className="public-cta dark" href={`/${locale}/market`}>
              {t.exploreMarket}
            </a>
            <a
              className="public-cta light"
              href={user ? `/${locale}/dashboard` : `/${locale}/register`}
            >
              {user ? t.viewPortfolio : t.createMyPortfolio}
            </a>
          </div>
          <div className="public-market-proof">
            <span>
              <strong>{securities.length}</strong>
              <small>{t.activeSecurities}</small>
            </span>
            <span>
              <strong>
                {masi?.latest_close_value
                  ? formatCompactNumber(masi.latest_close_value, locale)
                  : '—'}
              </strong>
              <small>MASI</small>
            </span>
            <span>
              <strong>{masiHistory.length}</strong>
              <small>{t.marketSessions}</small>
            </span>
          </div>
        </div>
        <MasiHeroChart
          locale={locale}
          history={masiHistory}
          latestDate={masi?.latest_market_date ?? null}
        />
      </section>

      <MarketSnapshot locale={locale} indices={indices} movers={movers} />
      <EquityDiscovery locale={locale} securities={selectedSecurities} sparklines={sparklines} />
      <PortfolioPreview locale={locale} data={portfolioPreview} />

      <PublicFooter locale={locale} authenticated={Boolean(user)} />
    </main>
  );
}

function selectFeaturedSecurities(securities: SecuritySnapshot[]) {
  const byTicker = new Map(securities.map((security) => [security.ticker, security]));
  const prioritized = priorityTickers.flatMap((ticker) => {
    const security = byTicker.get(ticker);
    return security ? [security] : [];
  });
  const priced = securities
    .filter(
      (security) =>
        !priorityTickers.includes(security.ticker) && security.latest_close_price !== null,
    )
    .sort((left, right) => {
      const leftChange =
        left.daily_change_percent === null ? -Infinity : Number(left.daily_change_percent);
      const rightChange =
        right.daily_change_percent === null ? -Infinity : Number(right.daily_change_percent);
      return rightChange - leftChange || left.ticker.localeCompare(right.ticker);
    });
  return [...prioritized, ...priced].slice(0, 8);
}

function groupPriceHistory(rows: PricePoint[]) {
  return rows.reduce((map, row) => {
    const current = map.get(row.security_id) ?? [];
    current.push({ market_date: row.market_date, close_price: row.close_price });
    map.set(row.security_id, current);
    return map;
  }, new Map<string, Array<{ market_date: string; close_price: string }>>());
}

async function readPortfolioPreview(
  authenticated: boolean,
  portfolios: PortfolioRow[] | null,
): Promise<PortfolioPreviewData> {
  if (!authenticated || !portfolios?.[0]) {
    return {
      authenticated,
      portfolioName: null,
      totalValue: null,
      securitiesValue: null,
      cashValue: null,
      totalGain: null,
      positionCount: 0,
    };
  }
  const valuation = await readPortfolioValuation(portfolios[0].id);
  if (valuation.status !== 'ok') {
    return {
      authenticated,
      portfolioName: portfolios[0].name,
      totalValue: null,
      securitiesValue: null,
      cashValue: null,
      totalGain: null,
      positionCount: 0,
    };
  }
  return {
    authenticated,
    portfolioName: portfolios[0].name,
    totalValue: valuation.valuation.totalValue,
    securitiesValue: valuation.valuation.securitiesValue,
    cashValue: valuation.valuation.cashValue,
    totalGain: valuation.valuation.totalGain,
    positionCount: valuation.valuation.positions.filter((position) => position.quantity !== '0')
      .length,
  };
}

function buildTickerItems(
  locale: Locale,
  indices: IndexSnapshot[],
  securities: SecuritySnapshot[],
) {
  const indexItems: TickerItem[] = indices.map((index) => ({
    id: index.id,
    ticker: index.code,
    name: index.name,
    href: `/${locale}/market`,
    price: index.latest_close_value,
    changePercent: index.daily_change_percent,
    kind: 'index',
  }));
  const securityItems = selectFeaturedSecurities(securities).map<TickerItem>((security) => ({
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

function buildMovers(securities: SecuritySnapshot[]) {
  const priced = securities.filter(
    (security) =>
      security.latest_close_price !== null &&
      security.daily_change_percent !== null &&
      Number.isFinite(Number(security.daily_change_percent)),
  );
  const gainers = priced
    .filter((security) => Number(security.daily_change_percent) >= 0)
    .sort((left, right) => Number(right.daily_change_percent) - Number(left.daily_change_percent))
    .slice(0, 4);
  const losers = priced
    .filter((security) => Number(security.daily_change_percent) < 0)
    .sort((left, right) => Number(left.daily_change_percent) - Number(right.daily_change_percent))
    .slice(0, 4);
  return { gainers, losers, active: [] };
}

function formatCompactNumber(value: string | number, locale: Locale) {
  return new Intl.NumberFormat(locale === 'ar' ? 'ar-MA' : locale === 'fr' ? 'fr-MA' : 'en-MA', {
    maximumFractionDigits: 0,
  }).format(Number(value));
}
