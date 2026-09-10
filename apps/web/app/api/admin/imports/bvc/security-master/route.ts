import { fetchBvcSecurityMasterPreview } from '@bvc/market-data';
import { isErrorResponse, requireDataAdmin } from '@/lib/admin-auth';
import { RATE_LIMIT_TIERS } from '@/lib/rate-limit';

export const runtime = 'nodejs';

const jsonError = (message: string, status: number) =>
  Response.json({ error: message }, { status });

export async function POST(request: Request) {
  if (process.env.BVC_PUBLIC_TESTING_ENABLED !== 'true')
    return jsonError('BVC public testing connector is disabled', 404);

  const auth = await requireDataAdmin({
    scope: 'admin.imports.bvc.security-master',
    ...RATE_LIMIT_TIERS.veryRestricted,
  });
  if (isErrorResponse(auth)) return auth;
  const { supabase } = auth;

  let action = 'preview';
  try {
    const body = (await request.json()) as { action?: unknown };
    if (body?.action) action = String(body.action);
  } catch {
    // The preview action intentionally accepts an empty body.
  }
  if (!['preview', 'apply'].includes(action)) return jsonError('Invalid action', 400);

  try {
    const preview = await fetchBvcSecurityMasterPreview();
    if (preview.errors.length)
      return Response.json(
        {
          ...preview,
          notice:
            'BVC security master was fetched read-only but failed normalization. Nothing was persisted.',
        },
        { status: 422 },
      );

    if (action === 'apply') {
      const { data, error } = await supabase.rpc('upsert_market_security_master', {
        p_rows: preview.candidates,
      });
      if (error) return jsonError(error.message, 422);
      return Response.json({
        ...preview,
        rowCount: preview.candidates.length,
        filename: 'bvc-public-test-security-master.csv',
        result: data,
        status: 'applied',
        notice:
          'BVC security master applied to this private testing environment. This does not grant commercial redistribution rights.',
      });
    }

    return Response.json({
      ...preview,
      rowCount: preview.candidates.length,
      filename: 'bvc-public-test-security-master.csv',
      status: 'preview',
      notice:
        'Read-only testing preview only. Review the normalized rows before applying them to the private testing environment.',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'BVC_FETCH_FAILED';
    const status = message.startsWith('BVC_HTTP_') ? 502 : 400;
    return jsonError(message, status);
  }
}
