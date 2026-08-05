import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

const migration = await readFile(
  new URL('../migrations/202608020001_initial.sql', import.meta.url),
  'utf8',
);
const transactionMigration = await readFile(
  new URL('../migrations/202608050002_expand_transaction_command.sql', import.meta.url),
  'utf8',
);
describe('migration security invariants', () => {
  it('enables RLS on every browser-facing private table', () => {
    for (const table of ['profiles', 'user_roles', 'portfolios', 'transactions'])
      expect(migration).toContain(`alter table public.${table} enable row level security`);
  });
  it('does not use floating point for financial values', () =>
    expect(migration).not.toMatch(/\b(float|real|double precision)\b/i));
  it('keeps audit events append-only', () => expect(migration).toContain('audit_append_only'));
  it('requires distinct CSV proposer and reviewer', () =>
    expect(migration).toContain('reviewed_by<>proposed_by'));
  it('prevents authenticated clients from bypassing the accounting command', () =>
    expect(transactionMigration).toContain(
      'revoke insert on public.transactions from authenticated',
    ));
});
