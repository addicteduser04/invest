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
const portfolioStateMigration = await readFile(
  new URL('../migrations/202608270001_portfolio_state_snapshots.sql', import.meta.url),
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
  it('keeps portfolio snapshots derived, normalized, private and atomically generated', () => {
    expect(portfolioStateMigration).toContain('analytics.portfolio_state_positions');
    expect(portfolioStateMigration).toContain('boundary_sequence');
    expect(portfolioStateMigration).toContain('for update of o,p skip locked');
    expect(portfolioStateMigration).toContain("set search_path=''");
    expect(portfolioStateMigration).toContain('enable row level security');
    expect(portfolioStateMigration).not.toMatch(
      /grant (insert|update|delete).*portfolio_state_(snapshots|positions).*authenticated/i,
    );
    expect(portfolioStateMigration).not.toMatch(/\b(float|real|double precision)\b/i);
  });
});

const mvpMigration = await readFile(
  new URL('../migrations/202608280001_mvp_locales_market_and_transactions.sql', import.meta.url),
  'utf8',
);
describe('MVP completion migration', () => {
  it('adds English and explicit non-broker portfolio modes without weakening RLS', () => {
    expect(mvpMigration).toContain("check(locale in ('en','fr','ar'))");
    expect(mvpMigration).toContain("tracking_mode in ('real_tracking','virtual')");
    expect(mvpMigration).not.toMatch(/disable row level security/i);
  });
  it('exposes only normalized market read models and keeps reversal-aware holdings checks', () => {
    expect(mvpMigration).toContain('public.market_security_overview');
    expect(mvpMigration).toContain('public.market_price_history');
    expect(mvpMigration).toContain('not exists(');
    expect(mvpMigration).toContain('r.reverses_transaction_id=t.id');
    expect(mvpMigration).not.toMatch(/grant .*market\./i);
  });
});

const marketPublicationMigration = await readFile(
  new URL('../migrations/202608280002_market_admin_publication.sql', import.meta.url),
  'utf8',
);
describe('market-data publication migration', () => {
  it('keeps raw CSV payloads private and requires a distinct data-admin reviewer', () => {
    expect(marketPublicationMigration).toContain('private.market_ingestion_blobs');
    expect(marketPublicationMigration).toContain("not private.has_role('data_admin')");
    expect(marketPublicationMigration).toContain('v_run.proposed_by=v_user');
    expect(marketPublicationMigration).toContain('SECOND_ADMIN_REQUIRED');
    expect(marketPublicationMigration).toContain("set search_path=''");
    expect(marketPublicationMigration).not.toMatch(
      /grant (select|insert|update|delete).*market_ingestion_blobs.*authenticated/i,
    );
  });

  it('publishes normalized prices only after candidate validation and preserves prior versions', () => {
    expect(marketPublicationMigration).toContain("v_run.status<>'previewed'");
    expect(marketPublicationMigration).toContain('security_id is null');
    expect(marketPublicationMigration).toContain("set status='superseded'");
    expect(marketPublicationMigration).toContain("'published',v_run.id");
    expect(marketPublicationMigration).toContain('market_prices.published');
  });
});

const mvpReadModelMigration = await readFile(
  new URL('../migrations/202608280003_mvp_completion_read_models.sql', import.meta.url),
  'utf8',
);
const securityMasterMigration = await readFile(
  new URL('../migrations/202608280004_market_security_master_admin.sql', import.meta.url),
  'utf8',
);

describe('MVP market completion hardening', () => {
  it('exposes normalized provider provenance without exposing raw ingestion relations', () => {
    expect(mvpReadModelMigration).toContain('latest_provider_id');
    expect(mvpReadModelMigration).toContain('r.provider_id');
    expect(mvpReadModelMigration).toContain(
      "s.listing_status in ('active','suspended','delisted')",
    );
    expect(mvpReadModelMigration).not.toMatch(/grant .*market\./i);
  });

  it('keeps security-master mutation behind the data-admin command and audit trail', () => {
    expect(securityMasterMigration).toContain("private.has_role('data_admin')");
    expect(securityMasterMigration).toContain("set search_path=''");
    expect(securityMasterMigration).toContain('market_security_master.upserted');
    expect(securityMasterMigration).not.toMatch(
      /grant (insert|update|delete).*market\.securities.*authenticated/i,
    );
  });
});

const marketImportReviewMigration = await readFile(
  new URL('../migrations/202608280005_market_import_review_details.sql', import.meta.url),
  'utf8',
);

describe('market import review details migration', () => {
  it('keeps import validation details data-admin-only while exposing warnings to the review UI', () => {
    expect(marketImportReviewMigration).toContain('validation_report jsonb');
    expect(marketImportReviewMigration).toContain("private.has_role('data_admin')");
    expect(marketImportReviewMigration).toContain("set search_path=''");
    expect(marketImportReviewMigration).toContain(
      'grant execute on function public.list_market_price_imports() to authenticated',
    );
    expect(marketImportReviewMigration).not.toMatch(
      /grant (select|insert|update|delete).*market\.ingestion_runs.*authenticated/i,
    );
  });
});

const marketOhlcvMigration = await readFile(
  new URL('../migrations/202608280007_market_ohlcv_history.sql', import.meta.url),
  'utf8',
);
const marketIndicesMigration = await readFile(
  new URL('../migrations/202608280009_market_indices_and_bvc_security_master.sql', import.meta.url),
  'utf8',
);

describe('market OHLCV publication migration', () => {
  it('persists only normalized OHLCV columns and keeps publication behind the existing second-admin command', () => {
    expect(marketOhlcvMigration).toContain('add column open_price numeric');
    expect(marketOhlcvMigration).toContain('add column high_price numeric');
    expect(marketOhlcvMigration).toContain('add column low_price numeric');
    expect(marketOhlcvMigration).toContain('add column volume numeric');
    expect(marketOhlcvMigration).toContain('v_run.proposed_by=v_user');
    expect(marketOhlcvMigration).toContain("v_run.status<>'previewed'");
    expect(marketOhlcvMigration).toContain('public.market_price_history');
    expect(marketOhlcvMigration).not.toMatch(/grant .*market\./i);
    expect(marketOhlcvMigration).not.toMatch(/\b(float|real|double precision)\b/i);
  });
});

describe('market indices and BVC security master migration', () => {
  it('adds normalized index tables and public read models without opening raw market writes', () => {
    expect(marketIndicesMigration).toContain('create table market.indices');
    expect(marketIndicesMigration).toContain('create table market.index_observations');
    expect(marketIndicesMigration).toContain('public.market_index_overview');
    expect(marketIndicesMigration).toContain('public.market_index_history');
    expect(marketIndicesMigration).toContain('enable row level security');
    expect(marketIndicesMigration).toContain(
      "source_provider_id in ('admin_csv','licensed_api','licensed_sftp','bvc_public_testing')",
    );
    expect(marketIndicesMigration).not.toMatch(/grant .*market\./i);
    expect(marketIndicesMigration).not.toMatch(/\b(float|real|double precision)\b/i);
  });

  it('keeps BVC security and index mutation behind data-admin audited commands', () => {
    expect(marketIndicesMigration).toContain("private.has_role('data_admin')");
    expect(marketIndicesMigration).toContain("set search_path=''");
    expect(marketIndicesMigration).toContain('market_security_master.upserted');
    expect(marketIndicesMigration).toContain('market_indices.upserted');
    expect(marketIndicesMigration).toContain('market_index_observations.upserted');
    expect(marketIndicesMigration).toContain(
      'grant execute on function public.upsert_market_indices(jsonb) to authenticated',
    );
  });
});
