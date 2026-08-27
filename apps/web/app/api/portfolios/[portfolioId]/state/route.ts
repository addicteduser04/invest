import { calculateLedger, type Transaction } from '@bvc/portfolio-engine';
import { localizeError, portfolioStateSchema } from '@bvc/contracts';
import { createClient } from '@/lib/supabase/server';

interface ReplayRow {
  id: string;
  transaction_type: Transaction['type'];
  settlement_date: string;
  security_id: string | null;
  quantity: string | null;
  unit_price: string | null;
  gross_amount: string | null;
  fees: string;
  taxes: string;
  reverses_transaction_id: string | null;
  created_at: string;
  effective_at: string;
  ledger_sequence: string;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ portfolioId: string }> },
) {
  const url = new URL(request.url);
  const locale = url.searchParams.get('locale') === 'ar' ? 'ar' : 'fr';
  const requestedAsOf = url.searchParams.get('as_of');
  const asOf = requestedAsOf ? new Date(requestedAsOf) : new Date();
  if (Number.isNaN(asOf.valueOf())) {
    return Response.json(
      { code: 'INVALID_DATE', message: localizeError({ code: 'INVALID_DATE' }, locale) },
      { status: 422 },
    );
  }
  const { portfolioId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json(
      { code: 'UNAUTHENTICATED', message: localizeError({ code: 'UNAUTHENTICATED' }, locale) },
      { status: 401 },
    );
  }
  const { data: portfolio } = await supabase
    .from('portfolios')
    .select('id')
    .eq('id', portfolioId)
    .maybeSingle();
  if (!portfolio) {
    return Response.json(
      {
        code: 'FORBIDDEN_PORTFOLIO',
        message: localizeError({ code: 'FORBIDDEN_PORTFOLIO' }, locale),
      },
      { status: 403 },
    );
  }
  const { data, error } = await supabase
    .from('portfolio_replay_transactions')
    .select(
      'id,transaction_type,settlement_date,security_id,quantity,unit_price,gross_amount,fees,taxes,reverses_transaction_id,created_at,effective_at,ledger_sequence',
    )
    .eq('portfolio_id', portfolioId);
  if (error) {
    return Response.json(
      { code: 'INTERNAL_FAILURE', message: localizeError({ code: 'INTERNAL_FAILURE' }, locale) },
      { status: 500 },
    );
  }
  const rows = (data ?? []) as ReplayRow[];
  const transactions: Transaction[] = rows.map((row) => ({
    id: row.id,
    type: row.transaction_type,
    settlementDate: row.settlement_date,
    ...(row.security_id ? { securityId: row.security_id } : {}),
    ...(row.quantity ? { quantity: row.quantity } : {}),
    ...(row.unit_price ? { unitPrice: row.unit_price } : {}),
    ...(row.gross_amount ? { amount: row.gross_amount } : {}),
    fees: row.fees,
    taxes: row.taxes,
    ...(row.reverses_transaction_id ? { reversesTransactionId: row.reverses_transaction_id } : {}),
    recordedAt: row.created_at,
    effectiveAt: row.effective_at,
    ledgerSequence: row.ledger_sequence,
  }));
  let ledger;
  try {
    ledger = calculateLedger(transactions, { asOf: asOf.toISOString() });
  } catch {
    return Response.json(
      { code: 'INTERNAL_FAILURE', message: localizeError({ code: 'INTERNAL_FAILURE' }, locale) },
      { status: 500 },
    );
  }
  const response = portfolioStateSchema.parse({
    portfolioId,
    asOf: asOf.toISOString(),
    ...ledger,
    source: 'replay',
    ruleVersion: 'average-cost-v1',
  });
  return Response.json(response, { headers: { 'Cache-Control': 'private, no-store' } });
}
