import { X509Certificate } from 'node:crypto';
import { rootCertificates } from 'node:tls';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('undici', async (importOriginal) => {
  const actual = await importOriginal<typeof import('undici')>();
  return { ...actual, fetch: vi.fn() };
});

const undici = await import('undici');
const undiciFetch = vi.mocked(undici.fetch);
const { SECTIGO_DV_R36_INTERMEDIATE_PEM } = await import('./bvc-ca');
const { BVC_HOSTNAME, bvcFetch, bvcTrustedCas, getBvcDispatcher, toBvcTransportError } =
  await import('./bvc-transport');
const { BVC_SECURITY_MASTER_PAGE, fetchBvcSecurityMasterPreview } = await import('./index');

const okHtml = () =>
  new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } });

beforeEach(() => {
  undiciFetch.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe('Sectigo DV R36 intermediate', () => {
  const cert = new X509Certificate(SECTIGO_DV_R36_INTERMEDIATE_PEM);

  it('is the documented certificate', () => {
    expect(cert.subject).toContain('CN=Sectigo Public Server Authentication CA DV R36');
    expect(cert.issuer).toContain('CN=Sectigo Public Server Authentication Root R46');
    expect(cert.fingerprint256).toBe(
      '8C:54:C3:34:B6:6B:A4:E4:26:77:2A:F4:A3:F9:13:6C:19:A1:AE:C7:29:FD:B2:8C:53:5C:07:A5:A4:EF:22:E0',
    );
    expect(cert.ca).toBe(true);
  });

  it("is signed by a root already in Node's trust store", () => {
    const root = rootCertificates
      .map((pem) => new X509Certificate(pem))
      .find((candidate) => cert.checkIssued(candidate));
    expect(root).toBeDefined();
    expect(cert.verify(root!.publicKey)).toBe(true);
  });
});

describe('BVC-scoped transport', () => {
  it("trusts Node's normal roots plus only the R36 intermediate", () => {
    const cas = bvcTrustedCas();
    expect(cas).toHaveLength(rootCertificates.length + 1);
    expect(cas.slice(0, -1)).toEqual([...rootCertificates]);
    expect(cas.at(-1)).toBe(SECTIGO_DV_R36_INTERMEDIATE_PEM);
  });

  it('reuses one dispatcher that is never installed globally', () => {
    expect(getBvcDispatcher()).toBe(getBvcDispatcher());
    expect(getBvcDispatcher()).toBeInstanceOf(undici.Agent);
    expect(undici.getGlobalDispatcher()).not.toBe(getBvcDispatcher());
    expect(globalThis.fetch).not.toBe(bvcFetch);
  });

  it('sends BVC requests through the scoped dispatcher with the caller headers', async () => {
    undiciFetch.mockResolvedValue(okHtml() as never);
    await bvcFetch(BVC_SECURITY_MASTER_PAGE, { method: 'GET', headers: { referer: 'r' } });
    expect(undiciFetch).toHaveBeenCalledTimes(1);
    const [url, init] = undiciFetch.mock.calls[0]!;
    expect(String(url)).toBe(BVC_SECURITY_MASTER_PAGE);
    expect(init?.dispatcher).toBe(getBvcDispatcher());
    expect(init?.headers).toEqual({ referer: 'r' });
  });

  it('refuses non-BVC hosts and plain HTTP without touching the network', async () => {
    await expect(bvcFetch('https://example.com/')).rejects.toThrow('BVC_TRANSPORT_REFUSED');
    await expect(bvcFetch(`http://${BVC_HOSTNAME}/`)).rejects.toThrow('BVC_TRANSPORT_REFUSED');
    expect(undiciFetch).not.toHaveBeenCalled();
  });

  it('maps a TLS failure to a stable BVC_TLS_ERROR and keeps the nested cause', async () => {
    const tlsCause = Object.assign(new Error('unable to verify the first certificate'), {
      code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    });
    undiciFetch.mockRejectedValue(new TypeError('fetch failed', { cause: tlsCause }));
    const error = await bvcFetch(BVC_SECURITY_MASTER_PAGE).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('BVC_TLS_ERROR: UNABLE_TO_VERIFY_LEAF_SIGNATURE');
    expect(((error as Error).cause as Error).cause).toBe(tlsCause);
    expect(console.error).toHaveBeenCalledWith(
      '[bvc-transport] request failed',
      expect.objectContaining({ code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' }),
    );
  });

  it('maps other coded failures to BVC_NETWORK_ERROR and passes timeouts through', () => {
    const reset = new TypeError('fetch failed', {
      cause: Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }),
    });
    expect((toBvcTransportError(reset) as Error).message).toBe('BVC_NETWORK_ERROR: ECONNRESET');
    const timeout = new DOMException('timed out', 'TimeoutError');
    expect(toBvcTransportError(timeout)).toBe(timeout);
    const plain = new Error('no code');
    expect(toBvcTransportError(plain)).toBe(plain);
  });
});

describe('BVC connectors', () => {
  it('use the scoped transport by default (production path)', async () => {
    undiciFetch.mockResolvedValue(new Response('down', { status: 503 }) as never);
    await expect(fetchBvcSecurityMasterPreview()).rejects.toThrow('BVC_HTTP_503');
    expect(undiciFetch).toHaveBeenCalledTimes(1);
    expect(undiciFetch.mock.calls[0]![1]?.dispatcher).toBe(getBvcDispatcher());
  });

  it('still use an injected fetchImpl without reaching the real dispatcher', async () => {
    const injected = vi.fn(async () => new Response('down', { status: 502 }));
    await expect(fetchBvcSecurityMasterPreview(injected)).rejects.toThrow('BVC_HTTP_502');
    expect(injected).toHaveBeenCalledTimes(1);
    expect(undiciFetch).not.toHaveBeenCalled();
  });
});
