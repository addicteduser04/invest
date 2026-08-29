'use client';

import { useState, type FormEvent } from 'react';
import type { Locale } from '@bvc/contracts';

type Run = {
  id: string;
  status: string;
  source_hash: string;
  original_object_path: string;
  proposed_by: string;
  reviewed_by: string | null;
  created_at: string;
  published_at: string | null;
  candidate_count: number;
  validation_report?: { errors?: string[]; warnings?: string[] } | null;
};

type BvcPreviewResponse = {
  rowCount?: number;
  csv?: string;
  filename?: string;
  sourceHash?: string;
  warnings?: string[];
  error?: string;
  notice?: string;
  candidates?: unknown[];
  snapshots?: unknown[];
};

const copy = {
  en: {
    upload: 'Upload and validate',
    pending: 'Import runs',
    approve: 'Approve & publish',
    reason: 'Review reason',
    rows: 'rows',
    uploaded: 'Upload persisted for second-admin review.',
    status: 'Status',
    created: 'Created',
    hash: 'Hash',
    published: 'Published',
    reload: 'Reload this page to refresh the run list.',
    dateColumn: 'Date column',
    tickerColumn: 'Ticker column',
    closeColumn: 'Close column',
    bvcTitle: 'BVC public-data testing export',
    bvcNotice:
      'Private/staging testing only. This fetches the public Bourse de Casablanca historical endpoint read-only and never publishes automatically.',
    bvcTicker: 'BVC ticker',
    startDate: 'Start date',
    endDate: 'End date',
    fetchBvc: 'Fetch testing CSV',
    download: 'Download normalized CSV',
    bvcDisabled:
      'Enable BVC_PUBLIC_TESTING_ENABLED=true only in a private testing environment to use this tool.',
    bvcReady: 'BVC testing export ready',
    bvcSecurityMaster: 'Fetch security master',
    bvcIndexMaster: 'Fetch index list',
    bvcIndexHistory: 'Fetch MASI history',
    bvcLatest: 'Fetch latest snapshot',
    indexCode: 'Index code',
    period: 'Period',
  },
  fr: {
    upload: 'Importer et valider',
    pending: 'Lots d’import',
    approve: 'Approuver et publier',
    reason: 'Motif de revue',
    rows: 'lignes',
    uploaded: 'Import conservé pour la revue d’un second administrateur.',
    status: 'Statut',
    created: 'Créé le',
    hash: 'Empreinte',
    published: 'Publié',
    reload: 'Rechargez cette page pour actualiser la liste.',
    dateColumn: 'Colonne date',
    tickerColumn: 'Colonne ticker',
    closeColumn: 'Colonne clôture',
    bvcTitle: 'Export de test des données publiques BVC',
    bvcNotice:
      'Tests privés/staging uniquement. Cet outil lit l’historique public de la Bourse de Casablanca et ne publie jamais automatiquement.',
    bvcTicker: 'Ticker BVC',
    startDate: 'Date de début',
    endDate: 'Date de fin',
    fetchBvc: 'Récupérer le CSV de test',
    download: 'Télécharger le CSV normalisé',
    bvcDisabled:
      'Activez BVC_PUBLIC_TESTING_ENABLED=true uniquement dans un environnement de test privé pour utiliser cet outil.',
    bvcReady: 'Export BVC de test prêt',
    bvcSecurityMaster: 'Récupérer le référentiel valeurs',
    bvcIndexMaster: 'Récupérer la liste des indices',
    bvcIndexHistory: 'Récupérer l’historique MASI',
    bvcLatest: 'Récupérer le snapshot récent',
    indexCode: 'Code indice',
    period: 'Période',
  },
  ar: {
    upload: 'رفع الملف والتحقق',
    pending: 'دفعات الاستيراد',
    approve: 'الموافقة والنشر',
    reason: 'سبب المراجعة',
    rows: 'صفوف',
    uploaded: 'تم حفظ الاستيراد لمراجعة مسؤول ثانٍ.',
    status: 'الحالة',
    created: 'تاريخ الإنشاء',
    hash: 'البصمة',
    published: 'تم النشر',
    reload: 'أعد تحميل الصفحة لتحديث قائمة الدفعات.',
    dateColumn: 'عمود التاريخ',
    tickerColumn: 'عمود الرمز',
    closeColumn: 'عمود الإغلاق',
    bvcTitle: 'تصدير اختباري لبيانات بورصة الدار البيضاء العامة',
    bvcNotice:
      'للاختبار الخاص أو بيئة staging فقط. يجلب هذا الخيار السجل العام من بورصة الدار البيضاء للقراءة فقط ولا ينشر البيانات تلقائياً.',
    bvcTicker: 'رمز BVC',
    startDate: 'تاريخ البداية',
    endDate: 'تاريخ النهاية',
    fetchBvc: 'جلب CSV للاختبار',
    download: 'تنزيل CSV الموحّد',
    bvcDisabled:
      'فعّل BVC_PUBLIC_TESTING_ENABLED=true فقط في بيئة اختبار خاصة لاستخدام هذه الأداة.',
    bvcReady: 'تصدير BVC الاختباري جاهز',
    bvcSecurityMaster: 'جلب مرجع القيم',
    bvcIndexMaster: 'جلب قائمة المؤشرات',
    bvcIndexHistory: 'جلب سجل MASI',
    bvcLatest: 'جلب اللقطة الأخيرة',
    indexCode: 'رمز المؤشر',
    period: 'الفترة',
  },
} as const;

