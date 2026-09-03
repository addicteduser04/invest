import { request as httpsRequest } from 'node:https';
import {
  BVC_PUBLIC_TESTING_PROVIDER_ID,
  fetchBvcHistoricalPreview,
  fetchBvcIndexHistoryPreview,
  fetchBvcIndexMasterPreview,
  fetchBvcLatestMarketPreview,
  fetchBvcSecurityMasterPreview,
  type BvcHistoricalCandidate,
  type BvcIndexCandidate,
  type BvcIndexObservationCandidate,
  type BvcSupportedIndexCode,
  type SecurityMasterCandidate,
} from '@bvc/market-data';
import type { ProviderId } from './types';

export interface FetchResult<T> {
  candidates: T[];
  errors: string[];
}

export interface ProviderAdapter {
  providerId: ProviderId;
  /** False for providers that have no real adapter implementation wired up yet. */
  configured: boolean;
  fetchSecurityMaster: () => Promise<FetchResult<SecurityMasterCandidate>>;
  fetchIndexMaster: () => Promise<FetchResult<BvcIndexCandidate>>;
  fetchIndexHistory: (input: {
    code: BvcSupportedIndexCode;
    startDate: string;
    endDate: string;
  }) => Promise<FetchResult<BvcIndexObservationCandidate>>;
  fetchDailyOhlcv: (input: {
    ticker: string;
    date: string;
  }) => Promise<FetchResult<BvcHistoricalCandidate>>;
}

export function createProviderAdapter(providerId: ProviderId): ProviderAdapter {
  if (providerId === BVC_PUBLIC_TESTING_PROVIDER_ID) return bvcPublicTestingAdapter;
  return notConfiguredAdapter(providerId);
}

const bvcPublicTestingAdapter: ProviderAdapter = {
  providerId: 'bvc_public_testing',
  configured: true,
  fetchSecurityMaster: () => fetchBvcSecurityMasterPreview(bvcPublicTestingFetch),
  fetchIndexMaster: async () => {
    try {
      const preview = await fetchBvcIndexMasterPreview(bvcPublicTestingFetch);
      if (!preview.errors.length) return preview;
    } catch {
      // Fall through to the live-market page, which currently exposes the same supported
      // MASI-family index definitions more reliably than the market-data index page
      // (mirrors scripts/data-bootstrap.ts's fallback behavior).
    }
    const latest = await fetchBvcLatestMarketPreview(bvcPublicTestingFetch);
    return { candidates: latest.indices, errors: latest.errors };
  },
  fetchIndexHistory: ({ code, startDate, endDate }) =>
    fetchBvcIndexHistoryPreview({ code, startDate, endDate }, bvcPublicTestingFetch),
  fetchDailyOhlcv: ({ ticker, date }) =>
    fetchBvcHistoricalPreview(
      { instrument: ticker, startDate: date, endDate: date },
      bvcPublicTestingFetch,
    ),
};

function notConfiguredAdapter(providerId: ProviderId): ProviderAdapter {
  const fail = (): never => {
    throw new Error(
      `PROVIDER_NOT_CONFIGURED: no adapter implementation exists yet for "${providerId}". A real licensed feed integration must be wired up (MARKET_DATA_API_URL/MARKET_DATA_API_KEY or an SFTP client) before this provider can be selected.`,
    );
  };
  return {
    providerId,
    configured: false,
    fetchSecurityMaster: async () => fail(),
    fetchIndexMaster: async () => fail(),
    fetchIndexHistory: async () => fail(),
    fetchDailyOhlcv: async () => fail(),
  };
}

/**
 * Hardened HTTPS fetch restricted to the public BVC website, adapted from
 * scripts/data-bootstrap.ts (kept local since that root script is not an importable
 * workspace package). Used as the fetchImpl for all @bvc/market-data calls above.
 */
async function bvcPublicTestingFetch(
  input: string | URL | Request,
  init: RequestInit = {},
): Promise<Response> {
  const url = new URL(
    typeof input === 'string' || input instanceof URL ? input.toString() : input.url,
  );
  if (url.hostname !== 'www.casablanca-bourse.com')
    throw new Error(`Refusing non-BVC ingestion fetch: ${url.hostname}`);
  if (url.protocol !== 'https:') throw new Error(`Refusing non-HTTPS ingestion fetch: ${url.href}`);

  const headers = new Headers(init.headers);
  if (!headers.has('user-agent'))
    headers.set(
      'user-agent',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36',
    );
  if (!headers.has('accept-language')) headers.set('accept-language', 'en-US,en;q=0.9,fr;q=0.8');
  if (!headers.has('x-requested-with')) headers.set('x-requested-with', 'XMLHttpRequest');
  return new Promise((resolveResponse, rejectResponse) => {
    const request = httpsRequest(
      url,
      {
        method: init.method ?? 'GET',
        headers: Object.fromEntries(headers.entries()),
        rejectUnauthorized: false,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => {
          resolveResponse(
            new Response(Buffer.concat(chunks), {
              status: response.statusCode ?? 0,
              statusText: response.statusMessage ?? '',
              headers: response.headers as HeadersInit,
            }),
          );
        });
      },
    );
    request.on('error', rejectResponse);
    if (init.signal) {
      if (init.signal.aborted) request.destroy(new Error('BVC_FETCH_ABORTED'));
      init.signal.addEventListener('abort', () => request.destroy(new Error('BVC_FETCH_ABORTED')), {
        once: true,
      });
    }
    request.end();
  });
}
