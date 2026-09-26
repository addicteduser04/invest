import {
  DEFAULT_CONCURRENCY,
  normalizeTicker,
  parseConcurrency,
  parseIsoDate,
  resolveIngestionProvider,
} from '@bvc/market-ingestion';
import { isErrorResponse, requireDataAdmin } from '@/lib/admin-auth';
import { dispatchIngestionWorkflow, readIngestionDispatchConfig } from '@/lib/ingestion-dispatch';
import { RATE_LIMIT_TIERS } from '@/lib/rate-limit';

export const runtime = 'nodejs';

const jsonError = (message: string, status: number) =>
  Response.json({ error: message }, { status });

export async function POST(request: Request) {
  const auth = await requireDataAdmin({
    scope: 'admin.market-data.run',
    ...RATE_LIMIT_TIERS.veryRestricted,
  });
  if (isErrorResponse(auth)) return auth;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid JSON body', 400);
  }
  if (!body || typeof body !== 'object') return jsonError('Invalid request body', 400);
  const input = body as Record<string, unknown>;

  let marketDate: string;
  try {
    marketDate = parseIsoDate(String(input.date ?? ''));
  } catch {
    return jsonError('Invalid or missing date', 400);
  }

  let tickers: string[] | undefined;
  if (Array.isArray(input.tickers) && input.tickers.length) {
    try {
      tickers = input.tickers.map((ticker) => normalizeTicker(String(ticker)));
    } catch {
      return jsonError('Invalid ticker in request', 400);
    }
  }

  let concurrency = DEFAULT_CONCURRENCY;
  if (input.concurrency !== undefined) {
    try {
      concurrency = parseConcurrency(String(input.concurrency));
    } catch {
      return jsonError('Invalid concurrency', 400);
    }
  }

  const dryRun = input.dryRun === true;

  // Never trust a client-supplied provider: the runner re-resolves it from its own environment.
  // This check only refuses to dispatch from a deployment whose provider policy is invalid (e.g.
  // bvc_public_testing in production).
  try {
    resolveIngestionProvider(process.env);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'PROVIDER_UNAVAILABLE', 503);
  }

  // The run executes on the GitHub Actions runner, never inside this request (a serverless
  // function is frozen once it responds, which is what used to strand runs as 'running').
  const dispatch = readIngestionDispatchConfig(process.env);
  if (!dispatch) return jsonError('EXECUTOR_NOT_CONFIGURED', 503);

  // Early, friendly rejection of an obvious duplicate. The authoritative guards remain the
  // one-running-run-per-date/provider unique index and the workflow's concurrency group.
  if (!dryRun) {
    const { data: recentRuns } = await auth.supabase.rpc('list_market_ingestion_runs', {
      p_limit: 20,
    });
    const alreadyRunning = ((recentRuns ?? []) as { status?: string; market_date?: string }[]).some(
      (run) => run.status === 'running' && run.market_date === marketDate,
    );
    if (alreadyRunning) return jsonError('ALREADY_RUNNING', 409);
  }

  try {
    await dispatchIngestionWorkflow(dispatch, {
      date: marketDate,
      ...(tickers ? { tickers } : {}),
      dryRun,
      concurrency,
    });
  } catch (error) {
    console.error(
      '[market-data] ingestion dispatch failed:',
      error instanceof Error ? error.message : error,
    );
    return jsonError('DISPATCH_FAILED', 502);
  }

  return Response.json({ dispatched: true, marketDate, dryRun }, { status: 202 });
}
