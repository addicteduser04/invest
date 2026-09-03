import {
  DEFAULT_CONCURRENCY,
  PgIngestionStore,
  buildRetryPlan,
  resolveIngestionProvider,
  runDailyIngestion,
  type ProviderId,
} from '@bvc/market-ingestion';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

const jsonError = (message: string, status: number) =>
  Response.json({ error: message }, { status });

export async function POST(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return jsonError('Unauthorized', 401);
  const { data: role } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id)
    .eq('role', 'data_admin')
    .maybeSingle();
  if (!role) return jsonError('Forbidden', 403);

  const { runId } = await params;

  let providerId: ProviderId;
  try {
    providerId = resolveIngestionProvider(process.env).providerId;
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'PROVIDER_UNAVAILABLE', 503);
  }

  const databaseUrl = process.env['WORKER_DATABASE_URL'];
  if (!databaseUrl) return jsonError('WORKER_DATABASE_URL is not configured', 503);

  const store = new PgIngestionStore(databaseUrl);
  const parentRun = await store.getRun(runId);
  if (!parentRun) {
    await store.close();
    return jsonError('Run not found', 404);
  }
  if (parentRun.status !== 'partial' && parentRun.status !== 'failed') {
    await store.close();
    return jsonError('Run is not retryable', 409);
  }

  let plan;
  try {
    plan = buildRetryPlan(parentRun);
  } catch (error) {
    await store.close();
    return jsonError(error instanceof Error ? error.message : 'NO_FAILED_INSTRUMENTS', 409);
  }

  // Same deferred-response pattern as the manual-trigger route: respond as soon as the
  // retry run row exists so the admin UI can poll it for live progress.
  return new Promise<Response>((resolve) => {
    let responded = false;
    const respondOnce = (response: Response) => {
      if (responded) return;
      responded = true;
      resolve(response);
    };

    runDailyIngestion(
      {
        providerId,
        marketDate: parentRun.marketDate,
        tickers: plan.tickers,
        retryIndexCodes: plan.indexCodes,
        dryRun: false,
        concurrency: DEFAULT_CONCURRENCY,
        triggerSource: 'retry',
        parentRunId: parentRun.id,
      },
      store,
      {
        onRunCreated: (retryRunId) =>
          respondOnce(Response.json({ runId: retryRunId, status: 'running' })),
      },
    )
      .then((summary) => respondOnce(Response.json({ summary })))
      .catch((error) =>
        respondOnce(jsonError(error instanceof Error ? error.message : 'RETRY_FAILED', 502)),
      )
      .finally(() => void store.close());
  });
}
