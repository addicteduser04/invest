import { PgReportsStore, syncAnnualReports, type SyncScope } from '@bvc/annual-reports';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

const jsonError = (message: string, status: number) =>
  Response.json({ error: message }, { status });

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return jsonError('UNAUTHENTICATED', 401);
  const { data: role } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id)
    .eq('role', 'data_admin')
    .maybeSingle();
  if (!role) return jsonError('FORBIDDEN', 403);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const input = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;

  const scope: SyncScope = { dryRun: input.dryRun === true };
  if (typeof input.ticker === 'string' && input.ticker.trim()) {
    scope.ticker = input.ticker.trim().toUpperCase();
  }
  if (input.year !== undefined && input.year !== null && input.year !== '') {
    const year = Number(input.year);
    if (!Number.isInteger(year) || year < 1990 || year > 2100) {
      return jsonError('INVALID_YEAR', 400);
    }
    scope.year = year;
  }
  if (scope.ticker && scope.year)
    return jsonError('INVALID_SCOPE: ticker and year cannot be combined', 400);

  const databaseUrl = process.env['WORKER_DATABASE_URL'];
  if (!databaseUrl) return jsonError('WORKER_DATABASE_URL is not configured', 503);

  const store = new PgReportsStore(databaseUrl);
  try {
    const summary = await syncAnnualReports(scope, store);
    return Response.json({ summary });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'SYNC_FAILED', 502);
  } finally {
    await store.close();
  }
}
