import { PROVIDER_IDS, type ProviderId } from './types';

export interface ProviderResolution {
  providerId: ProviderId;
  warnings: string[];
}

export type EnvLike = Record<string, string | undefined>;

export const APP_ENVS = ['local', 'staging', 'production', 'test'] as const;
export type AppEnv = (typeof APP_ENVS)[number];

/**
 * Classifies which application environment this process is running as, from the explicit
 * APP_ENV variable only -- never from NODE_ENV or Vercel's own deployment-type metadata, both
 * of which read 'production' for the saifinvest-staging Vercel project too (it is deployed as a
 * Production-type Vercel deployment), and so cannot distinguish staging from real production.
 *
 * Fails safe: a missing or unrecognized APP_ENV in a deployed build (NODE_ENV==='production',
 * true for every Vercel deployment including staging) is treated as 'production' -- the
 * strictest environment -- rather than silently permitting a testing-only code path. A missing
 * or unrecognized APP_ENV outside a deployed build (plain local `pnpm dev`/CLI usage, where
 * NODE_ENV is not 'production') falls back to 'local', preserving the existing development
 * workflow that has never needed to set APP_ENV at all.
 */
export function resolveAppEnv(env: EnvLike): AppEnv {
  const raw = env['APP_ENV'];
  if (raw && (APP_ENVS as readonly string[]).includes(raw)) return raw as AppEnv;
  return env['NODE_ENV'] === 'production' ? 'production' : 'local';
}

/**
 * Resolves which market-data provider a daily ingestion run should use, from explicit
 * environment configuration only. There is no fallback path: a licensed provider that
 * fails is a failed run, never a silent switch to bvc_public_testing. Real production
 * (APP_ENV==='production', including a missing/invalid APP_ENV inferred as production --
 * see resolveAppEnv) hard-fails on bvc_public_testing unconditionally, regardless of
 * BVC_PUBLIC_TESTING_ENABLED. APP_ENV==='staging' is the only other environment allowed to use
 * it, and still requires BVC_PUBLIC_TESTING_ENABLED=true explicitly -- the two are independent
 * gates, neither implies the other.
 */
export function resolveIngestionProvider(env: EnvLike): ProviderResolution {
  const raw = env['MARKET_INGESTION_PROVIDER'];
  if (!raw) {
    throw new Error(
      'MARKET_INGESTION_PROVIDER is required (one of: bvc_public_testing, licensed_api, licensed_sftp)',
    );
  }
  if (!PROVIDER_IDS.includes(raw as ProviderId)) {
    throw new Error(`Unknown MARKET_INGESTION_PROVIDER: ${raw}`);
  }
  const providerId = raw as ProviderId;
  const appEnv = resolveAppEnv(env);
  const warnings: string[] = [];

  if (providerId === 'bvc_public_testing') {
    if (appEnv === 'production') {
      throw new Error(
        'PRODUCTION_REFUSES_BVC_PUBLIC_TESTING: bvc_public_testing may never be configured in production. Configure a licensed provider (licensed_api or licensed_sftp).',
      );
    }
    if (env['BVC_PUBLIC_TESTING_ENABLED'] !== 'true') {
      throw new Error(
        'BVC_PUBLIC_TESTING_ENABLED=true is required to use the bvc_public_testing provider',
      );
    }
    if (!isLocalPostgresUrl(env['WORKER_DATABASE_URL'] ?? '')) {
      warnings.push(
        'bvc_public_testing is being used against a non-local database URL; this provider is intended for local/private testing only.',
      );
    }
  }

  return { providerId, warnings };
}

function isLocalPostgresUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol.startsWith('postgres') && ['localhost', '127.0.0.1'].includes(url.hostname);
  } catch {
    return false;
  }
}
