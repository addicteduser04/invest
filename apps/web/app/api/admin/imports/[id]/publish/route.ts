import { isErrorResponse, requireDataAdmin } from '@/lib/admin-auth';
import { RATE_LIMIT_TIERS } from '@/lib/rate-limit';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireDataAdmin({
    scope: 'admin.imports.publish',
    ...RATE_LIMIT_TIERS.veryRestricted,
  });
  if (isErrorResponse(auth)) return auth;
  const { supabase } = auth;
  const body: unknown = await request.json().catch(() => null);
  const reason =
    body && typeof body === 'object' && 'reason' in body ? String(body.reason ?? '') : 'Approved';
  const { id } = await params;
  const { data, error } = await supabase.rpc('publish_market_price_import', {
    p_ingestion_run_id: id,
    p_review_reason: reason,
  });
  if (error) {
    const status = error.message === 'SECOND_ADMIN_REQUIRED' ? 409 : 422;
    return Response.json({ error: error.message }, { status });
  }
  return Response.json(data);
}
