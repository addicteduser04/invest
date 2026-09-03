import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  buildRetryPlan,
  DEFAULT_CONCURRENCY,
  parseCliArgs,
  PgIngestionStore,
  resolveIngestionProvider,
  runDailyIngestion,
  todayInCasablanca,
  type RunSummary,
} from '@bvc/market-ingestion';

type Env = Record<string, string | undefined>;

// Resolve relative to this file (apps/worker/src/) rather than process.cwd(), since
// `pnpm --filter @bvc/worker market:daily` runs with cwd set to apps/worker, which has no
// .env.local of its own — the repo root's does.
const REPO_ROOT_ENV_LOCAL = resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env.local');

export function loadDotEnvLocal(path = REPO_ROOT_ENV_LOCAL): Env {
  const env: Env = {};
  let text = '';
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return env;
  }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
    if (!match) continue;
    const [, key, raw = ''] = match;
    if (!key) continue;
    env[key] = raw.replace(/^['"]|['"]$/g, '');
  }
  return env;
}

function printSummary(summary: RunSummary, log: (message: string) => void = console.log) {
  log('');
  log('Daily market ingestion summary');
  log(`  run id: ${summary.runId ?? '(dry run — not persisted)'}`);
  log(`  provider: ${summary.providerId}`);
  log(`  market date: ${summary.marketDate}`);
  log(`  status: ${summary.status}`);
  log(
    `  securities: ${summary.metrics.securitiesSucceeded}/${summary.metrics.securitiesExpected} succeeded, ${summary.metrics.securitiesFailed} failed`,
  );
  log(
    `  indices: ${summary.metrics.indicesSucceeded}/${summary.metrics.indicesExpected} succeeded, ${summary.metrics.indicesFailed} failed`,
  );
  log(
    `  rows: ${summary.metrics.rowsReceived} received, ${summary.metrics.rowsAccepted} accepted, ${summary.metrics.rowsRejected} rejected, ${summary.metrics.rowsPublished} published`,
  );
  log(`  retries: ${summary.metrics.retryCount}`);
  if (summary.instrumentFailures.length) {
    log(`  failed instruments (${summary.instrumentFailures.length}):`);
    for (const failure of summary.instrumentFailures) {
      log(
        `    ${failure.ticker} [${failure.stage}] ${failure.errorCode}: ${failure.message} (${failure.attempts} attempts)`,
      );
    }
  }
}

async function main() {
  const env = { ...loadDotEnvLocal(), ...process.env } as Env;
  const cliOptions = parseCliArgs(process.argv.slice(2));
  const { providerId, warnings } = resolveIngestionProvider(env);
  for (const warning of warnings) console.warn(`Warning: ${warning}`);

  const databaseUrl = env['WORKER_DATABASE_URL'];
  if (!databaseUrl) throw new Error('WORKER_DATABASE_URL is required');

  const marketDate = cliOptions.date ?? todayInCasablanca();
  const store = new PgIngestionStore(databaseUrl);
  try {
    let summary: RunSummary;
    if (cliOptions.retryFailed) {
      const parentRun = await store.findLatestIncompleteRun(cliOptions.date);
      if (!parentRun) {
        throw new Error(
          cliOptions.date
            ? `No partial/failed run found for ${cliOptions.date} to retry`
            : 'No partial/failed run found to retry',
        );
      }
      const plan = buildRetryPlan(parentRun, cliOptions.tickers);
      console.log(
        `Retrying run ${parentRun.id} (${parentRun.marketDate}): ${plan.tickers.length} ticker(s), ${plan.indexCodes.length} index code(s)`,
      );
      summary = await runDailyIngestion(
        {
          providerId,
          marketDate: parentRun.marketDate,
          tickers: plan.tickers,
          retryIndexCodes: plan.indexCodes,
          dryRun: cliOptions.dryRun,
          concurrency: cliOptions.concurrency,
          triggerSource: 'retry',
          parentRunId: parentRun.id,
        },
        store,
      );
    } else {
      summary = await runDailyIngestion(
        {
          providerId,
          marketDate,
          ...(cliOptions.tickers ? { tickers: cliOptions.tickers } : {}),
          dryRun: cliOptions.dryRun,
          concurrency: cliOptions.concurrency ?? DEFAULT_CONCURRENCY,
          triggerSource: 'cli',
        },
        store,
      );
    }
    printSummary(summary);
    if (summary.status === 'failed') process.exitCode = 1;
  } finally {
    await store.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
