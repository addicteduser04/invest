import { redirect } from 'next/navigation';
import type { Locale } from '@bvc/contracts';
import { createClient } from '@/lib/supabase/server';
import { asLocale, direction, getUi } from '@/lib/i18n';
import { MarketTicker, type TickerItem } from '@/components/public/market-ticker';
import { PublicNav } from '@/components/public/public-nav';
import { PublicFooter } from '@/components/public/public-footer';

const PAGE_SIZE = 50;

const money = (value: string | null | undefined, locale: Locale) =>
  value === null || value === undefined
    ? '—'
    : new Intl.NumberFormat(locale === 'ar' ? 'ar-MA' : locale === 'fr' ? 'fr-MA' : 'en-MA', {
        style: 'currency',
        currency: 'MAD',
        maximumFractionDigits: 2,
      }).format(Number(value));

const labelForType = (type: string, locale: Locale, trackingMode?: string) => {
  const t = getUi(locale);
  if (type === 'deposit') return t.deposit;
  if (type === 'withdrawal') return t.withdrawal;
  if (type === 'buy') return trackingMode === 'virtual' ? t.simulatedBuy : t.buy;
  if (type === 'sell') return trackingMode === 'virtual' ? t.simulatedSell : t.sell;
  if (type === 'dividend') return t.dividend;
  if (type === 'fee') return t.fee;
  if (type === 'tax') return t.tax;
  if (type === 'reversal') return t.reversal;
  return type;
};

