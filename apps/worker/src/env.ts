import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export type Env = Record<string, string | undefined>;

// Resolve relative to this file (apps/worker/src/) rather than process.cwd(), since
// `pnpm --filter @bvc/worker <script>` runs with cwd set to apps/worker, which has no
// .env.local of its own — the repo root's does.
const REPO_ROOT_ENV_LOCAL = resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env.local');

export function loadDotEnvLocal(path = REPO_ROOT_ENV_LOCAL): Env {
  const env: Env = {};
  let text = '';
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return env;
  }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
    if (!match) continue;
    const [, key, raw = ''] = match;
    if (!key) continue;
    env[key] = raw.replace(/^['"]|['"]$/g, '');
  }
  return env;
}
