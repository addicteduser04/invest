import { redirect } from 'next/navigation';
import type { Locale } from '@bvc/contracts';
import { createClient } from '@/lib/supabase/server';
import { asLocale, direction, getUi } from '@/lib/i18n';
import { readPortfolioValuation } from '@/lib/portfolio-read';
import { MarketTicker, type TickerItem } from '@/components/public/market-ticker';
import { PublicNav } from '@/components/public/public-nav';
import { PublicFooter } from '@/components/public/public-footer';

const money = (value: string | number | null | undefined, locale: Locale) =>
  value === null || value === undefined || !Number.isFinite(Number(value))
    ? '—'
    : new Intl.NumberFormat(locale === 'ar' ? 'ar-MA' : locale === 'fr' ? 'fr-MA' : 'en-MA', {
        style: 'currency',
        currency: 'MAD',
        maximumFractionDigits: 2,
      }).format(Number(value));

interface DividendRow {
  id: string;
  settlement_date: string;
  security_id: string | null;
  gross_amount: string | null;
  taxes: string;
  net_amount: string;
}

interface MarketSecurity {
  id: string;
  ticker: string;
  name: string;
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

export default async function DividendsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ portfolio?: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = asLocale(rawLocale);
  const filters = await searchParams;
  const t = getUi(locale);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/${locale}/login`);

  const [{ data: portfolios }, { data: tickerSecurities }, { data: tickerIndices }] =
    await Promise.all([
      supabase
        .from('portfolios')
        .select('id,name,status,tracking_mode')
        .order('created_at', { ascending: true }),
      supabase
        .from('market_security_overview')
        .select('id,ticker,name,latest_close_price,daily_change_percent')
        .eq('listing_status', 'active')
        .order('ticker'),
      supabase
        .from('market_index_overview')
        .select('id,code,name,latest_close_value,daily_change_percent')
        .in('code', ['MASI', 'MSI20', 'ESGI', 'MASIMS'])
        .order('code'),
    ]);
  const selected =
    portfolios?.find((portfolio) => portfolio.id === filters.portfolio) ?? portfolios?.[0];
  const tickerItems = buildTickerItems(
    locale,
    (tickerIndices ?? []) as MarketIndex[],
    (tickerSecurities ?? []) as MarketSecurity[],
  );
  const securityLabels = new Map(
    ((tickerSecurities ?? []) as MarketSecurity[]).map((security) => [
      security.id,
      { ticker: security.ticker, name: security.name },
    ]),
  );

  let dividends: DividendRow[] = [];
  let netDividendIncome: string | null = null;
  if (selected) {
    const [dividendsResult, valuation] = await Promise.all([
      supabase
        .from('transactions')
        .select('id,settlement_date,security_id,gross_amount,taxes,net_amount')
        .eq('portfolio_id', selected.id)
        .eq('transaction_type', 'dividend')
        .order('settlement_date', { ascending: false }),
      readPortfolioValuation(selected.id),
    ]);
    dividends = (dividendsResult.data ?? []) as DividendRow[];
    netDividendIncome = valuation.status === 'ok' ? valuation.valuation.netDividendIncome : null;
  }

  const bySecurity = buildBreakdown(dividends, securityLabels, t.unavailable);

  return (
    <main className="public-page transactions-v2-page" dir={direction(locale)}>
      <PublicNav locale={locale} authenticated />
      <MarketTicker locale={locale} items={tickerItems} />

      <section className="transactions-v2-hero compact">
        <div>
          <p className="public-eyebrow">{t.dividendsEyebrow}</p>
          <h1>{t.dividendsTitle}</h1>
          <p>{t.dividendsSubtitle}</p>
        </div>
        {selected ? (
          <div className="transactions-v2-hero-actions">
            <a href={`/${locale}/transactions/new?portfolio=${selected.id}&type=dividend`}>
              {t.recordTransaction}
            </a>
          </div>
        ) : null}
      </section>

      {selected ? (
        <>
          <form className="transactions-v2-filters" method="get">
            <label>
              <span className="sr-only">{t.portfolioTitle}</span>
              <select name="portfolio" defaultValue={selected.id}>
                {(portfolios ?? []).map((portfolio) => (
                  <option value={portfolio.id} key={portfolio.id}>
                    {portfolio.name}
                    {portfolio.status === 'archived' ? ` · ${t.archivedStatus}` : ''}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit">{t.search}</button>
          </form>

          <section className="portfolio-v2-metrics" aria-label={t.dividendsTitle}>
            <article>
              <span>{t.netDividends}</span>
              <strong className="technical positive" dir="ltr">
                {money(netDividendIncome, locale)}
              </strong>
            </article>
            <article>
              <span>{t.transactions}</span>
              <strong className="technical" dir="ltr">
                {dividends.length}
              </strong>
            </article>
            <article>
              <span>{t.dividendsBySecurity}</span>
              <strong className="technical" dir="ltr">
                {bySecurity.length}
              </strong>
            </article>
          </section>

          {dividends.length ? (
            <>
              {bySecurity.length ? (
                <section className="transactions-v2-history">
                  <div className="transactions-v2-table">
                    <div className="dividends-v2-table-head">
                      <span>{t.security}</span>
                      <span>{t.grossAmount}</span>
                      <span>{t.taxes}</span>
                      <span>{t.amount}</span>
                      <span>{t.transactions}</span>
                    </div>
                    {bySecurity.map((row) => (
                      <a
                        className="dividends-v2-row"
                        href={row.securityId ? `/${locale}/market/${row.securityId}` : '#'}
                        key={row.key}
                      >
                        <strong dir="ltr">{row.label}</strong>
                        <span className="technical" dir="ltr">
                          {money(row.gross, locale)}
                        </span>
                        <span className="technical" dir="ltr">
                          {money(row.taxes, locale)}
                        </span>
                        <span className="technical positive" dir="ltr">
                          {money(row.net, locale)}
                        </span>
                        <span className="technical" dir="ltr">
                          {row.count}
                        </span>
                      </a>
                    ))}
                  </div>
                </section>
              ) : null}

              <section className="transactions-v2-history">
                <div className="transactions-v2-table">
                  <div className="dividends-v2-table-head">
                    <span>{t.date}</span>
                    <span>{t.security}</span>
                    <span>{t.grossAmount}</span>
                    <span>{t.taxes}</span>
                    <span>{t.amount}</span>
                  </div>
                  {dividends.map((row) => {
                    const security = row.security_id ? securityLabels.get(row.security_id) : null;
                    return (
                      <a
                        className="dividends-v2-row"
                        href={row.security_id ? `/${locale}/market/${row.security_id}` : '#'}
                        key={row.id}
                      >
                        <span className="technical" dir="ltr">
                          {row.settlement_date}
                        </span>
                        <strong dir="ltr">{security?.ticker ?? t.unavailable}</strong>
                        <span className="technical" dir="ltr">
                          {money(row.gross_amount, locale)}
                        </span>
                        <span className="technical" dir="ltr">
                          {money(row.taxes, locale)}
                        </span>
                        <span className="technical positive" dir="ltr">
                          {money(row.net_amount, locale)}
                        </span>
                      </a>
                    );
                  })}
                </div>
              </section>
            </>
          ) : (
            <div className="transactions-v2-empty">
              <p>{t.dividendsEmptyTitle}</p>
              <p>{t.dividendsEmptySubtitle}</p>
              <a href={`/${locale}/transactions/new?portfolio=${selected.id}&type=dividend`}>
                {t.recordTransaction}
              </a>
            </div>
          )}
        </>
      ) : (
        <section className="transactions-v2-empty">
          <p>{t.createPortfolio}</p>
          <a href={`/${locale}/dashboard`}>{t.createPortfolio}</a>
        </section>
      )}
      <PublicFooter locale={locale} authenticated />
    </main>
  );
}

function buildBreakdown(
  rows: DividendRow[],
  securityLabels: Map<string, { ticker: string; name: string }>,
  unavailableLabel: string,
) {
  const map = new Map<
    string,
    {
      key: string;
      securityId: string | null;
      label: string;
      gross: number;
      taxes: number;
      net: number;
      count: number;
    }
  >();
  for (const row of rows) {
    const key = row.security_id ?? 'none';
    const label = row.security_id
      ? (securityLabels.get(row.security_id)?.ticker ?? unavailableLabel)
      : unavailableLabel;
    const current = map.get(key) ?? {
      key,
      securityId: row.security_id,
      label,
      gross: 0,
      taxes: 0,
      net: 0,
      count: 0,
    };
    current.gross += Number(row.gross_amount ?? 0);
    current.taxes += Number(row.taxes ?? 0);
    current.net += Number(row.net_amount ?? 0);
    current.count += 1;
    map.set(key, current);
  }
  return [...map.values()].sort((left, right) => right.net - left.net);
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
