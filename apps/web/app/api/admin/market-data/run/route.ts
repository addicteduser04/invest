import {
  DEFAULT_CONCURRENCY,
  normalizeTicker,
  parseConcurrency,
  parseIsoDate,
  PgIngestionStore,
  resolveIngestionProvider,
  runDailyIngestion,
  type ProviderId,
} from '@bvc/market-ingestion';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

const jsonError = (message: string, status: number) =>
  Response.json({ error: message }, { status });

export async function POST(request: Request) {
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

  // Never trust a client-supplied provider: always re-resolve server-side, so the UI
  // cannot select bvc_public_testing in production even if it tried to.
  let providerId: ProviderId;
  try {
    providerId = resolveIngestionProvider(process.env).providerId;
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'PROVIDER_UNAVAILABLE', 503);
  }

  const databaseUrl = process.env['WORKER_DATABASE_URL'];
  if (!databaseUrl) return jsonError('WORKER_DATABASE_URL is not configured', 503);

  const store = new PgIngestionStore(databaseUrl);

  // Respond as soon as the durable run row exists (so the admin UI can start polling
  // /runs/[runId] for live progress) rather than blocking the whole HTTP request on a
  // potentially long-running ingestion. The pipeline keeps running in the background —
  // this assumes a persistent Node process (same model as apps/worker), not a hard
  // per-request serverless timeout. A dry run creates no row, so it resolves normally.
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
        marketDate,
        ...(tickers ? { tickers } : {}),
        dryRun,
        concurrency,
        triggerSource: 'manual',
      },
      store,
      {
        onRunCreated: (runId) => respondOnce(Response.json({ runId, status: 'running' })),
      },
    )
      .then((summary) => respondOnce(Response.json({ summary })))
      .catch((error) =>
        respondOnce(jsonError(error instanceof Error ? error.message : 'INGESTION_FAILED', 502)),
      )
      .finally(() => void store.close());
  });
}
