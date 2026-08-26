import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { ReversalWorkflow } from './reversal-workflow';

export default async function ReverseTransactionPage({
  params,
}: {
  params: Promise<{ locale: string; transactionId: string }>;
}) {
  const { locale, transactionId } = await params;
  const language = locale === 'ar' ? 'ar' : 'fr';
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/${language}/login`);
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
  return (
    <main className="shell" dir={language === 'ar' ? 'rtl' : 'ltr'}>
      <section className="card">
        <ReversalWorkflow
          locale={language}
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
    </main>
  );
}
