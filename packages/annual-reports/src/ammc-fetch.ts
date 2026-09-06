const AMMC_HOSTNAME = 'www.ammc.ma';
const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36';

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
  return fetch(parsed, { ...init, headers });
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
