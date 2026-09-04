import { previewFundamentalsCsv, type ExistingFundamentalsPeriod } from '@bvc/market-data';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  const { data: role } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id)
    .eq('role', 'data_admin')
    .maybeSingle();
  if (!role) return Response.json({ error: 'FORBIDDEN' }, { status: 403 });

  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0 || file.size > 5_000_000)
    return Response.json({ error: 'INVALID_FILE' }, { status: 400 });

  const { data: securitiesData } = await supabase
    .from('market_security_overview')
    .select('id,ticker');
  const knownSecurities = (securitiesData ?? []) as { id: string; ticker: string }[];

  const { data: periodsData } = await supabase.rpc('list_fundamentals_periods', {
    p_security_ids: knownSecurities.map((s) => s.id),
  });
  const existingPeriods = (periodsData ?? []) as ExistingFundamentalsPeriod[];

  const preview = previewFundamentalsCsv(await file.text(), knownSecurities, existingPeriods);
  if (preview.totals.invalid > 0)
    return Response.json({ ...preview, status: 'rejected' }, { status: 422 });
  if (String(form.get('confirm') ?? '') !== '1')
    return Response.json({ ...preview, status: 'preview' });

  const rows = preview.rows
    .map((r) => r.candidate)
    .filter((c): c is NonNullable<typeof c> => Boolean(c))
    .map((c) => ({
      securityId: c.securityId,
      periodType: c.periodType,
      interimPeriod: c.interimPeriod,
      fiscalYear: c.fiscalYear,
      periodEndDate: c.periodEndDate,
      publicationDate: c.publicationDate,
      currency: c.currency,
      revenue: c.revenue ?? '',
      ebitda: c.ebitda ?? '',
      ebit: c.ebit ?? '',
      netIncome: c.netIncome ?? '',
      eps: c.eps ?? '',
      cash: c.cash ?? '',
      totalDebt: c.totalDebt ?? '',
      totalAssets: c.totalAssets ?? '',
      totalEquity: c.totalEquity ?? '',
      operatingCashFlow: c.operatingCashFlow ?? '',
      capex: c.capex ?? '',
      sharesOutstanding: c.sharesOutstanding ?? '',
      dividendPerShare: c.dividendPerShare ?? '',
    }));

  const { data, error } = await supabase.rpc('apply_fundamentals_import', {
    p_source_hash: preview.sourceHash,
    p_original_filename: file.name,
    p_rows: rows,
    p_validation_report: { totals: preview.totals },
  });
  if (error) return Response.json({ error: error.message }, { status: 422 });
  return Response.json({ ...preview, status: 'imported', result: data });
}
