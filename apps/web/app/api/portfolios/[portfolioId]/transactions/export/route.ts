import { createClient } from '@/lib/supabase/server';

const csvCell = (value: unknown) => {
  const text = value === null || value === undefined ? '' : String(value);
  return `"${text.replaceAll('"', '""')}"`;
};

// Prevent spreadsheet formula execution in user-controlled text while leaving numeric financial cells numeric.
const csvText = (value: unknown) => {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+@]/.test(text) || (/^-/.test(text) && !/^-\d+(?:\.\d+)?$/.test(text))) text = `'${text}`;
  return csvCell(text);
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ portfolioId: string }> },
) {
  const { portfolioId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'UNAUTHENTICATED' }, { status: 401 });

  const { data: portfolio } = await supabase
    .from('portfolios')
    .select('id,name')
    .eq('id', portfolioId)
    .maybeSingle();
  if (!portfolio) return Response.json({ error: 'FORBIDDEN_PORTFOLIO' }, { status: 403 });

  const { data: rows, error } = await supabase
    .from('transactions')
    .select(
      'id,ledger_sequence,transaction_type,trade_date,settlement_date,security_id,quantity,unit_price,gross_amount,fees,taxes,net_amount,reverses_transaction_id,note,created_at',
    )
    .eq('portfolio_id', portfolioId)
    .order('ledger_sequence', { ascending: true });
  if (error) return Response.json({ error: 'INTERNAL_FAILURE' }, { status: 500 });

  const securityIds = [
    ...new Set((rows ?? []).flatMap((row) => (row.security_id ? [row.security_id] : []))),
  ];
  let securities: { id: string; ticker: string; name: string }[] = [];
  if (securityIds.length) {
    const result = await supabase
      .from('market_security_overview')
      .select('id,ticker,name')
      .in('id', securityIds);
    if (result.error) return Response.json({ error: 'INTERNAL_FAILURE' }, { status: 500 });
    securities = (result.data ?? []) as { id: string; ticker: string; name: string }[];
  }
  const labels = new Map(securities.map((security) => [security.id, security]));
  const headers = [
    'id',
    'ledger_sequence',
    'transaction_type',
    'trade_date',
    'settlement_date',
    'security_id',
    'ticker',
    'security_name',
    'quantity',
    'unit_price',
    'gross_amount',
    'fees',
    'taxes',
    'net_amount',
    'reverses_transaction_id',
    'note',
    'created_at',
  ];
  const lines = [headers.map(csvCell).join(',')];
  for (const row of rows ?? []) {
    const security = row.security_id ? labels.get(row.security_id) : undefined;
    lines.push(
      [
        csvText(row.id),
        csvCell(row.ledger_sequence),
        csvText(row.transaction_type),
        csvText(row.trade_date),
        csvText(row.settlement_date),
        csvText(row.security_id),
        csvText(security?.ticker),
        csvText(security?.name),
        csvCell(row.quantity),
        csvCell(row.unit_price),
        csvCell(row.gross_amount),
        csvCell(row.fees),
        csvCell(row.taxes),
        csvCell(row.net_amount),
        csvText(row.reverses_transaction_id),
        csvText(row.note),
        csvText(row.created_at),
      ].join(','),
    );
  }
  const safeName =
    String(portfolio.name)
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'portfolio';
  return new Response(`\uFEFF${lines.join('\n')}\n`, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="saifinvest-${safeName}-transactions.csv"`,
      'cache-control': 'private, no-store',
    },
  });
}
