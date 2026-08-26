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
const serviceRoleMigration = await readFile(
  new URL('../migrations/202608050003_service_role_portfolio_reads.sql', import.meta.url),
  'utf8',
);
const importMigration = await readFile(
  new URL('../migrations/202608060001_transaction_csv_imports.sql', import.meta.url),
  'utf8',
);
const supersessionMigration = await readFile(
  new URL('../migrations/202608060003_atomic_import_supersession.sql', import.meta.url),
  'utf8',
);
const reversalMigration = await readFile(
  new URL('../migrations/202608260001_transaction_reversals.sql', import.meta.url),
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
  it('grants explicit service reads without opening private schemas', () => {
    expect(serviceRoleMigration).toContain('grant select on public.profiles');
    expect(serviceRoleMigration).not.toMatch(/grant .*private/i);
  });
  it('keeps transaction imports immutable and confirmation behind an atomic command', () => {
    expect(importMigration).toContain('private.transaction_import_blobs');
    expect(importMigration).toContain('jsonb_array_elements(v_rows)');
    expect(importMigration).toContain("v_import.status='confirmed'");
    expect(importMigration).toContain('for update');
    expect(importMigration).not.toMatch(
      /grant (insert|update|delete).*transaction_imports.*authenticated/i,
    );
  });
  it('links replacement imports atomically with ownership checks', () => {
    expect(supersessionMigration).toContain('for update');
    expect(supersessionMigration).toContain('v_old.owner_id<>v_user');
    expect(supersessionMigration).toContain('supersedes_import_id=p_supersedes_import_id');
    expect(supersessionMigration).toContain("set search_path='' ");
  });
  it('protects immutable reversal and replacement accounting at the database boundary', () => {
    expect(reversalMigration).toContain('private.transaction_reversal_requests');
    expect(reversalMigration).toContain("v_original.transaction_type='reversal'");
    expect(reversalMigration).toContain('for update');
    expect(reversalMigration).toContain("set search_path = ''");
    expect(reversalMigration).toContain('public.record_transaction(');
    expect(reversalMigration).toContain('earliest_accounting_date');
    expect(reversalMigration).not.toMatch(
      /grant (insert|update|delete).*transaction_reversal_requests.*authenticated/i,
    );
  });
});
