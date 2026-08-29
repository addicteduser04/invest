import { redirect } from 'next/navigation';
import type { Locale } from '@bvc/contracts';
import { createClient } from '@/lib/supabase/server';
import { asLocale, direction, getUi } from '@/lib/i18n';
import { SiteNav } from '@/components/site-nav';

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
    <main className="app-shell" dir={direction(locale)}>
      <SiteNav locale={locale} authenticated />
      <div className="page-heading">
        <div>
          <p className="eyebrow">{t.transactions}</p>
          <h1>{t.transactionHistory}</h1>
          <p className="lead compact-lead">{t.transactionHistoryHint}</p>
        </div>
        {selected ? (
          <a
            className="button secondary compact"
            href={`/api/portfolios/${selected.id}/transactions/export`}
          >
            {t.exportCsv}
          </a>
        ) : null}
      </div>

      {selected ? (
        <>
          <form className="filter-bar transaction-filters" method="get">
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
            <button className="button compact" type="submit">
              {t.search}
            </button>
          </form>

          <section className="card transaction-history-card">
            {transactions.length ? (
              <div className="table-scroll">
                <table className="table">
                  <thead>
                    <tr>
                      <th>{t.date}</th>
                      <th>{t.type}</th>
                      <th>{t.security}</th>
                      <th>{t.quantity}</th>
                      <th>{t.unitPrice}</th>
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
                            {labelForType(
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
                          {row.unit_price ? money(String(row.unit_price), locale) : '—'}
                        </td>
                        <td className="technical" dir="ltr">
                          {money(row.net_amount ? String(row.net_amount) : null, locale)}
                        </td>
                        <td>
                          {row.transaction_type !== 'reversal' && selected.status === 'active' ? (
                            <a
                              className="text-link"
                              href={`/${locale}/transactions/${String(row.id)}/reverse`}
                            >
                              {t.correction}
                            </a>
                          ) : (
                            '—'
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="empty-state">{t.noTransactions}</p>
            )}
          </section>

          {totalPages > 1 ? (
            <nav className="pagination" aria-label={t.transactionHistory}>
              {page > 1 ? (
                <a className="button secondary compact" href={hrefForPage(page - 1)}>
                  {t.previousPage}
                </a>
              ) : (
                <span />
              )}
              <span className="technical" dir="ltr">
                {page} / {totalPages}
              </span>
              {page < totalPages ? (
                <a className="button secondary compact" href={hrefForPage(page + 1)}>
                  {t.nextPage}
                </a>
              ) : (
                <span />
              )}
            </nav>
          ) : null}
        </>
      ) : (
        <section className="card">
          <p className="empty-state">{t.createPortfolio}</p>
        </section>
      )}
    </main>
  );
}
