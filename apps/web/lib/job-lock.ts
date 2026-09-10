import { Client } from 'pg';

/**
 * Prevents an expensive whole-system job (full AMMC sync, market ingestion) from running twice
 * concurrently -- e.g. an admin double-clicking "Run now", or an overlapping manual + scheduled
 * trigger. Uses a session-scoped Postgres advisory lock on a single dedicated connection (not
 * the shared pool other routes use), so the lock is held for exactly the lifetime of this one
 * request and is automatically released even if the process crashes mid-job (Postgres drops
 * session-level advisory locks when the connection closes). `pg_try_advisory_lock` is
 * non-blocking: a second concurrent caller gets `false` immediately rather than queuing, which is
 * what "reject the duplicate trigger" (HTTP 409) requires.
 *
 * `lockKey` is hashed into a 32-bit int via Postgres' own `hashtext()` so callers pass a plain
 * readable string (e.g. 'annual-reports-sync') rather than picking numeric lock ids by hand.
 */
export async function withJobLock<T>(
  lockKey: string,
  databaseUrl: string,
  work: () => Promise<T>,
): Promise<{ ran: true; result: T } | { ran: false }> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const acquired = await client.query<{ pg_try_advisory_lock: boolean }>(
      'select pg_try_advisory_lock(hashtext($1))',
      [lockKey],
    );
    if (!acquired.rows[0]?.pg_try_advisory_lock) {
      return { ran: false };
    }
    try {
      const result = await work();
      return { ran: true, result };
    } finally {
      await client.query('select pg_advisory_unlock(hashtext($1))', [lockKey]);
    }
  } finally {
    await client.end();
  }
}
