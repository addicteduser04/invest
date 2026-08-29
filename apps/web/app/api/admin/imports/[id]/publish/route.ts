import { createClient } from '@/lib/supabase/server';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
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
