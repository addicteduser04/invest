'use client';

import React, { useState, type FormEvent } from 'react';
import type { Locale } from '@bvc/contracts';
import { getUi } from '@/lib/i18n';

export interface CoverageStats {
  totalIssuers: number;
  listedIssuers: number;
  unlistedIssuers: number;
  foreignIssuers: number;
  historicalIssuers: number;
  issuersWithReports: number;
  issuersWithoutReports: number;
  totalReports: number;
  earliestYear: number | null;
  latestYear: number | null;
  ambiguousIssuers: number;
  lastSync: { id: string; status: string; startedAt: string; finishedAt: string | null } | null;
}

export interface SyncRun {
  id: string;
  status: string;
  dry_run: boolean;
  scope: { ticker?: string; year?: number; all?: boolean };
  started_at: string;
  finished_at: string | null;
  issuers_discovered: number;
  issuers_existing: number;
  issuers_created: number;
  issuers_ambiguous: number;
  issuers_with_reports: number;
  issuers_without_reports: number;
  documents_discovered: number;
  documents_inserted: number;
  documents_updated: number;
  documents_unchanged: number;
}

export interface AmbiguousIssuerRow {
  id: string;
  source_issuer_id: string;
  source_issuer_name: string;
  candidate_issuer_id: string | null;
  status: string;
  last_seen_at: string;
}

export interface IssuerOption {
  id: string;
  name: string;
  slug: string;
  equity_listing_status: string;
  issuer_type: string | null;
  ammc_issuer_id: string | null;
  security_id: string | null;
  security_ticker: string | null;
}

export interface AdminReportsProps {
  locale: Locale;
  stats: CoverageStats | null;
  runs: SyncRun[];
  ambiguous: AmbiguousIssuerRow[];
  issuers: IssuerOption[];
}

const intlLocale = (locale: Locale) =>
  locale === 'ar' ? 'ar-MA' : locale === 'fr' ? 'fr-MA' : 'en-MA';

function formatDateTime(value: string | null, locale: Locale) {
  return value ? new Date(value).toLocaleString(intlLocale(locale)) : '—';
}

function scopeLabel(run: SyncRun, t: ReturnType<typeof getUi>) {
  const parts: string[] = [];
  if (run.scope.ticker) parts.push(run.scope.ticker);
  else if (run.scope.year) parts.push(String(run.scope.year));
  else parts.push(t.adminReportsScopeAll);
  if (run.dry_run) parts.push(t.adminReportsScopeDryRun);
  return parts.join(' · ');
}

function issuerLabel(issuerId: string | null, issuers: IssuerOption[]) {
  if (!issuerId) return null;
  const match = issuers.find((i) => i.id === issuerId);
  if (!match) return issuerId;
  return match.security_ticker ? `${match.name} (${match.security_ticker})` : match.name;
}

