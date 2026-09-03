import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { asLocale, direction, getUi } from '@/lib/i18n';
import { MarketTicker, type TickerItem } from '@/components/public/market-ticker';
import { PublicNav } from '@/components/public/public-nav';
import { PublicFooter } from '@/components/public/public-footer';
import { ReversalWorkflow } from './reversal-workflow';

export default async function ReverseTransactionPage({
  params,
}: {
  params: Promise<{ locale: string; transactionId: string }>;
}) {
  const { locale: rawLocale, transactionId } = await params;
  const locale = asLocale(rawLocale);
  const t = getUi(locale);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/${locale}/login`);
  const { data: transaction } = await supabase
    .from('transactions')
    .select(
      'id,portfolio_id,security_id,transaction_type,trade_date,settlement_date,quantity,unit_price,gross_amount,fees,taxes,net_amount',
    )
    .eq('id', transactionId)
    .maybeSingle();
  if (!transaction) notFound();
  const [{ data: portfolio }, { data: security }, { data: sourceImport }, { data: reversal }] =
    await Promise.all([
      supabase.from('portfolios').select('name').eq('id', transaction.portfolio_id).single(),
      transaction.security_id
        ? supabase
            .from('security_directory')
            .select('ticker,name')
            .eq('id', transaction.security_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      supabase
        .from('transaction_imports')
        .select('id')
        .contains('transaction_ids', [transaction.id])
        .maybeSingle(),
      supabase
        .from('transactions')
        .select('id')
        .eq('reverses_transaction_id', transaction.id)
        .maybeSingle(),
    ]);
  const [{ data: allSecurities }, { data: tickerIndices }] = await Promise.all([
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
  const securities = (allSecurities ?? []) as MarketSecurity[];
  const tickerItems = buildTickerItems(
    locale,
    (tickerIndices ?? []) as MarketIndex[],
    securities.slice(0, 10),
  );
  return (
    <main className="public-page transactions-v2-page" dir={direction(locale)}>
      <PublicNav locale={locale} authenticated />
      <MarketTicker locale={locale} items={tickerItems} />
      <section className="transactions-v2-hero compact">
        <div>
          <p className="public-eyebrow">{t.correction}</p>
          <h1>{t.transactionHistory}</h1>
          <p>{t.transactionHistoryHint}</p>
        </div>
      </section>
      <section className="transactions-v2-reversal">
        <ReversalWorkflow
          locale={locale}
          securities={securities.map(({ id, ticker, name }) => ({ id, ticker, name }))}
          transaction={{
            id: transaction.id,
            portfolioId: transaction.portfolio_id,
            portfolioName: portfolio?.name ?? '—',
            type: transaction.transaction_type,
            tradeDate: transaction.trade_date,
            settlementDate: transaction.settlement_date,
            ...(transaction.security_id ? { securityId: transaction.security_id } : {}),
            ...(security ? { securityLabel: `${security.ticker} — ${security.name}` } : {}),
            ...(transaction.quantity ? { quantity: String(transaction.quantity) } : {}),
            ...(transaction.unit_price ? { unitPrice: String(transaction.unit_price) } : {}),
            ...(transaction.gross_amount ? { grossAmount: String(transaction.gross_amount) } : {}),
            fees: String(transaction.fees),
            taxes: String(transaction.taxes),
            netAmount: String(transaction.net_amount),
            currency: 'MAD',
            ...(sourceImport ? { importId: sourceImport.id } : {}),
            ...(reversal ? { reversedById: reversal.id } : {}),
          }}
        />
      </section>
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

function buildTickerItems(locale: string, indices: MarketIndex[], securities: MarketSecurity[]) {
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
