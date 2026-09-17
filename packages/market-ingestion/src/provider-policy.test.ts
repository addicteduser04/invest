import { describe, expect, it } from 'vitest';
import { resolveAppEnv, resolveIngestionProvider } from './provider-policy';

describe('resolveAppEnv', () => {
  it('uses APP_ENV verbatim when it is one of the recognized values', () => {
    expect(resolveAppEnv({ APP_ENV: 'staging' })).toBe('staging');
    expect(resolveAppEnv({ APP_ENV: 'production' })).toBe('production');
    expect(resolveAppEnv({ APP_ENV: 'local' })).toBe('local');
    expect(resolveAppEnv({ APP_ENV: 'test' })).toBe('test');
  });

  it('falls back to production when APP_ENV is missing but the build is deployed (NODE_ENV=production) -- the fail-safe case, since Vercel sets NODE_ENV=production for staging too', () => {
    expect(resolveAppEnv({ NODE_ENV: 'production' })).toBe('production');
  });

  it('falls back to production when APP_ENV is an unrecognized value but the build is deployed', () => {
    expect(resolveAppEnv({ APP_ENV: 'prod', NODE_ENV: 'production' })).toBe('production');
    expect(resolveAppEnv({ APP_ENV: '', NODE_ENV: 'production' })).toBe('production');
  });

  it('falls back to local when APP_ENV is missing or invalid and the build is not deployed', () => {
    expect(resolveAppEnv({})).toBe('local');
    expect(resolveAppEnv({ APP_ENV: 'nonsense' })).toBe('local');
  });
});

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

  it('allows bvc_public_testing on APP_ENV=staging when the testing flag is enabled', () => {
    const resolution = resolveIngestionProvider({
      APP_ENV: 'staging',
      NODE_ENV: 'production', // Vercel sets this for the staging deployment too.
      MARKET_INGESTION_PROVIDER: 'bvc_public_testing',
      BVC_PUBLIC_TESTING_ENABLED: 'true',
    });
    expect(resolution.providerId).toBe('bvc_public_testing');
  });

  it('rejects bvc_public_testing on APP_ENV=staging when the testing flag is not enabled', () => {
    expect(() =>
      resolveIngestionProvider({
        APP_ENV: 'staging',
        NODE_ENV: 'production',
        MARKET_INGESTION_PROVIDER: 'bvc_public_testing',
      }),
    ).toThrow(/BVC_PUBLIC_TESTING_ENABLED=true is required/);
  });

  it('rejects bvc_public_testing on APP_ENV=production even with the testing flag enabled', () => {
    expect(() =>
      resolveIngestionProvider({
        APP_ENV: 'production',
        MARKET_INGESTION_PROVIDER: 'bvc_public_testing',
        BVC_PUBLIC_TESTING_ENABLED: 'true',
      }),
    ).toThrow(/PRODUCTION_REFUSES_BVC_PUBLIC_TESTING/);
  });

  it('rejects bvc_public_testing on APP_ENV=production with the testing flag disabled', () => {
    expect(() =>
      resolveIngestionProvider({
        APP_ENV: 'production',
        MARKET_INGESTION_PROVIDER: 'bvc_public_testing',
      }),
    ).toThrow(/PRODUCTION_REFUSES_BVC_PUBLIC_TESTING/);
  });

  it('allows a licensed provider on APP_ENV=production', () => {
    const resolution = resolveIngestionProvider({
      APP_ENV: 'production',
      MARKET_INGESTION_PROVIDER: 'licensed_sftp',
    });
    expect(resolution.providerId).toBe('licensed_sftp');
  });

  it('does not let a missing or invalid APP_ENV accidentally enable bvc_public_testing in a deployed build', () => {
    // NODE_ENV=production with no APP_ENV set at all (e.g. an env var that was never
    // configured on a real deployment) must infer 'production', not 'local' or 'staging'.
    expect(() =>
      resolveIngestionProvider({
        NODE_ENV: 'production',
        MARKET_INGESTION_PROVIDER: 'bvc_public_testing',
        BVC_PUBLIC_TESTING_ENABLED: 'true',
      }),
    ).toThrow(/PRODUCTION_REFUSES_BVC_PUBLIC_TESTING/);

    // An unrecognized APP_ENV value (typo, stale config) in a deployed build must not be
    // trusted either -- same fail-safe inference applies.
    expect(() =>
      resolveIngestionProvider({
        APP_ENV: 'prod',
        NODE_ENV: 'production',
        MARKET_INGESTION_PROVIDER: 'bvc_public_testing',
        BVC_PUBLIC_TESTING_ENABLED: 'true',
      }),
    ).toThrow(/PRODUCTION_REFUSES_BVC_PUBLIC_TESTING/);
  });
});
