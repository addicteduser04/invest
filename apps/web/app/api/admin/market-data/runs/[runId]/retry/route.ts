import {
  buildRetryPlan,
  parseRunId,
  resolveIngestionProvider,
  type StoredRun,
} from '@bvc/market-ingestion';
import { isErrorResponse, requireDataAdmin } from '@/lib/admin-auth';
import { dispatchIngestionWorkflow, readIngestionDispatchConfig } from '@/lib/ingestion-dispatch';
import { RATE_LIMIT_TIERS } from '@/lib/rate-limit';

export const runtime = 'nodejs';

const jsonError = (message: string, status: number) =>
  Response.json({ error: message }, { status });

export async function POST(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const auth = await requireDataAdmin({
    scope: 'admin.market-data.retry',
    ...RATE_LIMIT_TIERS.veryRestricted,
  });
  if (isErrorResponse(auth)) return auth;

  let runId: string;
  try {
    runId = parseRunId((await params).runId);
  } catch {
    return jsonError('Run not found', 404);
  }

  try {
    resolveIngestionProvider(process.env);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'PROVIDER_UNAVAILABLE', 503);
  }

  const dispatch = readIngestionDispatchConfig(process.env);
  if (!dispatch) return jsonError('EXECUTOR_NOT_CONFIGURED', 503);

  const { data, error } = await auth.supabase.rpc('get_market_ingestion_run', {
    p_run_id: runId,
  });
  if (error) return jsonError(error.message, 422);
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null | undefined;
  if (!row) return jsonError('Run not found', 404);
  const parentRun = toStoredRun(row);
  if (parentRun.status !== 'partial' && parentRun.status !== 'failed') {
    return jsonError('Run is not retryable', 409);
  }

  // Validated here so the admin gets an immediate answer; the runner rebuilds the same plan.
  try {
    buildRetryPlan(parentRun);
  } catch (planError) {
    return jsonError(planError instanceof Error ? planError.message : 'NO_FAILED_INSTRUMENTS', 409);
  }

  try {
    await dispatchIngestionWorkflow(dispatch, { retryRunId: parentRun.id });
  } catch (dispatchError) {
    console.error(
      '[market-data] retry dispatch failed:',
      dispatchError instanceof Error ? dispatchError.message : dispatchError,
    );
    return jsonError('DISPATCH_FAILED', 502);
  }

  return Response.json({ dispatched: true, parentRunId: parentRun.id }, { status: 202 });
}

function toStoredRun(row: Record<string, unknown>): StoredRun {
  return {
    id: String(row['id']),
    providerId: row['provider_id'] as StoredRun['providerId'],
    marketDate: String(row['market_date']),
    status: row['status'] as StoredRun['status'],
    triggerSource: row['trigger_source'] as StoredRun['triggerSource'],
    startedAt: String(row['started_at']),
    finishedAt: (row['finished_at'] as string | null) ?? null,
    metrics: row['metrics'] as StoredRun['metrics'],
    instrumentFailures: (row['instrument_failures'] as StoredRun['instrumentFailures']) ?? [],
    parentRunId: (row['parent_run_id'] as string | null) ?? null,
  };
}
