import { previewFundamentalsCsv, type ExistingFundamentalsPeriod } from '@bvc/market-data';
import { isErrorResponse, requireDataAdmin } from '@/lib/admin-auth';
import { checkRateLimit, RATE_LIMIT_TIERS, rateLimitResponse } from '@/lib/rate-limit';

export async function POST(request: Request) {
  const auth = await requireDataAdmin();
  if (isErrorResponse(auth)) return auth;
  const { supabase, userId } = auth;

  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0 || file.size > 5_000_000)
    return Response.json({ error: 'INVALID_FILE' }, { status: 400 });

  const [securitiesResult, issuersResult] = await Promise.all([
    supabase.from('market_security_overview').select('id,ticker,issuer_id'),
    supabase.from('issuer_directory').select('id,name,ammc_issuer_id'),
  ]);
  const knownSecurities = (
    (securitiesResult.data ?? []) as { id: string; ticker: string; issuer_id: string }[]
  ).map((s) => ({ id: s.id, ticker: s.ticker, issuerId: s.issuer_id }));
  const knownIssuers = (
    (issuersResult.data ?? []) as { id: string; name: string; ammc_issuer_id: string | null }[]
  ).map((i) => ({ id: i.id, name: i.name, ammcIssuerId: i.ammc_issuer_id }));

  const { data: periodsData } = await supabase.rpc('list_fundamentals_periods', {
    p_issuer_ids: knownIssuers.map((i) => i.id),
  });
  const existingPeriods = (periodsData ?? []) as ExistingFundamentalsPeriod[];

  const preview = previewFundamentalsCsv(
    await file.text(),
    knownSecurities,
    knownIssuers,
    existingPeriods,
  );
  if (preview.totals.invalid > 0)
    return Response.json({ ...preview, status: 'rejected' }, { status: 422 });
  if (String(form.get('confirm') ?? '') !== '1')
    return Response.json({ ...preview, status: 'preview' });

  const rateLimit = await checkRateLimit(supabase, {
    scope: 'admin.fundamentals.import',
    identity: userId,
    ...RATE_LIMIT_TIERS.veryRestricted,
  });
  if (!rateLimit.allowed) return rateLimitResponse(rateLimit);

  const rows = preview.rows
    .map((r) => r.candidate)
    .filter((c): c is NonNullable<typeof c> => Boolean(c))
    .map((c) => ({
      issuerId: c.issuerId,
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
      depreciationAmortization: c.depreciationAmortization ?? '',
      taxExpense: c.taxExpense ?? '',
      workingCapital: c.workingCapital ?? '',
      changeInWorkingCapital: c.changeInWorkingCapital ?? '',
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
