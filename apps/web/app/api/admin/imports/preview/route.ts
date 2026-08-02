import { AdminCsvProvider } from '@bvc/market-data';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: role } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id)
    .eq('role', 'data_admin')
    .maybeSingle();
  if (!role) return Response.json({ error: 'Forbidden' }, { status: 403 });
  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File) || file.size > 5_000_000)
    return Response.json({ error: 'A CSV file under 5 MB is required' }, { status: 400 });
  const text = await file.text();
  const preview = await new AdminCsvProvider().preview(text, {
    date: String(form.get('date') || 'time'),
    ticker: String(form.get('ticker') || 'symbol'),
    close: String(form.get('close') || 'close'),
    open: 'open',
    high: 'high',
    low: 'low',
    volume: 'volume',
  });
  return Response.json(
    {
      ...preview,
      originalFileName: file.name,
      publicationStatus: 'preview_only',
      notice:
        'A distinct data administrator must approve this immutable upload before publication.',
    },
    { status: preview.errors.length ? 422 : 200 },
  );
}
