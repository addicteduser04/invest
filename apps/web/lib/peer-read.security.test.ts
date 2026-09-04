import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./peer-read.ts', import.meta.url), 'utf8');

/**
 * Peer comparison must only ever touch the public `market_security_overview` view (plus the
 * already-audited valuation-read module for fundamentals) -- never an admin/audit table
 * directly. Structural regression guard, mirroring valuation-read.security.test.ts.
 */
describe('peer-read public-read boundary', () => {
  it('only queries the public market_security_overview view', () => {
    const fromCalls = [...source.matchAll(/\.from\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
    expect(new Set(fromCalls)).toEqual(new Set(['market_security_overview']));
  });

  it('never selects admin/audit-only columns', () => {
    expect(source).not.toMatch(/created_by|validation_report|import_run|source_hash/);
  });

  it('never queries a raw market schema table directly', () => {
    expect(source).not.toMatch(/market\.(securities|fundamentals|prices)/);
  });
});
