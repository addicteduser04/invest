/**
 * Hands market-data ingestion off to the GitHub Actions workflow
 * (.github/workflows/market-ingestion.yml), which runs `pnpm market:daily` to completion on a
 * runner with a hard timeout.
 *
 * The admin routes must never run ingestion themselves: a serverless request is frozen or killed
 * once it has responded, which is exactly what left runs stuck in 'running' before. Dispatch is a
 * single awaited API call, so the route only reports success once GitHub has accepted the job.
 */

const WORKFLOW_FILE = 'market-ingestion.yml';

export interface IngestionDispatchConfig {
  token: string;
  repository: string;
  ref: string;
  /** GitHub environment whose secrets/vars the job runs with (e.g. 'staging'). */
  environment: string;
}

export interface IngestionDispatchInputs {
  date?: string;
  tickers?: string[];
  dryRun?: boolean;
  concurrency?: number;
  retryRunId?: string;
}

/** Returns null when this deployment has no executor configured; callers must then refuse. */
export function readIngestionDispatchConfig(
  env: Record<string, string | undefined>,
): IngestionDispatchConfig | null {
  const token = env['MARKET_INGESTION_DISPATCH_TOKEN']?.trim();
  const repository = env['MARKET_INGESTION_DISPATCH_REPOSITORY']?.trim();
  const environment = env['MARKET_INGESTION_DISPATCH_ENVIRONMENT']?.trim();
  if (!token || !repository || !environment) return null;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) return null;
  return {
    token,
    repository,
    ref: env['MARKET_INGESTION_DISPATCH_REF']?.trim() || 'main',
    environment,
  };
}

export async function dispatchIngestionWorkflow(
  config: IngestionDispatchConfig,
  inputs: IngestionDispatchInputs,
  fetchImpl: typeof fetch = fetch,
) {
  const response = await fetchImpl(
    `https://api.github.com/repos/${config.repository}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
    {
      method: 'POST',
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${config.token}`,
        'content-type': 'application/json',
        'x-github-api-version': '2022-11-28',
      },
      body: JSON.stringify({
        ref: config.ref,
        inputs: {
          environment: config.environment,
          date: inputs.date ?? '',
          tickers: inputs.tickers?.join(',') ?? '',
          dry_run: inputs.dryRun ? 'true' : 'false',
          concurrency: String(inputs.concurrency ?? 2),
          retry_run_id: inputs.retryRunId ?? '',
          trigger_source: 'manual',
        },
      }),
      signal: AbortSignal.timeout(10_000),
    },
  );
  // GitHub answers 204 No Content once the workflow run is queued.
  if (response.status !== 204) {
    throw new Error(`DISPATCH_FAILED: GitHub responded ${response.status}`);
  }
}
