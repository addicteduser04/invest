import { randomInt } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  emptyMetrics,
  PgIngestionStore,
  STALE_RUN_AFTER_MINUTES,
} from '../../packages/market-ingestion/src/index';

const enabled = process.env['LIVE_DATABASE_TESTS'] === '1';
const databaseUrl = process.env['TEST_DATABASE_URL'];
const live = enabled ? describe.sequential : describe.skip;

if (enabled && !/^postgresql:\/\/[^@]+@(?:127\.0\.0\.1|localhost):\d+\//.test(databaseUrl ?? '')) {
  throw new Error('Live database tests are restricted to a disposable local PostgreSQL instance');
}

// Far-future market dates, unique per suite run, so these rows never collide with real runs or
// with each other across reruns (ingestion runs are append-only and cannot be deleted).
const year = 2100 + randomInt(0, 800);
const marketDate = (day: number) => `${year}-01-${String(day).padStart(2, '0')}`;

live('market ingestion run lifecycle (PgIngestionStore)', () => {
  let store: PgIngestionStore;
  let db: Client;
  let actor: string;

  const createRun = (day: number) =>
    store.createRun({
      providerId: 'bvc_public_testing',
      marketDate: marketDate(day),
      triggerSource: 'cli',
      proposedBy: actor,
    });

  const backdate = (runId: string, minutes: number) =>
    db.query(
      `update market.ingestion_runs set started_at = now() - make_interval(mins => $2) where id = $1`,
      [runId, minutes],
    );

  const auditFor = async (runId: string) =>
    (
      await db.query<{ action: string; actor_type: string; before_state: Record<string, unknown> }>(
        `select action, actor_type, before_state from audit.events
         where entity_type = 'ingestion_run' and entity_id = $1`,
        [runId],
      )
    ).rows;

  beforeAll(async () => {
    store = new PgIngestionStore(databaseUrl!);
    db = new Client({ connectionString: databaseUrl });
    await db.connect();
    actor = await store.ensureSystemActor();
  });

  afterAll(async () => {
    await store.close();
    await db.end();
  });

  it('recovers only runs older than the stale threshold, preserving metrics and failures, with an audit event', async () => {
    const stale = await createRun(1);
    const recent = await createRun(2);
    const failure = {
      ticker: 'IAM',
      stage: 'ohlcv',
      dateOrRange: marketDate(1),
      errorCode: 'BVC_HTTP_500',
      message: 'boom',
      attempts: 3,
      lastAttemptAt: new Date().toISOString(),
    };
    await db.query(
      `update market.ingestion_runs
       set metrics = '{"securitiesSucceeded": 7}'::jsonb, instrument_failures = $2::jsonb
       where id = $1`,
      [stale, JSON.stringify([failure])],
    );
    await backdate(stale, STALE_RUN_AFTER_MINUTES + 5);
    await backdate(recent, STALE_RUN_AFTER_MINUTES - 5);

    const recovered = await store.recoverStaleRuns(STALE_RUN_AFTER_MINUTES);

    expect(recovered).toContain(stale);
    expect(recovered).not.toContain(recent);
    const staleRun = (await store.getRun(stale))!;
    expect(staleRun.status).toBe('failed');
    expect(staleRun.finishedAt).not.toBeNull();
    expect(staleRun.metrics).toMatchObject({
      securitiesSucceeded: 7, // existing value kept
      securitiesFailed: 0, // missing key defaulted
      errorSummary: { STALE_RUN_RECOVERED: 1 },
    });
    expect((staleRun.metrics as unknown as Record<string, unknown>)['failureReason']).toMatch(
      /did not finalize within 90 minutes/,
    );
    expect(staleRun.instrumentFailures).toEqual([failure]);
    expect(await auditFor(stale)).toEqual([
      expect.objectContaining({
        action: 'market_ingestion_run.marked_failed',
        actor_type: 'system',
        before_state: expect.objectContaining({ status: 'running' }),
      }),
    ]);
    expect((await store.getRun(recent))!.status).toBe('running');

    // Idempotent: a second pass finds nothing new for this run.
    expect(await store.recoverStaleRuns(STALE_RUN_AFTER_MINUTES)).not.toContain(stale);
    expect(await auditFor(stale)).toHaveLength(1);

    await store.abandonRun(recent, 'TEST_CLEANUP', 'live test cleanup');
  });

  it('finalizes a running run once and never overwrites a terminal state', async () => {
    const runId = await createRun(3);
    const input = {
      status: 'succeeded' as const,
      metrics: emptyMetrics(),
      instrumentFailures: [],
    };

    expect(await store.finalizeRun(runId, input)).toBe(true);
    expect(await store.finalizeRun(runId, { ...input, status: 'failed' })).toBe(false);
    expect((await store.getRun(runId))!.status).toBe('succeeded');
  });

  it('abandons an interrupted run as failed with its error code, only while it is running', async () => {
    const runId = await createRun(4);

    expect(await store.abandonRun(runId, 'INTERRUPTED', 'received SIGTERM')).toBe(true);
    expect(await store.abandonRun(runId, 'INTERRUPTED', 'received SIGTERM')).toBe(false);
    const run = (await store.getRun(runId))!;
    expect(run.status).toBe('failed');
    expect(run.metrics.errorSummary).toEqual({ INTERRUPTED: 1 });
    expect(await auditFor(runId)).toHaveLength(1);
  });

  it('rejects a second concurrent running run for the same date and provider', async () => {
    const first = await createRun(5);

    await expect(createRun(5)).rejects.toMatchObject({ code: '23505' });

    await store.abandonRun(first, 'TEST_CLEANUP', 'live test cleanup');
    // Once the first is terminal, the date/provider slot is free again.
    const second = await createRun(5);
    await store.abandonRun(second, 'TEST_CLEANUP', 'live test cleanup');
  });
});
