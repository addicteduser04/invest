import { afterEach, describe, expect, it, vi } from 'vitest';
import { ammcHardenedFetch } from './ammc-fetch';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('ammcHardenedFetch', () => {
  it('refuses a non-AMMC hostname without ever calling fetch', async () => {
    const spy = vi.fn();
    globalThis.fetch = spy as unknown as typeof fetch;
    await expect(ammcHardenedFetch('https://example.com/x')).rejects.toThrow(/Refusing non-AMMC/);
    expect(spy).not.toHaveBeenCalled();
  });

  it('retries a transient network failure (fetch() throwing) and succeeds', async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls += 1;
      if (calls < 3) throw new TypeError('fetch failed');
      return new Response('ok', { status: 200 });
    }) as unknown as typeof fetch;

    const response = await ammcHardenedFetch('https://www.ammc.ma/fr/some-page');
    expect(response.status).toBe(200);
    expect(calls).toBe(3);
  });

  it('gives up after 3 attempts and surfaces the last error, not retrying forever', async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls += 1;
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;

    await expect(ammcHardenedFetch('https://www.ammc.ma/fr/some-page')).rejects.toThrow(
      /fetch failed/,
    );
    expect(calls).toBe(3);
  });

  it('never retries a normal non-2xx HTTP response -- only a request that never completed', async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls += 1;
      return new Response('not found', { status: 404 });
    }) as unknown as typeof fetch;

    const response = await ammcHardenedFetch('https://www.ammc.ma/fr/missing');
    expect(response.status).toBe(404);
    expect(calls).toBe(1);
  });
});
