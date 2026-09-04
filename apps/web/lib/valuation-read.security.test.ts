import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./valuation-read.ts', import.meta.url), 'utf8');

/**
 * The valuation read model must only ever touch the public, security-barrier'd
 * `security_fundamentals` view (already proven anon/authenticated-readable, with
 * `market.fundamentals` itself proven unreachable, in supabase/tests/live-database.test.ts) --
 * never an admin/audit table directly. This is a structural regression guard: a future edit
 * that adds a second `.from(...)` call or selects an audit column should fail this test.
 */
describe('valuation-read public-read boundary', () => {
  it('only queries the public security_fundamentals view', () => {
    const fromCalls = [...source.matchAll(/\.from\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
    expect(fromCalls).toEqual(['security_fundamentals']);
  });

  it('never selects admin/audit-only columns', () => {
    expect(source).not.toMatch(/created_by|validation_report|import_run|source_hash|source_provider_id/);
  });

  it('never queries the raw market.fundamentals table', () => {
    expect(source).not.toMatch(/market\.fundamentals/);
  });
});
