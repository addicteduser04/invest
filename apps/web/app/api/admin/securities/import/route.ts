import { previewSecurityMasterCsv } from '@bvc/market-data';
import { isErrorResponse, requireDataAdmin } from '@/lib/admin-auth';
import { checkRateLimit, RATE_LIMIT_TIERS, rateLimitResponse } from '@/lib/rate-limit';

export async function POST(request: Request) {
  const auth = await requireDataAdmin();
  if (isErrorResponse(auth)) return auth;
  const { supabase, userId } = auth;

  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0 || file.size > 1_000_000)
    return Response.json({ error: 'INVALID_FILE' }, { status: 400 });
  const preview = previewSecurityMasterCsv(await file.text());
  if (preview.errors.length)
    return Response.json({ ...preview, status: 'validation_failed' }, { status: 422 });
  if (String(form.get('confirm') ?? '') !== '1')
    return Response.json({ ...preview, status: 'preview' });

  const rateLimit = await checkRateLimit({
    scope: 'admin.securities.import',
    identity: userId,
    ...RATE_LIMIT_TIERS.veryRestricted,
  });
  if (!rateLimit.allowed) return rateLimitResponse(rateLimit);

  const { data, error } = await supabase.rpc('upsert_market_security_master', {
    p_rows: preview.candidates,
  });
  if (error) return Response.json({ error: error.message }, { status: 422 });
  return Response.json({ ...preview, status: 'applied', result: data });
}
