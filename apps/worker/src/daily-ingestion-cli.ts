import { pathToFileURL } from 'node:url';
import {
  buildRetryPlan,
  DEFAULT_CONCURRENCY,
  MAX_RUN_DURATION_MINUTES,
  parseCliArgs,
  PgIngestionStore,
  resolveIngestionProvider,
  runDailyIngestion,
  STALE_RUN_AFTER_MINUTES,
  todayInCasablanca,
  type PipelineDeps,
  type RunSummary,
  type StoredRun,
} from '@bvc/market-ingestion';
import { loadDotEnvLocal, type Env } from './env';

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

  if (cliOptions.recoverStale) {
    try {
      const recovered = await store.recoverStaleRuns(STALE_RUN_AFTER_MINUTES);
      console.log(
        recovered.length
          ? `Recovered ${recovered.length} stale run(s) as failed: ${recovered.join(', ')}`
          : 'No stale running runs found',
      );
    } finally {
      await store.close();
    }
    return;
  }

  // try/finally cannot run if this process is killed outright; stale-run recovery covers that.
  // These handlers cover the catchable cases (Ctrl-C, CI cancellation's SIGINT/SIGTERM, and our
  // own hard deadline) by marking the in-flight run failed before exiting.
  let activeRunId: string | null = null;
  let exiting = false;
  const abandonAndExit = async (errorCode: string, message: string, exitCode: number) => {
    if (exiting) return;
    exiting = true;
    // Never let a hung database connection keep an interrupted process alive.
    setTimeout(() => process.exit(exitCode), 10_000);
    console.error(`${errorCode}: ${message}`);
    if (activeRunId) {
      try {
        const marked = await store.abandonRun(activeRunId, errorCode, message);
        if (marked) console.error(`Run ${activeRunId} marked failed`);
      } catch (error) {
        console.error(
          `Could not mark run ${activeRunId} failed (${error instanceof Error ? error.message : error}); it will be recovered after ${STALE_RUN_AFTER_MINUTES} minutes`,
        );
      }
    }
    process.exit(exitCode);
  };
  // `on`, not `once`: wrappers (pnpm, tsx, the CI runner) often deliver the signal more than once,
  // and an unhandled repeat would kill the process mid-write before the run is marked failed.
  process.on('SIGINT', () => void abandonAndExit('INTERRUPTED', 'received SIGINT', 130));
  process.on('SIGTERM', () => void abandonAndExit('INTERRUPTED', 'received SIGTERM', 143));
  const watchdog = setTimeout(
    () =>
      void abandonAndExit(
        'RUN_TIMEOUT',
        `run exceeded the ${MAX_RUN_DURATION_MINUTES}-minute limit`,
        1,
      ),
    MAX_RUN_DURATION_MINUTES * 60_000,
  );
  watchdog.unref();

  const deps: PipelineDeps = {
    log: (message) => console.log(message),
    onRunCreated: (runId) => {
      activeRunId = runId;
      console.log(`Run created: ${runId}`);
    },
  };

  try {
    let summary: RunSummary;
    if (cliOptions.retryFailed || cliOptions.retryRunId) {
      let parentRun: StoredRun | null;
      if (cliOptions.retryRunId) {
        parentRun = await store.getRun(cliOptions.retryRunId);
        if (!parentRun) throw new Error(`Run ${cliOptions.retryRunId} not found`);
        if (parentRun.status !== 'partial' && parentRun.status !== 'failed')
          throw new Error(`Run ${parentRun.id} is ${parentRun.status}, not partial/failed`);
      } else {
        parentRun = await store.findLatestIncompleteRun(cliOptions.date);
      }
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
        deps,
      );
    } else {
      summary = await runDailyIngestion(
        {
          providerId,
          marketDate,
          ...(cliOptions.tickers ? { tickers: cliOptions.tickers } : {}),
          dryRun: cliOptions.dryRun,
          concurrency: cliOptions.concurrency ?? DEFAULT_CONCURRENCY,
          triggerSource: cliOptions.triggerSource,
        },
        store,
        deps,
      );
    }
    printSummary(summary);
    if (summary.status === 'failed') process.exitCode = 1;
  } catch (error) {
    // one_running_ingestion_run_per_date_provider_uq: another run for this date/provider is active.
    if ((error as { code?: string } | null)?.code === '23505') {
      throw new Error(
        `ALREADY_RUNNING: another ingestion run for this market date and provider (${providerId}) is in progress`,
      );
    }
    throw error;
  } finally {
    clearTimeout(watchdog);
    await store.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
