import { describe, expect, it, vi } from 'vitest';

interface FakeClientState {
  queries: Array<{ text: string }>;
  connected: boolean;
  ended: boolean;
}
const clients: FakeClientState[] = [];

vi.mock('pg', () => {
  class FakeClient implements FakeClientState {
    queries: Array<{ text: string }> = [];
    connected = false;
    ended = false;
    constructor() {
      clients.push(this);
    }
    async connect() {
      this.connected = true;
    }
    async query(text: string, _values?: unknown[]) {
      this.queries.push({ text });
      if (text.includes('pg_try_advisory_lock')) {
        // First caller in a test run acquires; every subsequent one in the same test is denied.
        const alreadyLocked = clients.some(
          (c) => c !== this && c.queries.some((q) => q.text.includes('pg_try_advisory_lock')),
        );
        return { rows: [{ pg_try_advisory_lock: !alreadyLocked }] };
      }
      return { rows: [] };
    }
    async end() {
      this.ended = true;
    }
  }
  return { Client: FakeClient };
});

import { withJobLock } from './job-lock';

describe('withJobLock', () => {
  it('runs the work and releases the lock when acquired', async () => {
    clients.length = 0;
    const result = await withJobLock('test-lock', 'postgres://fake', async () => 'done');
    expect(result).toEqual({ ran: true, result: 'done' });
    const client = clients[0]!;
    expect(client.connected).toBe(true);
    expect(client.ended).toBe(true);
    expect(client.queries.some((q) => q.text.includes('pg_advisory_unlock'))).toBe(true);
  });

  it('does not run the work and reports ran:false when the lock is already held', async () => {
    clients.length = 0;
    // Acquire and hold the lock via a never-resolving first call, then attempt a second.
    let releaseFirst: () => void = () => {};
    const first = withJobLock(
      'test-lock',
      'postgres://fake',
      () => new Promise<string>((resolve) => (releaseFirst = () => resolve('first'))),
    );
    await new Promise((r) => setTimeout(r, 0)); // let the first lock acquisition complete
    const second = await withJobLock('test-lock', 'postgres://fake', async () => 'second');
    expect(second).toEqual({ ran: false });
    releaseFirst();
    await first;
  });

  it('still releases the lock and closes the connection when work throws', async () => {
    clients.length = 0;
    await expect(
      withJobLock('test-lock', 'postgres://fake', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const client = clients[0]!;
    expect(client.ended).toBe(true);
    expect(client.queries.some((q) => q.text.includes('pg_advisory_unlock'))).toBe(true);
  });
});
