import { pathToFileURL } from 'node:url';
import {
  PgReportsStore,
  syncAnnualReports,
  type SyncScope,
  type SyncSummary,
} from '@bvc/annual-reports';
import { loadDotEnvLocal, type Env } from './env';

export function parseReportsCliArgs(argv: string[]): SyncScope {
  const scope: SyncScope = { dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined || arg === '--') continue;
    if (arg === '--dry-run') {
      scope.dryRun = true;
    } else if (arg === '--all') {
      scope.all = true;
    } else if (arg === '--year') {
      const value = argv[i + 1];
      if (!value || !/^\d{4}$/.test(value))
        throw new Error('INVALID_YEAR: --year requires a 4-digit value');
      scope.year = Number(value);
      i += 1;
    } else if (arg === '--ticker') {
      const value = argv[i + 1];
      if (!value) throw new Error('INVALID_TICKER: --ticker requires a value');
      scope.ticker = value.toUpperCase();
      i += 1;
    } else if (arg.startsWith('--')) {
      throw new Error(`UNKNOWN_ARGUMENT: ${arg}`);
    }
  }
  if (scope.ticker && scope.year) {
    throw new Error('INVALID_SCOPE: --ticker and --year cannot be combined in one run');
  }
  return scope;
}

function printSummary(summary: SyncSummary, log: (message: string) => void = console.log) {
  log('');
  log('Annual reports sync summary');
  log(`  run id: ${summary.runId ?? '(dry run - not persisted)'}`);
  log(`  status: ${summary.status}`);
  log(
    `  issuers discovered: ${summary.issuersDiscovered} (existing: ${summary.issuersExisting}, created: ${summary.issuersCreated}, ambiguous: ${summary.issuersAmbiguous})`,
  );
  log(
    `  issuers linked to a listed security: ${summary.issuersLinkedToSecurity}, unlisted: ${summary.issuersUnlisted}`,
  );
  log(
    `  issuers with reports: ${summary.issuersWithReports}, without reports: ${summary.issuersWithoutReports}`,
  );
  log(
    `  documents discovered: ${summary.documentsDiscovered} (inserted: ${summary.documentsInserted}, updated: ${summary.documentsUpdated}, unchanged: ${summary.documentsUnchanged})`,
  );
  if (summary.failures.length) {
    log(`  failures (${summary.failures.length}):`);
    for (const failure of summary.failures) {
      log(
        `    [${failure.stage}] ${failure.message}${failure.context ? ` (${failure.context})` : ''}`,
      );
    }
  }
}

async function main() {
  const env = { ...loadDotEnvLocal(), ...process.env } as Env;
  const scope = parseReportsCliArgs(process.argv.slice(2));

  const databaseUrl = env['WORKER_DATABASE_URL'];
  if (!databaseUrl) throw new Error('WORKER_DATABASE_URL is required');

  const store = new PgReportsStore(databaseUrl);
  try {
    const summary = await syncAnnualReports(scope, store, { log: console.log });
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
