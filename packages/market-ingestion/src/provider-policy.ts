import { PROVIDER_IDS, type ProviderId } from './types';

export interface ProviderResolution {
  providerId: ProviderId;
  warnings: string[];
}

export type EnvLike = Record<string, string | undefined>;

/**
 * Resolves which market-data provider a daily ingestion run should use, from explicit
 * environment configuration only. There is no fallback path: a licensed provider that
 * fails is a failed run, never a silent switch to bvc_public_testing. Production hard-fails
 * on bvc_public_testing unconditionally.
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
  const isProduction = env['NODE_ENV'] === 'production';
  const warnings: string[] = [];

  if (providerId === 'bvc_public_testing') {
    if (isProduction) {
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