export function AdminReports({ locale, stats, runs, ambiguous, issuers }: AdminReportsProps) {
  const t = getUi(locale);
  const [syncing, setSyncing] = useState(false);
  const [syncTicker, setSyncTicker] = useState('');
  const [syncYear, setSyncYear] = useState('');
  const [syncDryRun, setSyncDryRun] = useState(false);
  const [syncResult, setSyncResult] = useState('');
  const [ambiguousRows, setAmbiguousRows] = useState(ambiguous);
  const [busyAmbiguousId, setBusyAmbiguousId] = useState<string | null>(null);

  const runSync = async (event: FormEvent) => {
    event.preventDefault();
    setSyncing(true);
    setSyncResult('');
    try {
      const response = await fetch('/api/admin/reports/sync', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ticker: syncTicker || undefined,
          year: syncYear || undefined,
          dryRun: syncDryRun,
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        setSyncResult(String(body.error ?? 'Error'));
        return;
      }
      const s = body.summary;
      setSyncResult(
        `${t.adminReportsSyncFinished}: ${s.status} — ${s.issuersDiscovered} issuers (${s.issuersCreated} new, ${s.issuersAmbiguous} ambiguous), ${s.documentsInserted} reports inserted`,
      );
    } catch {
      setSyncResult('Error');
    } finally {
      setSyncing(false);
    }
  };

  const resolveAmbiguous = async (
    id: string,
    status: 'resolved' | 'ignored',
    linkIssuerId?: string,
  ) => {
    setBusyAmbiguousId(id);
    try {
      const response = await fetch(`/api/admin/reports/ambiguous/${id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status, linkIssuerId }),
      });
      if (response.ok) {
        setAmbiguousRows((rows) => rows.map((row) => (row.id === id ? { ...row, status } : row)));
      }
    } finally {
      setBusyAmbiguousId(null);
    }
  };

  return (
    <>
      <section className="card">
        <div className="dashboard-grid">
          <div className="metric-card">
            <span>{t.adminReportsTotalIssuers}</span>
            <strong>{stats?.totalIssuers ?? '—'}</strong>
          </div>
          <div className="metric-card">
            <span>{t.adminReportsListedIssuers}</span>
            <strong>{stats?.listedIssuers ?? '—'}</strong>
          </div>
          <div className="metric-card">
            <span>{t.adminReportsUnlistedIssuers}</span>
            <strong>{stats?.unlistedIssuers ?? '—'}</strong>
          </div>
          <div className="metric-card">
            <span>{t.adminReportsForeignIssuers}</span>
            <strong>{stats?.foreignIssuers ?? '—'}</strong>
          </div>
          <div className="metric-card">
            <span>{t.adminReportsIssuersWithReports}</span>
            <strong>{stats?.issuersWithReports ?? '—'}</strong>
          </div>
          <div className="metric-card">
            <span>{t.adminReportsIssuersWithoutReports}</span>
            <strong>{stats?.issuersWithoutReports ?? '—'}</strong>
          </div>
          <div className="metric-card">
            <span>{t.adminReportsTotalReports}</span>
            <strong>{stats?.totalReports ?? '—'}</strong>
          </div>
          <div className="metric-card">
            <span>{t.adminReportsEarliestYear}</span>
            <strong>{stats?.earliestYear ?? '—'}</strong>
          </div>
          <div className="metric-card">
            <span>{t.adminReportsLatestYear}</span>
            <strong>{stats?.latestYear ?? '—'}</strong>
          </div>
          <div className="metric-card">
            <span>{t.adminReportsAmbiguousIssuers}</span>
            <strong>{stats?.ambiguousIssuers ?? '—'}</strong>
          </div>
          <div className="metric-card">
            <span>{t.adminReportsLastSync}</span>
            <strong className="technical">
              {stats?.lastSync ? formatDateTime(stats.lastSync.startedAt, locale) : '—'}
            </strong>
          </div>
        </div>
      </section>

      <section className="card">
        <h2>{t.adminReportsSyncNow}</h2>
        <form className="form" onSubmit={runSync}>
          <label>
            {t.adminReportsSyncTickerLabel}
            <input
              className="technical"
              dir="ltr"
              value={syncTicker}
              onChange={(e) => setSyncTicker(e.target.value.toUpperCase())}
              disabled={syncing || Boolean(syncYear)}
            />
          </label>
          <label>
            {t.adminReportsSyncYearLabel}
            <input
              className="technical"
              dir="ltr"
              inputMode="numeric"
              value={syncYear}
              onChange={(e) => setSyncYear(e.target.value)}
              disabled={syncing || Boolean(syncTicker)}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={syncDryRun}
              onChange={(e) => setSyncDryRun(e.target.checked)}
              disabled={syncing}
            />{' '}
            {t.adminReportsSyncDryRun}
          </label>
          <button className="button" disabled={syncing}>
            {syncing ? t.adminReportsSyncing : t.adminReportsSyncNow}
          </button>
        </form>
        {syncResult ? (
          <p className="status-message" role="status">
            {syncResult}
          </p>
        ) : null}
      </section>

      <section className="card">
        <h2>{t.adminReportsRecentRuns}</h2>
        {runs.length === 0 ? (
          <p className="microcopy">{t.adminReportsNoRuns}</p>
        ) : (
          <div className="table-scroll">
            <table className="table responsive-table">
              <thead>
                <tr>
                  <th>{t.adminReportsColStarted}</th>
                  <th>{t.adminReportsColStatus}</th>
                  <th>{t.adminReportsColScope}</th>
                  <th data-numeric>{t.adminReportsColIssuers}</th>
                  <th data-numeric>{t.adminReportsColCreated}</th>
                  <th data-numeric>{t.adminReportsColAmbiguousCount}</th>
                  <th data-numeric>{t.adminReportsColDiscovered}</th>
                  <th data-numeric>{t.adminReportsColInserted}</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id}>
                    <td data-label={t.adminReportsColStarted} className="technical" dir="ltr">
                      {formatDateTime(run.started_at, locale)}
                    </td>
                    <td data-label={t.adminReportsColStatus}>{run.status}</td>
                    <td data-label={t.adminReportsColScope}>{scopeLabel(run, t)}</td>
                    <td
                      data-label={t.adminReportsColIssuers}
                      data-numeric
                      className="technical"
                      dir="ltr"
                    >
                      {run.issuers_discovered}
                    </td>
                    <td
                      data-label={t.adminReportsColCreated}
                      data-numeric
                      className="technical"
                      dir="ltr"
                    >
                      {run.issuers_created}
                    </td>
                    <td
                      data-label={t.adminReportsColAmbiguousCount}
                      data-numeric
                      className="technical"
                      dir="ltr"
                    >
                      {run.issuers_ambiguous}
                    </td>
                    <td
                      data-label={t.adminReportsColDiscovered}
                      data-numeric
                      className="technical"
                      dir="ltr"
                    >
                      {run.documents_discovered}
                    </td>
                    <td
                      data-label={t.adminReportsColInserted}
                      data-numeric
                      className="technical"
                      dir="ltr"
                    >
                      {run.documents_inserted}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h2>{t.adminReportsAmbiguousTitle}</h2>
        {ambiguousRows.filter((r) => r.status === 'open').length === 0 ? (
          <p className="microcopy">{t.adminReportsAmbiguousEmpty}</p>
        ) : (
          <div className="table-scroll">
            <table className="table responsive-table">
              <thead>
                <tr>
                  <th>{t.adminReportsColIssuer}</th>
                  <th>{t.adminReportsColCandidate}</th>
                  <th>{t.adminReportsColActions}</th>
                </tr>
              </thead>
              <tbody>
                {ambiguousRows
                  .filter((row) => row.status === 'open')
                  .map((row) => (
                    <AmbiguousRow
                      key={row.id}
                      row={row}
                      issuers={issuers}
                      t={t}
                      busy={busyAmbiguousId === row.id}
                      onResolve={resolveAmbiguous}
                    />
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <IssuerAmmcLinkCard locale={locale} issuers={issuers} />
      <CreateIssuerCard locale={locale} />
      <ManualEntryCard locale={locale} issuers={issuers} />
    </>
  );
}

function AmbiguousRow({
  row,
  issuers,
  t,
  busy,
  onResolve,
}: {
  row: AmbiguousIssuerRow;
  issuers: IssuerOption[];
  t: ReturnType<typeof getUi>;
  busy: boolean;
  onResolve: (id: string, status: 'resolved' | 'ignored', linkIssuerId?: string) => void;
}) {
  const [linkTarget, setLinkTarget] = useState(row.candidate_issuer_id ?? '');
  return (
    <tr>
      <td data-label={t.adminReportsColIssuer}>
        <span dir="ltr">{row.source_issuer_id}</span> {row.source_issuer_name}
      </td>
      <td data-label={t.adminReportsColCandidate}>
        <select value={linkTarget} onChange={(e) => setLinkTarget(e.target.value)}>
          <option value="">—</option>
          {issuers.map((issuer) => (
            <option key={issuer.id} value={issuer.id}>
              {issuer.name}
            </option>
          ))}
        </select>
      </td>
      <td data-label={t.adminReportsColActions}>
        <button
          type="button"
          className="button compact"
          disabled={busy || !linkTarget}
          onClick={() => onResolve(row.id, 'resolved', linkTarget)}
        >
          {t.adminReportsLinkAndResolve}
        </button>{' '}
        <button
          type="button"
          className="button compact secondary"
          disabled={busy}
          onClick={() => onResolve(row.id, 'ignored')}
        >
          {t.adminReportsIgnore}
        </button>
      </td>
    </tr>
  );
}

function IssuerAmmcLinkCard({ locale, issuers }: { locale: Locale; issuers: IssuerOption[] }) {
  const t = getUi(locale);
  const [issuerId, setIssuerId] = useState('');
  const [ammcIssuerId, setAmmcIssuerId] = useState('');
  const [ammcIssuerName, setAmmcIssuerName] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/admin/reports/ammc-link', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ issuerId, ammcIssuerId, ammcIssuerName }),
      });
      const body = await response.json();
      setMessage(response.ok ? t.adminReportsAliasSave : String(body.error ?? 'Error'));
    } finally {
      setBusy(false);
    }
  };

  const linked = issuers.filter((i) => i.ammc_issuer_id);

  return (
    <section className="card">
      <h2>{t.adminReportsAliasesTitle}</h2>
      <p className="microcopy">{t.adminReportsAliasesSubtitle}</p>
      {linked.length ? (
        <div className="table-scroll">
          <table className="table responsive-table">
            <thead>
              <tr>
                <th>{t.adminReportsAliasSecurityLabel}</th>
                <th>{t.adminReportsAliasIssuerIdLabel}</th>
              </tr>
            </thead>
            <tbody>
              {linked.map((issuer) => (
                <tr key={issuer.id}>
                  <td data-label={t.adminReportsAliasSecurityLabel}>{issuer.name}</td>
                  <td data-label={t.adminReportsAliasIssuerIdLabel} className="technical" dir="ltr">
                    {issuer.ammc_issuer_id}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <form className="form" onSubmit={save}>
        <label>
          {t.adminReportsAliasSecurityLabel}
          <select value={issuerId} onChange={(e) => setIssuerId(e.target.value)} required>
            <option value="">—</option>
            {issuers.map((issuer) => (
              <option key={issuer.id} value={issuer.id}>
                {issuer.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t.adminReportsAliasIssuerIdLabel}
          <input
            className="technical"
            dir="ltr"
            value={ammcIssuerId}
            onChange={(e) => setAmmcIssuerId(e.target.value)}
            required
          />
        </label>
        <label>
          {t.adminReportsAliasIssuerNameLabel}
          <input
            value={ammcIssuerName}
            onChange={(e) => setAmmcIssuerName(e.target.value)}
            required
          />
        </label>
        <button className="button compact" disabled={busy}>
          {t.adminReportsAliasSave}
        </button>
      </form>
      {message ? (
        <p className="status-message" role="status">
          {message}
        </p>
      ) : null}
    </section>
  );
}

function CreateIssuerCard({ locale }: { locale: Locale }) {
  const t = getUi(locale);
  const [name, setName] = useState('');
  const [equityListingStatus, setEquityListingStatus] = useState('no_listed_bvc_equity');
  const [issuerType, setIssuerType] = useState('unlisted_company');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/admin/reports/issuers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, equityListingStatus, issuerType }),
      });
      const body = await response.json();
      if (response.ok) {
        setMessage(t.adminReportsIssuerCreated);
        setName('');
      } else {
        setMessage(String(body.error ?? 'Error'));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <h2>{t.adminReportsCreateIssuerTitle}</h2>
      <form className="form" onSubmit={save}>
        <label>
          {t.adminReportsCreateIssuerNameLabel}
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label>
          {t.adminReportsCreateIssuerListingLabel}
          <select
            value={equityListingStatus}
            onChange={(e) => setEquityListingStatus(e.target.value)}
          >
            <option value="no_listed_bvc_equity">{t.adminReportsListingNoListedEquity}</option>
            <option value="historical_or_delisted">{t.adminReportsListingHistorical}</option>
            <option value="unknown">{t.adminReportsListingUnknown}</option>
          </select>
        </label>
        <label>
          {t.adminReportsCreateIssuerTypeLabel}
          <select value={issuerType} onChange={(e) => setIssuerType(e.target.value)}>
            <option value="unlisted_company">unlisted_company</option>
            <option value="public_entity">public_entity</option>
            <option value="financial_institution">financial_institution</option>
            <option value="foreign_issuer">foreign_issuer</option>
            <option value="historical_issuer">historical_issuer</option>
            <option value="other">other</option>
          </select>
        </label>
        <button className="button compact" disabled={busy}>
          {t.adminReportsCreateIssuerSave}
        </button>
      </form>
      {message ? (
        <p className="status-message" role="status">
          {message}
        </p>
      ) : null}
    </section>
  );
}

function ManualEntryCard({ locale, issuers }: { locale: Locale; issuers: IssuerOption[] }) {
  const t = getUi(locale);
  const [issuerId, setIssuerId] = useState('');
  const [fiscalYear, setFiscalYear] = useState('');
  const [title, setTitle] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [publicationDate, setPublicationDate] = useState('');
  const [language, setLanguage] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/admin/reports/manual', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          issuerId,
          fiscalYear: Number(fiscalYear),
          title,
          sourceUrl,
          publicationDate: publicationDate || undefined,
          language: language || undefined,
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        setMessage(String(body.error ?? 'Error'));
        return;
      }
      setMessage(t.adminReportsManualSaved);
      setTitle('');
      setSourceUrl('');
      setPublicationDate('');
      setLanguage('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <h2>{t.adminReportsManualTitle}</h2>
      <p className="microcopy">{t.adminReportsManualSubtitle}</p>
      <form className="form" onSubmit={save}>
        <label>
          {t.adminReportsManualSecurityLabel}
          <select value={issuerId} onChange={(e) => setIssuerId(e.target.value)} required>
            <option value="">—</option>
            {issuers.map((issuer) => (
              <option key={issuer.id} value={issuer.id}>
                {issuerLabel(issuer.id, issuers)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t.adminReportsManualYearLabel}
          <input
            className="technical"
            dir="ltr"
            inputMode="numeric"
            value={fiscalYear}
            onChange={(e) => setFiscalYear(e.target.value)}
            required
          />
        </label>
        <label>
          {t.adminReportsManualTitleLabel}
          <input value={title} onChange={(e) => setTitle(e.target.value)} required />
        </label>
        <label>
          {t.adminReportsManualUrlLabel}
          <input
            className="technical"
            dir="ltr"
            type="url"
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            required
          />
        </label>
        <label>
          {t.adminReportsManualDateLabel}
          <input
            className="technical"
            dir="ltr"
            type="date"
            value={publicationDate}
            onChange={(e) => setPublicationDate(e.target.value)}
          />
        </label>
        <label>
          {t.adminReportsManualLanguageLabel}
          <input
            className="technical"
            dir="ltr"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
          />
        </label>
        <button className="button compact" disabled={busy}>
          {t.adminReportsManualSave}
        </button>
      </form>
      {message ? (
        <p className="status-message" role="status">
          {message}
        </p>
      ) : null}
    </section>
  );
}
