'use client';

import { useState, type FormEvent } from 'react';
import type { Locale } from '@bvc/contracts';
import { getUi } from '@/lib/i18n';

export interface CoverageStats {
  companiesWithReports: number;
  companiesWithoutReports: number;
  totalReports: number;
  earliestYear: number | null;
  latestYear: number | null;
  unmatchedIssuers: number;
  lastSync: { id: string; status: string; startedAt: string; finishedAt: string | null } | null;
}

export interface SyncRun {
  id: string;
  status: string;
  dry_run: boolean;
  scope: { ticker?: string; year?: number; all?: boolean };
  started_at: string;
  finished_at: string | null;
  documents_discovered: number;
  documents_matched: number;
  documents_inserted: number;
  documents_updated: number;
  documents_unchanged: number;
}

export interface UnmatchedIssuerRow {
  id: string;
  source_issuer_id: string;
  source_issuer_name: string;
  candidate_security_id: string | null;
  status: string;
  last_seen_at: string;
}

export interface AliasRow {
  id: string;
  security_id: string;
  source_issuer_id: string;
  source_issuer_name: string;
}

export interface SecurityOption {
  id: string;
  ticker: string;
  name: string;
}

export interface AdminReportsProps {
  locale: Locale;
  stats: CoverageStats | null;
  runs: SyncRun[];
  unmatched: UnmatchedIssuerRow[];
  aliases: AliasRow[];
  securities: SecurityOption[];
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

function securityLabel(securityId: string | null, securities: SecurityOption[]) {
  if (!securityId) return null;
  const match = securities.find((s) => s.id === securityId);
  return match ? `${match.ticker} — ${match.name}` : securityId;
}

export function AdminReports({
  locale,
  stats,
  runs,
  unmatched,
  aliases,
  securities,
}: AdminReportsProps) {
  const t = getUi(locale);
  const [syncing, setSyncing] = useState(false);
  const [syncTicker, setSyncTicker] = useState('');
  const [syncYear, setSyncYear] = useState('');
  const [syncDryRun, setSyncDryRun] = useState(false);
  const [syncResult, setSyncResult] = useState('');
  const [unmatchedRows, setUnmatchedRows] = useState(unmatched);
  const [aliasRows, setAliasRows] = useState(aliases);
  const [busyUnmatchedId, setBusyUnmatchedId] = useState<string | null>(null);

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
        `${t.adminReportsSyncFinished}: ${s.status} — ${s.documentsDiscovered} discovered, ${s.documentsInserted} inserted, ${s.documentsUpdated} updated, ${s.unmatchedIssuers.length} unmatched`,
      );
    } catch {
      setSyncResult('Error');
    } finally {
      setSyncing(false);
    }
  };

  const resolveUnmatched = async (id: string, status: 'resolved' | 'ignored' | 'open') => {
    setBusyUnmatchedId(id);
    try {
      const response = await fetch(`/api/admin/reports/unmatched/${id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (response.ok) {
        setUnmatchedRows((rows) => rows.map((row) => (row.id === id ? { ...row, status } : row)));
      }
    } finally {
      setBusyUnmatchedId(null);
    }
  };

  return (
    <>
      <section className="card">
        <div className="dashboard-grid">
          <div className="metric-card">
            <span>{t.adminReportsCompaniesWithReports}</span>
            <strong>{stats?.companiesWithReports ?? '—'}</strong>
          </div>
          <div className="metric-card">
            <span>{t.adminReportsCompaniesWithoutReports}</span>
            <strong>{stats?.companiesWithoutReports ?? '—'}</strong>
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
            <span>{t.adminReportsUnmatchedIssuers}</span>
            <strong>{stats?.unmatchedIssuers ?? '—'}</strong>
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
                  <th data-numeric>{t.adminReportsColDiscovered}</th>
                  <th data-numeric>{t.adminReportsColInserted}</th>
                  <th data-numeric>{t.adminReportsColUpdated}</th>
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
                    <td
                      data-label={t.adminReportsColUpdated}
                      data-numeric
                      className="technical"
                      dir="ltr"
                    >
                      {run.documents_updated}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h2>{t.adminReportsUnmatchedTitle}</h2>
        {unmatchedRows.filter((r) => r.status === 'open').length === 0 ? (
          <p className="microcopy">{t.adminReportsUnmatchedEmpty}</p>
        ) : (
          <div className="table-scroll">
            <table className="table responsive-table">
              <thead>
                <tr>
                  <th>{t.adminReportsColIssuer}</th>
                  <th>{t.adminReportsColCandidate}</th>
                  <th>{t.adminReportsColStatus}</th>
                  <th>{t.adminReportsColActions}</th>
                </tr>
              </thead>
              <tbody>
                {unmatchedRows
                  .filter((row) => row.status === 'open')
                  .map((row) => (
                    <tr key={row.id}>
                      <td data-label={t.adminReportsColIssuer}>
                        <span dir="ltr">{row.source_issuer_id}</span> {row.source_issuer_name}
                      </td>
                      <td data-label={t.adminReportsColCandidate}>
                        {securityLabel(row.candidate_security_id, securities) ?? '—'}
                      </td>
                      <td data-label={t.adminReportsColStatus}>{row.status}</td>
                      <td data-label={t.adminReportsColActions}>
                        <button
                          type="button"
                          className="button compact"
                          disabled={busyUnmatchedId === row.id}
                          onClick={() => void resolveUnmatched(row.id, 'resolved')}
                        >
                          {t.adminReportsResolve}
                        </button>{' '}
                        <button
                          type="button"
                          className="button compact secondary"
                          disabled={busyUnmatchedId === row.id}
                          onClick={() => void resolveUnmatched(row.id, 'ignored')}
                        >
                          {t.adminReportsIgnore}
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <AliasesCard
        locale={locale}
        aliases={aliasRows}
        setAliases={setAliasRows}
        securities={securities}
      />
      <ManualEntryCard locale={locale} securities={securities} />
    </>
  );
}

function AliasesCard({
  locale,
  aliases,
  setAliases,
  securities,
}: {
  locale: Locale;
  aliases: AliasRow[];
  setAliases: (updater: (rows: AliasRow[]) => AliasRow[]) => void;
  securities: SecurityOption[];
}) {
  const t = getUi(locale);
  const [securityId, setSecurityId] = useState('');
  const [issuerId, setIssuerId] = useState('');
  const [issuerName, setIssuerName] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/admin/reports/aliases', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          securityId,
          sourceIssuerId: issuerId,
          sourceIssuerName: issuerName,
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        setMessage(String(body.error ?? 'Error'));
        return;
      }
      setAliases((rows) => [
        ...rows.filter((r) => r.security_id !== securityId),
        {
          id: body.id,
          security_id: securityId,
          source_issuer_id: issuerId,
          source_issuer_name: issuerName,
        },
      ]);
      setIssuerId('');
      setIssuerName('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <h2>{t.adminReportsAliasesTitle}</h2>
      <p className="microcopy">{t.adminReportsAliasesSubtitle}</p>
      {aliases.length ? (
        <div className="table-scroll">
          <table className="table responsive-table">
            <thead>
              <tr>
                <th>{t.adminReportsAliasSecurityLabel}</th>
                <th>{t.adminReportsAliasIssuerIdLabel}</th>
                <th>{t.adminReportsAliasIssuerNameLabel}</th>
              </tr>
            </thead>
            <tbody>
              {aliases.map((alias) => (
                <tr key={alias.id}>
                  <td data-label={t.adminReportsAliasSecurityLabel}>
                    {securityLabel(alias.security_id, securities) ?? alias.security_id}
                  </td>
                  <td data-label={t.adminReportsAliasIssuerIdLabel} className="technical" dir="ltr">
                    {alias.source_issuer_id}
                  </td>
                  <td data-label={t.adminReportsAliasIssuerNameLabel}>
                    {alias.source_issuer_name}
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
          <select value={securityId} onChange={(e) => setSecurityId(e.target.value)} required>
            <option value="">—</option>
            {securities.map((security) => (
              <option key={security.id} value={security.id}>
                {security.ticker} — {security.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t.adminReportsAliasIssuerIdLabel}
          <input
            className="technical"
            dir="ltr"
            value={issuerId}
            onChange={(e) => setIssuerId(e.target.value)}
            required
          />
        </label>
        <label>
          {t.adminReportsAliasIssuerNameLabel}
          <input value={issuerName} onChange={(e) => setIssuerName(e.target.value)} required />
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

function ManualEntryCard({ locale, securities }: { locale: Locale; securities: SecurityOption[] }) {
  const t = getUi(locale);
  const [securityId, setSecurityId] = useState('');
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
          securityId,
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
          <select value={securityId} onChange={(e) => setSecurityId(e.target.value)} required>
            <option value="">—</option>
            {securities.map((security) => (
              <option key={security.id} value={security.id}>
                {security.ticker} — {security.name}
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
