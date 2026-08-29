import { fetchBvcSecurityMasterPreview } from '@bvc/market-data';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

const jsonError = (message: string, status: number) =>
  Response.json({ error: message }, { status });

async function requireDataAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return 'Unauthorized' as const;
  const { data: role } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id)
    .eq('role', 'data_admin')
    .maybeSingle();
  return role ? 'ok' : ('Forbidden' as const);
}

export async function POST() {
  if (process.env.BVC_PUBLIC_TESTING_ENABLED !== 'true')
    return jsonError('BVC public testing connector is disabled', 404);

  const admin = await requireDataAdmin();
  if (admin === 'Unauthorized') return jsonError('Unauthorized', 401);
  if (admin === 'Forbidden') return jsonError('Forbidden', 403);

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
    return Response.json({
      ...preview,
      rowCount: preview.candidates.length,
      filename: 'bvc-public-test-security-master.csv',
      notice:
        'Read-only testing export only. Nothing was persisted or published. Review before using the admin security-master import command.',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'BVC_FETCH_FAILED';
    const status = message.startsWith('BVC_HTTP_') ? 502 : 400;
    return jsonError(message, status);
  }
}
