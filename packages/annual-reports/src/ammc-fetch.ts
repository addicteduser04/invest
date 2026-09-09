const AMMC_HOSTNAME = 'www.ammc.ma';
const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36';

// Mirrors @bvc/market-ingestion's withRetry/MAX_ATTEMPTS/RETRY_BASE_DELAY_MS convention
// (pipeline.ts) -- a bounded, exponential-backoff retry for genuine transient network failures
// (fetch() throwing -- connection reset/refused/timeout), never for a non-2xx HTTP response,
// which callers already handle explicitly (e.g. an empty listing page vs. a real HTTP error).
// This is resilience, not anti-bot evasion: no header spoofing, no faster requests, no retry on
// a server's actual response -- only on the request never completing at all.
const MAX_FETCH_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 500;

export type AmmcFetchImpl = (url: string, init?: RequestInit) => Promise<Response>;

/** Hardened fetch restricted to the public AMMC website, mirroring
 * @bvc/market-ingestion's bvcPublicTestingFetch hostname guard. Respectful defaults only --
 * no header spoofing beyond a normal browser user-agent, no anti-bot bypass. */
export const ammcHardenedFetch: AmmcFetchImpl = async (url, init = {}) => {
  const parsed = new URL(url);
  if (parsed.hostname !== AMMC_HOSTNAME)
    throw new Error(`Refusing non-AMMC fetch: ${parsed.hostname}`);
  if (parsed.protocol !== 'https:') throw new Error(`Refusing non-HTTPS fetch: ${parsed.href}`);
  const headers = new Headers(init.headers);
  if (!headers.has('user-agent')) headers.set('user-agent', USER_AGENT);
  if (!headers.has('accept-language')) headers.set('accept-language', 'fr-MA,fr;q=0.9,en;q=0.5');

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt += 1) {
    try {
      return await fetch(parsed, { ...init, headers });
    } catch (error) {
      lastError = error;
      if (attempt < MAX_FETCH_ATTEMPTS) await delay(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
};

/** A lightweight, byte-free existence/size check for a discovered attachment. Never
 * downloads the PDF body -- this milestone stores metadata and the official source URL only,
 * not the binary (see docs/COMPANY_DOCUMENTS.md). */
export async function probeAttachment(
  url: string,
  fetchImpl: AmmcFetchImpl = ammcHardenedFetch,
): Promise<{ available: boolean; fileSizeBytes: number | null }> {
  try {
    const response = await fetchImpl(url, { method: 'HEAD' });
    if (!response.ok) return { available: false, fileSizeBytes: null };
    const length = response.headers.get('content-length');
    return { available: true, fileSizeBytes: length ? Number(length) : null };
  } catch {
    return { available: false, fileSizeBytes: null };
  }
}

export async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
