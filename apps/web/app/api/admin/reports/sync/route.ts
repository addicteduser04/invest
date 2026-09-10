import { PgReportsStore, syncAnnualReports, type SyncScope } from '@bvc/annual-reports';
import { isErrorResponse, requireDataAdmin } from '@/lib/admin-auth';
import { withJobLock } from '@/lib/job-lock';
import { RATE_LIMIT_TIERS } from '@/lib/rate-limit';

export const runtime = 'nodejs';

const jsonError = (message: string, status: number) =>
  Response.json({ error: message }, { status });

export async function POST(request: Request) {
  const auth = await requireDataAdmin({
    scope: 'admin.reports.sync',
    ...RATE_LIMIT_TIERS.veryRestricted,
  });
  if (isErrorResponse(auth)) return auth;

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

  // syncAnnualReports only creates its market.document_sync_runs row near the end of a run (see
  // packages/annual-reports/src/sync.ts), so the one_running_reports_sync_uq index alone would
  // not stop a second trigger from starting a whole separate multi-minute AMMC crawl before
  // either reaches that point -- it would only stop both from persisting. The advisory lock here
  // rejects a duplicate trigger immediately, before any crawling starts; the unique index (kept
  // as-is, not touched by this hardening milestone) remains the durable backstop for any other
  // caller of syncAnnualReports.
  const lockResult = await withJobLock('annual-reports-sync', databaseUrl, async () => {
    const store = new PgReportsStore(databaseUrl);
    try {
      const summary = await syncAnnualReports(scope, store);
      return Response.json({ summary });
    } catch (error) {
      const code = (error as { code?: string } | null)?.code;
      if (code === '23505') return jsonError('ALREADY_RUNNING', 409);
      return jsonError(error instanceof Error ? error.message : 'SYNC_FAILED', 502);
    } finally {
      await store.close();
    }
  });
  if (!lockResult.ran) return jsonError('ALREADY_RUNNING', 409);
  return lockResult.result;
}
