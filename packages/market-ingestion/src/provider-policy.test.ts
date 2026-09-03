import { describe, expect, it } from 'vitest';
import { resolveIngestionProvider } from './provider-policy';

describe('resolveIngestionProvider', () => {
  it('requires MARKET_INGESTION_PROVIDER to be set', () => {
    expect(() => resolveIngestionProvider({})).toThrow(/MARKET_INGESTION_PROVIDER is required/);
  });

  it('rejects an unknown provider id', () => {
    expect(() => resolveIngestionProvider({ MARKET_INGESTION_PROVIDER: 'yahoo_finance' })).toThrow(
      /Unknown MARKET_INGESTION_PROVIDER/,
    );
  });

  it('hard-fails bvc_public_testing in production with no exceptions', () => {
    expect(() =>
      resolveIngestionProvider({
        MARKET_INGESTION_PROVIDER: 'bvc_public_testing',
        NODE_ENV: 'production',
        BVC_PUBLIC_TESTING_ENABLED: 'true',
      }),
    ).toThrow(/PRODUCTION_REFUSES_BVC_PUBLIC_TESTING/);
  });

  it('requires BVC_PUBLIC_TESTING_ENABLED for bvc_public_testing outside production', () => {
    expect(() =>
      resolveIngestionProvider({ MARKET_INGESTION_PROVIDER: 'bvc_public_testing' }),
    ).toThrow(/BVC_PUBLIC_TESTING_ENABLED=true is required/);
  });

  it('resolves bvc_public_testing locally when explicitly enabled', () => {
    const resolution = resolveIngestionProvider({
      MARKET_INGESTION_PROVIDER: 'bvc_public_testing',
      BVC_PUBLIC_TESTING_ENABLED: 'true',
      WORKER_DATABASE_URL: 'postgres://localhost:54322/postgres',
    });
    expect(resolution.providerId).toBe('bvc_public_testing');
    expect(resolution.warnings).toEqual([]);
  });

  it('warns (but does not fail) when bvc_public_testing targets a non-local database outside production', () => {
    const resolution = resolveIngestionProvider({
      MARKET_INGESTION_PROVIDER: 'bvc_public_testing',
      BVC_PUBLIC_TESTING_ENABLED: 'true',
      WORKER_DATABASE_URL: 'postgres://staging.example.com:5432/postgres',
    });
    expect(resolution.warnings.length).toBeGreaterThan(0);
  });

  it('allows licensed providers in production without requiring the testing flag', () => {
    const resolution = resolveIngestionProvider({
      MARKET_INGESTION_PROVIDER: 'licensed_api',
      NODE_ENV: 'production',
    });
    expect(resolution.providerId).toBe('licensed_api');
  });

  it('never falls back to bvc_public_testing when a licensed provider is configured', () => {
    // There is no fallback code path at all: resolving 'licensed_api' always returns
    // 'licensed_api', regardless of BVC_PUBLIC_TESTING_ENABLED.
    const resolution = resolveIngestionProvider({
      MARKET_INGESTION_PROVIDER: 'licensed_api',
      BVC_PUBLIC_TESTING_ENABLED: 'true',
    });
    expect(resolution.providerId).toBe('licensed_api');
  });
});