const isoDaysAgo = (days: number) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
};

export function AdminMarketImport({
  locale,
  currentUserId,
  runs,
  bvcTestingEnabled,
}: {
  locale: Locale;
  currentUserId: string;
  runs: Run[];
  bvcTestingEnabled: boolean;
}) {
  const t = copy[locale];
  const [result, setResult] = useState('');
  const [busy, setBusy] = useState(false);
  const [bvcBusy, setBvcBusy] = useState(false);
  const [bvcResult, setBvcResult] = useState<BvcPreviewResponse | null>(null);
  const [bvcReferenceResult, setBvcReferenceResult] = useState<BvcPreviewResponse | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setResult('');
    try {
      const response = await fetch('/api/admin/imports/preview', {
        method: 'POST',
        body: new FormData(event.currentTarget),
      });
      const body = (await response.json()) as {
        ingestionRunId?: string;
        error?: string;
        notice?: string;
        warnings?: string[];
      };
      const warningText = body.warnings?.length ? ` ${body.warnings.join(' ')}` : '';
      setResult(
        response.ok
          ? `${t.uploaded} ${body.ingestionRunId ?? ''}${warningText}`.trim()
          : String(body.error ?? body.notice ?? 'Error'),
      );
    } finally {
      setBusy(false);
    }
  };

  const fetchBvc = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!bvcTestingEnabled) return;
    setBvcBusy(true);
    setBvcResult(null);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch('/api/admin/imports/bvc', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          instrument: String(form.get('instrument') ?? ''),
          startDate: String(form.get('startDate') ?? ''),
          endDate: String(form.get('endDate') ?? ''),
        }),
      });
      const body = (await response.json()) as BvcPreviewResponse;
      setBvcResult(body);
    } catch {
      setBvcResult({ error: 'BVC_FETCH_FAILED' });
    } finally {
      setBvcBusy(false);
    }
  };

  const fetchBvcReference = async (
    endpoint: '/api/admin/imports/bvc/security-master' | '/api/admin/imports/bvc/indices',
    body?: Record<string, unknown>,
  ) => {
    if (!bvcTestingEnabled) return;
    setBvcBusy(true);
    setBvcReferenceResult(null);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      });
      setBvcReferenceResult((await response.json()) as BvcPreviewResponse);
    } catch {
      setBvcReferenceResult({ error: 'BVC_FETCH_FAILED' });
    } finally {
      setBvcBusy(false);
    }
  };

  const fetchBvcIndexHistory = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await fetchBvcReference('/api/admin/imports/bvc/indices', {
      mode: 'history',
      code: String(form.get('code') ?? 'MASI'),
      period: String(form.get('period') ?? '1m'),
    });
  };

  const downloadBvcCsv = () => {
    if (!bvcResult?.csv) return;
    const blob = new Blob([bvcResult.csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = bvcResult.filename ?? 'bvc-public-test.csv';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const publish = async (id: string, reason: string) => {
    setBusy(true);
    setResult('');
    try {
      const response = await fetch(`/api/admin/imports/${id}/publish`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      const body = (await response.json()) as { publishedRows?: number; error?: string };
      setResult(
        response.ok
          ? `${t.published}: ${body.publishedRows ?? 0} ${t.rows}. ${t.reload}`
          : String(body.error ?? 'Error'),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dashboard-grid">
      <section className="card">
        <form className="form" onSubmit={(event) => void submit(event)}>
          <label>
            CSV
            <input required type="file" name="file" accept=".csv,text/csv" />
          </label>
          <label>
            {t.dateColumn}
            <input name="date" defaultValue="time" />
          </label>
          <label>
            {t.tickerColumn}
            <input name="ticker" defaultValue="symbol" />
          </label>
          <label>
            {t.closeColumn}
            <input name="close" defaultValue="close" />
          </label>
          <button className="button" disabled={busy}>
            {t.upload}
          </button>
        </form>
        {result ? (
          <p className="status-message" role="status">
            {result}
          </p>
        ) : null}
      </section>

      <section className="card">
        <p className="eyebrow">BVC</p>
        <h2>{t.bvcTitle}</h2>
        <p className="microcopy">{t.bvcNotice}</p>
        {bvcTestingEnabled ? (
          <form className="form bvc-testing-form" onSubmit={(event) => void fetchBvc(event)}>
            <label>
              {t.bvcTicker}
              <input name="instrument" defaultValue="IAM" required maxLength={30} dir="ltr" />
            </label>
            <div className="form-grid">
              <label>
                {t.startDate}
                <input
                  name="startDate"
                  type="date"
                  defaultValue={isoDaysAgo(365)}
                  required
                  dir="ltr"
                />
              </label>
              <label>
                {t.endDate}
                <input name="endDate" type="date" defaultValue={isoDaysAgo(0)} required dir="ltr" />
              </label>
            </div>
            <button className="button secondary" disabled={bvcBusy}>
              {t.fetchBvc}
            </button>
          </form>
        ) : (
          <p className="notice">{t.bvcDisabled}</p>
        )}
        {bvcResult ? (
          <div className="bvc-preview-result" role="status">
            {bvcResult.error ? (
              <p className="error-list">{bvcResult.error}</p>
            ) : (
              <>
                <strong>
                  {t.bvcReady}: {bvcResult.rowCount ?? 0} {t.rows}
                </strong>
                {bvcResult.sourceHash ? (
                  <small className="technical" dir="ltr">
                    {bvcResult.sourceHash.slice(0, 16)}…
                  </small>
                ) : null}
                {bvcResult.warnings?.length ? (
                  <ul className="warning-list">
                    {bvcResult.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                ) : null}
                <button
                  type="button"
                  className="button compact"
                  disabled={!bvcResult.csv}
                  onClick={downloadBvcCsv}
                >
                  {t.download}
                </button>
              </>
            )}
          </div>
        ) : null}
        {bvcTestingEnabled ? (
          <div className="bvc-reference-actions">
            <button
              type="button"
              className="button compact secondary"
              disabled={bvcBusy}
              onClick={() => void fetchBvcReference('/api/admin/imports/bvc/security-master')}
            >
              {t.bvcSecurityMaster}
            </button>
            <button
              type="button"
              className="button compact secondary"
              disabled={bvcBusy}
              onClick={() =>
                void fetchBvcReference('/api/admin/imports/bvc/indices', { mode: 'master' })
              }
            >
              {t.bvcIndexMaster}
            </button>
            <button
              type="button"
              className="button compact secondary"
              disabled={bvcBusy}
              onClick={() =>
                void fetchBvcReference('/api/admin/imports/bvc/indices', { mode: 'latest' })
              }
            >
              {t.bvcLatest}
            </button>
          </div>
        ) : null}
        {bvcTestingEnabled ? (
          <form
            className="form bvc-index-form"
            onSubmit={(event) => void fetchBvcIndexHistory(event)}
          >
            <div className="form-grid">
              <label>
                {t.indexCode}
                <select name="code" defaultValue="MASI">
                  <option value="MASI">MASI</option>
                  <option value="MSI20">MASI 20</option>
                  <option value="ESGI">MASI ESG</option>
                  <option value="MASIMS">MASI Mid and Small Cap</option>
                </select>
              </label>
              <label>
                {t.period}
                <select name="period" defaultValue="1m">
                  <option value="1m">1m</option>
                  <option value="3m">3m</option>
                  <option value="6m">6m</option>
                  <option value="1y">1y</option>
                  <option value="2y">2y</option>
                  <option value="3y">3y</option>
                </select>
              </label>
            </div>
            <button className="button compact secondary" disabled={bvcBusy}>
              {t.bvcIndexHistory}
            </button>
          </form>
        ) : null}
        {bvcReferenceResult ? (
          <div className="bvc-preview-result" role="status">
            {bvcReferenceResult.error ? (
              <p className="error-list">{bvcReferenceResult.error}</p>
            ) : (
              <>
                <strong>
                  {t.bvcReady}: {bvcReferenceResult.rowCount ?? 0} {t.rows}
                </strong>
                {bvcReferenceResult.sourceHash ? (
                  <small className="technical" dir="ltr">
                    {bvcReferenceResult.sourceHash.slice(0, 16)}…
                  </small>
                ) : null}
                {bvcReferenceResult.notice ? (
                  <p className="microcopy">{bvcReferenceResult.notice}</p>
                ) : null}
                {bvcReferenceResult.warnings?.length ? (
                  <ul className="warning-list">
                    {bvcReferenceResult.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                ) : null}
                {bvcReferenceResult.csv ? (
                  <button
                    type="button"
                    className="button compact"
                    onClick={() => {
                      const blob = new Blob([bvcReferenceResult.csv ?? ''], {
                        type: 'text/csv;charset=utf-8',
                      });
                      const url = URL.createObjectURL(blob);
                      const anchor = document.createElement('a');
                      anchor.href = url;
                      anchor.download = bvcReferenceResult.filename ?? 'bvc-public-test.csv';
                      document.body.append(anchor);
                      anchor.click();
                      anchor.remove();
                      URL.revokeObjectURL(url);
                    }}
                  >
                    {t.download}
                  </button>
                ) : null}
              </>
            )}
          </div>
        ) : null}
      </section>

      <section className="card span-2">
        <h2>{t.pending}</h2>
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>{t.status}</th>
                <th>{t.created}</th>
                <th>{t.rows}</th>
                <th>{t.hash}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id}>
                  <td>
                    {run.status}
                    {run.validation_report?.warnings?.length ? (
                      <small className="warning-text">
                        {run.validation_report.warnings.join(' · ')}
                      </small>
                    ) : null}
                  </td>
                  <td>
                    {new Date(run.created_at).toLocaleString(
                      locale === 'ar' ? 'ar-MA' : locale === 'fr' ? 'fr-MA' : 'en-MA',
                    )}
                  </td>
                  <td>{run.candidate_count}</td>
                  <td className="technical" dir="ltr">
                    {run.source_hash.slice(0, 10)}…
                  </td>
                  <td>
                    {run.status === 'previewed' && run.proposed_by !== currentUserId ? (
                      <Approval
                        disabled={busy}
                        label={t.approve}
                        reasonLabel={t.reason}
                        onApprove={(reason) => publish(run.id, reason)}
                      />
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Approval({
  disabled,
  label,
  reasonLabel,
  onApprove,
}: {
  disabled: boolean;
  label: string;
  reasonLabel: string;
  onApprove: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  return (
    <div className="approval-control">
      <input
        aria-label={reasonLabel}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
      />
      <button
        type="button"
        className="button compact"
        disabled={disabled || reason.trim().length < 3}
        onClick={() => void onApprove(reason)}
      >
        {label}
      </button>
    </div>
  );
}
