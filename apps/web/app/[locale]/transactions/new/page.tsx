import { redirect } from 'next/navigation';
import type { Locale } from '@bvc/contracts';
import { PublicNav } from '@/components/public/public-nav';
import { PublicFooter } from '@/components/public/public-footer';
import { MarketTicker, type TickerItem } from '@/components/public/market-ticker';
import { TransactionForm } from '@/components/transaction-form';
import { asLocale, direction, getUi } from '@/lib/i18n';
import { createClient } from '@/lib/supabase/server';
import { transactionTypes, type TransactionType } from '@/lib/transaction-types';

interface PortfolioOption {
  id: string;
  name: string;
  tracking_mode: string;
  status: string;
}

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

export default async function NewTransactionPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ portfolio?: string; type?: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = asLocale(rawLocale);
  const query = await searchParams;
  const defaultType = transactionTypes.includes(query.type as TransactionType)
    ? (query.type as TransactionType)
    : undefined;
  const t = getUi(locale);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/${locale}/login`);

  const [portfoliosResult, securitiesResult, indicesResult] = await Promise.all([
    supabase
      .from('portfolios')
      .select('id,name,tracking_mode,status')
      .eq('status', 'active')
      .order('created_at', { ascending: true }),
    supabase
      .from('market_security_overview')
      .select('id,ticker,name,sector,latest_close_price,daily_change_percent')
      .eq('listing_status', 'active')
      .order('ticker', { ascending: true }),
    supabase
      .from('market_index_overview')
      .select('id,code,name,latest_close_value,daily_change_percent')
      .in('code', ['MASI', 'MSI20', 'ESGI', 'MASIMS'])
      .order('code'),
  ]);

  const portfolios = (portfoliosResult.data ?? []) as PortfolioOption[];
  const selected =
    portfolios.find((portfolio) => portfolio.id === query.portfolio) ?? portfolios[0];
  const securities = (securitiesResult.data ?? []) as MarketSecurity[];
  const indices = (indicesResult.data ?? []) as MarketIndex[];
  const tickerItems = buildTickerItems(locale, indices, securities);

  return (
    <main className="public-page transactions-v2-page" dir={direction(locale)}>
      <PublicNav locale={locale} authenticated />
      <MarketTicker locale={locale} items={tickerItems} />

      <section className="transactions-v2-hero">
        <div>
          <p className="public-eyebrow">{t.recordActivity}</p>
          <h1>{t.recordTransactionTitle}</h1>
          <p>{t.recordTransactionSubtitle}</p>
        </div>
        <a href={`/${locale}/dashboard${selected ? `?portfolio=${selected.id}` : ''}`}>
          {t.backToPortfolio}
        </a>
      </section>

      {selected ? (
        <section className="transactions-v2-recorder">
          <form className="transactions-v2-portfolio-strip" method="get">
            <label>
              {t.portfolioTitle}
              <select defaultValue={selected.id} name="portfolio">
                {portfolios.map((portfolio) => (
                  <option key={portfolio.id} value={portfolio.id}>
                    {portfolio.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit">{t.viewPortfolio}</button>
            <span>{selected.tracking_mode === 'virtual' ? t.virtual : t.realTracking}</span>
          </form>
          <TransactionForm
            locale={locale}
            portfolioId={selected.id}
            trackingMode={selected.tracking_mode === 'virtual' ? 'virtual' : 'real_tracking'}
            securities={securities.map(({ id, ticker, name }) => ({ id, ticker, name }))}
            {...(defaultType ? { defaultType } : {})}
          />
        </section>
      ) : (
        <section className="transactions-v2-empty">
          <p className="public-eyebrow">{t.portfolioTitle}</p>
          <h2>{t.portfolioEmptyTitle}</h2>
          <p>{t.portfolioEmptySubtitle}</p>
          <a href={`/${locale}/dashboard`}>{t.createPortfolio}</a>
        </section>
      )}
      <PublicFooter locale={locale} authenticated />
    </main>
  );
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
