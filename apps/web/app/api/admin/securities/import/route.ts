import { previewSecurityMasterCsv } from '@bvc/market-data';
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
  if (!(file instanceof File) || file.size === 0 || file.size > 1_000_000)
    return Response.json({ error: 'INVALID_FILE' }, { status: 400 });
  const preview = previewSecurityMasterCsv(await file.text());
  if (preview.errors.length)
    return Response.json({ ...preview, status: 'validation_failed' }, { status: 422 });
  if (String(form.get('confirm') ?? '') !== '1')
    return Response.json({ ...preview, status: 'preview' });

  const { data, error } = await supabase.rpc('upsert_market_security_master', {
    p_rows: preview.candidates,
  });
  if (error) return Response.json({ error: error.message }, { status: 422 });
  return Response.json({ ...preview, status: 'applied', result: data });
}