export default async function TransactionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ portfolio?: string; type?: string; page?: string }>;
}) {
  const { locale: rawLocale } = await params;
  const filters = await searchParams;
  const locale = asLocale(rawLocale);
  const t = getUi(locale);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/${locale}/login`);

  const { data: portfolios } = await supabase
    .from('portfolios')
    .select('id,name,status,tracking_mode')
    .order('created_at', { ascending: true });
  const selected =
    portfolios?.find((portfolio) => portfolio.id === filters.portfolio) ?? portfolios?.[0];
  const allowedTypes = new Set([
    'deposit',
    'withdrawal',
    'buy',
    'sell',
    'dividend',
    'fee',
    'tax',
    'reversal',
  ]);
  const selectedType = allowedTypes.has(filters.type ?? '') ? filters.type! : '';
  const page = Math.max(1, Number.parseInt(filters.page ?? '1', 10) || 1);

  let transactions: Record<string, unknown>[] = [];
  let count = 0;
  let securityLabels = new Map<string, string>();
  const { data: tickerSecurities } = await supabase
    .from('market_security_overview')
    .select('id,ticker,name,latest_close_price,daily_change_percent')
    .eq('listing_status', 'active')
    .order('ticker');
  const { data: tickerIndices } = await supabase
    .from('market_index_overview')
    .select('id,code,name,latest_close_value,daily_change_percent')
    .in('code', ['MASI', 'MSI20', 'ESGI', 'MASIMS'])
    .order('code');
  const tickerItems = buildTickerItems(
    locale,
    (tickerIndices ?? []) as MarketIndex[],
    (tickerSecurities ?? []) as MarketSecurity[],
  );
  if (selected) {
    let query = supabase
      .from('transactions')
      .select(
        'id,transaction_type,settlement_date,trade_date,security_id,quantity,unit_price,gross_amount,fees,taxes,net_amount,reverses_transaction_id,note,created_at,ledger_sequence',
        { count: 'exact' },
      )
      .eq('portfolio_id', selected.id)
      .order('ledger_sequence', { ascending: false })
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
    if (selectedType) query = query.eq('transaction_type', selectedType);
    const result = await query;
    if (result.error) throw result.error;
    transactions = (result.data ?? []) as Record<string, unknown>[];
    count = result.count ?? 0;

    const securityIds = [
      ...new Set(transactions.flatMap((row) => (row.security_id ? [String(row.security_id)] : []))),
    ];
    if (securityIds.length) {
      const { data: securities } = await supabase
        .from('market_security_overview')
        .select('id,ticker')
        .in('id', securityIds);
      securityLabels = new Map(
        (securities ?? []).map((security) => [security.id, security.ticker]),
      );
    }
  }

  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const hrefForPage = (target: number) => {
    const parameters = new URLSearchParams();
    if (selected) parameters.set('portfolio', selected.id);
    if (selectedType) parameters.set('type', selectedType);
    parameters.set('page', String(target));
    return `/${locale}/transactions?${parameters.toString()}`;
  };

  return (
    <main className="public-page transactions-v2-page" dir={direction(locale)}>
      <PublicNav locale={locale} authenticated />
      <MarketTicker locale={locale} items={tickerItems} />
      <section className="transactions-v2-hero compact">
        <div>
          <p className="public-eyebrow">{t.transactions}</p>
          <h1>{t.transactionHistory}</h1>
          <p>{t.transactionHistoryHint}</p>
        </div>
        <div className="transactions-v2-hero-actions">
          {selected ? (
            <>
              <a href={`/${locale}/transactions/new?portfolio=${selected.id}`}>
                {t.recordTransaction}
              </a>
              <a href={`/api/portfolios/${selected.id}/transactions/export`}>{t.exportCsv}</a>
              <a href={`/${locale}/transactions/import`}>{t.import}</a>
            </>
          ) : null}
        </div>
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
            <label>
              <span className="sr-only">{t.type}</span>
              <select name="type" defaultValue={selectedType}>
                <option value="">{t.allTypes}</option>
                {['deposit', 'withdrawal', 'buy', 'sell', 'dividend', 'fee', 'tax', 'reversal'].map(
                  (type) => (
                    <option value={type} key={type}>
                      {labelForType(type, locale, selected.tracking_mode)}
                    </option>
                  ),
                )}
              </select>
            </label>
            <button type="submit">{t.search}</button>
          </form>

          <section className="transactions-v2-history">
            {transactions.length ? (
              <div className="transactions-v2-table">
                <div className="transactions-v2-table-head">
                  <span>{t.type}</span>
                  <span>{t.security}</span>
                  <span>{t.date}</span>
                  <span>{t.quantity}</span>
                  <span>{t.amount}</span>
                  <span>{t.fees}</span>
                  <span>{t.taxes}</span>
                  <span>{t.correction}</span>
                </div>
                {transactions.map((row) => (
                  <div className="transactions-v2-row" key={String(row.id)}>
                    <span>
                      <strong>
                        {labelForType(String(row.transaction_type), locale, selected.tracking_mode)}
                      </strong>
                      {row.reverses_transaction_id ? <small>{t.reversal}</small> : null}
                    </span>
                    <span className="technical transactions-v2-ticker" dir="ltr">
                      {row.security_id ? (securityLabels.get(String(row.security_id)) ?? '—') : '—'}
                    </span>
                    <span className="technical" dir="ltr">
                      {String(row.settlement_date)}
                    </span>
                    <span className="technical" dir="ltr">
                      {row.quantity ? String(row.quantity) : '—'}
                    </span>
                    <span
                      className={`technical ${Number(row.net_amount ?? 0) >= 0 ? 'positive' : 'negative'}`}
                      dir="ltr"
                    >
                      {money(row.net_amount ? String(row.net_amount) : null, locale)}
                    </span>
                    <span className="technical" dir="ltr">
                      {money(row.fees ? String(row.fees) : '0', locale)}
                    </span>
                    <span className="technical" dir="ltr">
                      {money(row.taxes ? String(row.taxes) : '0', locale)}
                    </span>
                    <span>
                      {row.transaction_type !== 'reversal' && selected.status === 'active' ? (
                        <a href={`/${locale}/transactions/${String(row.id)}/reverse`}>
                          {t.correction}
                        </a>
                      ) : (
                        '—'
                      )}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="transactions-v2-empty">
                <p>{t.noTransactions}</p>
                <a href={`/${locale}/transactions/new?portfolio=${selected.id}`}>
                  {t.recordDeposit}
                </a>
              </div>
            )}
          </section>

          {totalPages > 1 ? (
            <nav className="transactions-v2-pagination" aria-label={t.transactionHistory}>
              {page > 1 ? <a href={hrefForPage(page - 1)}>{t.previousPage}</a> : <span />}
              <span className="technical" dir="ltr">
                {page} / {totalPages}
              </span>
              {page < totalPages ? <a href={hrefForPage(page + 1)}>{t.nextPage}</a> : <span />}
            </nav>
          ) : null}
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
