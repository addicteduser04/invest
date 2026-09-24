import { rootCertificates } from 'node:tls';
import { Agent, fetch as undiciFetch, type RequestInit as UndiciRequestInit } from 'undici';
import { SECTIGO_DV_R36_INTERMEDIATE_PEM } from './bvc-ca';

export const BVC_HOSTNAME = 'www.casablanca-bourse.com';

/**
 * Trust anchors for BVC requests: Node's normal root store plus the Sectigo DV R36 intermediate
 * BVC omits from its handshake (see ./bvc-ca.ts). `ca` replaces the default store rather than
 * extending it, hence the explicit spread of `rootCertificates`.
 */
export function bvcTrustedCas(): string[] {
  return [...rootCertificates, SECTIGO_DV_R36_INTERMEDIATE_PEM];
}

let dispatcher: Agent | undefined;

/**
 * The one BVC-scoped undici dispatcher. Never installed globally (no setGlobalDispatcher), so
 * every other outbound request in the process keeps Node's default TLS behaviour. Certificate
 * verification stays fully enabled -- this only adds a trust anchor.
 */
export function getBvcDispatcher(): Agent {
  dispatcher ??= new Agent({ connect: { ca: bvcTrustedCas() } });
  return dispatcher;
}

const TLS_ERROR_CODE =
  /CERT|SELF_SIGNED|UNABLE_TO_(VERIFY|GET)|^ERR_TLS_|^ERR_SSL_|HOSTNAME_MISMATCH/;

function nestedErrorCode(error: unknown): { code: string; message: string } | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth += 1) {
    const { code, message, cause } = current as {
      code?: unknown;
      message?: unknown;
      cause?: unknown;
    };
    if (typeof code === 'string' && code) return { code, message: String(message ?? '') };
    current = cause;
  }
  return undefined;
}

/**
 * Turns undici's opaque `TypeError: fetch failed` into a stable, browser-safe message
 * (`BVC_TLS_ERROR: <code>` or `BVC_NETWORK_ERROR: <code>`) and logs the nested cause server-side.
 * Aborts/timeouts and errors without a code are rethrown unchanged.
 */
export function toBvcTransportError(error: unknown): unknown {
  if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError'))
    return error;
  const nested = nestedErrorCode(error);
  if (!nested) return error;
  const kind = TLS_ERROR_CODE.test(nested.code) ? 'BVC_TLS_ERROR' : 'BVC_NETWORK_ERROR';
  console.error('[bvc-transport] request failed', {
    kind,
    code: nested.code,
    cause: nested.message,
  });
  return new Error(`${kind}: ${nested.code}`, { cause: error });
}

/**
 * fetch for the public BVC website only: HTTPS to www.casablanca-bourse.com, sent through the
 * BVC-scoped dispatcher. It is the default `fetchImpl` of every @bvc/market-data BVC connector;
 * tests keep injecting their own fetchImpl and never reach this.
 */
export const bvcFetch = async (
  input: string | URL | Request,
  init: RequestInit = {},
): Promise<Response> => {
  const url = new URL(
    typeof input === 'string' || input instanceof URL ? input.toString() : input.url,
  );
  if (url.hostname !== BVC_HOSTNAME || url.protocol !== 'https:')
    throw new Error(`BVC_TRANSPORT_REFUSED: ${url.protocol}//${url.hostname}`);
  try {
    const response = await undiciFetch(url, {
      ...(init as UndiciRequestInit),
      headers: Object.fromEntries(new Headers(init.headers).entries()),
      dispatcher: getBvcDispatcher(),
    });
    return response as unknown as Response;
  } catch (error) {
    throw toBvcTransportError(error);
  }
};
