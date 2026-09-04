'use client';

import React, { useMemo, useRef, useState, type DragEvent } from 'react';
import type { Locale } from '@bvc/contracts';

export type CsvImportRun = {
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

type PreviewCandidate = { row: number; ticker: string; marketDate: string; close: string };

type PreviewResponse = {
  candidates?: PreviewCandidate[];
  errors?: string[];
  warnings?: string[];
  sourceHash?: string;
  ingestionRunId?: string;
  originalFileName?: string;
  publicationStatus?: 'validation_failed' | 'awaiting_second_admin';
  notice?: string;
  error?: string;
};

type Phase = 'idle' | 'uploading' | 'valid' | 'invalid';

interface Copy {
  eyebrow: string;
  uploadTitle: string;
  dropHint: string;
  orText: string;
  chooseFile: string;
  changeFile: string;
  advancedMapping: string;
  dateColumn: string;
  tickerColumn: string;
  closeColumn: string;
  upload: string;
  uploading: string;
  stepUploaded: string;
  stepValidated: string;
  stepAwaitingReview: string;
  stepPublished: string;
  stepRejected: string;
  previewTitle: string;
  file: string;
  createdBy: string;
  rows: string;
  tickers: string;
  dateRange: string;
  hash: string;
  errors: string;
  warnings: string;
  you: string;
  reviewTitle: string;
  uploadedBy: string;
  required: string;
  requiredValue: string;
  ownUploadNotice: string;
  approve: string;
  reason: string;
  reasonHint: string;
  historyTitle: string;
  colStatus: string;
  colCreated: string;
  colFile: string;
  colRows: string;
  colUploader: string;
  colReviewer: string;
  colPublished: string;
  colActions: string;
  statusLabels: Record<'uploaded' | 'previewed' | 'quarantined' | 'approved' | 'rejected' | 'published' | 'failed', string>;
  emptyHistoryTitle: string;
  emptyHistorySubtitle: string;
  marketDataOpsLink: string;
  dash: string;
  publishedResult: (rows: number) => string;
}

const copy: Record<Locale, Copy> = {
  en: {
    eyebrow: 'CSV imports',
    uploadTitle: 'Upload a CSV',
    dropHint: 'Drop CSV here',
    orText: 'or',
    chooseFile: 'Choose CSV',
    changeFile: 'Choose a different file',
    advancedMapping: 'Advanced CSV mapping',
    dateColumn: 'Date column',
    tickerColumn: 'Ticker column',
    closeColumn: 'Close column',
    upload: 'Upload and validate',
    uploading: 'Uploading…',
    stepUploaded: 'Uploaded',
    stepValidated: 'Validated',
    stepAwaitingReview: 'Awaiting second review',
    stepPublished: 'Published',
    stepRejected: 'Validation failed',
    previewTitle: 'Import preview',
    file: 'File',
    createdBy: 'Created by',
    rows: 'Rows',
    tickers: 'Detected tickers',
    dateRange: 'Date range',
    hash: 'Content hash',
    errors: 'Errors',
    warnings: 'Warnings',
    you: 'you',
    reviewTitle: 'Awaiting independent approval',
    uploadedBy: 'Uploaded by',
    required: 'Required',
    requiredValue: 'a different data administrator',
    ownUploadNotice: 'You uploaded this file. Publication must be approved by a different data administrator.',
    approve: 'Approve & publish',
    reason: 'Review reason',
    reasonHint: 'Briefly note what you reviewed before approving.',
    historyTitle: 'Import history',
    colStatus: 'Status',
    colCreated: 'Created',
    colFile: 'File',
    colRows: 'Rows',
    colUploader: 'Uploader',
    colReviewer: 'Reviewer',
    colPublished: 'Published',
    colActions: 'Actions',
    statusLabels: {
      uploaded: 'Uploaded',
      previewed: 'Awaiting review',
      quarantined: 'Quarantined',
      approved: 'Approved',
      rejected: 'Rejected',
      published: 'Published',
      failed: 'Failed',
    },
    emptyHistoryTitle: 'No imports yet',
    emptyHistorySubtitle: 'Upload a CSV above to start the review workflow.',
    marketDataOpsLink: 'Market data operations',
    dash: '—',
    publishedResult: (rows: number) => `Published ${rows} rows. Reload this page to refresh the list.`,
  },
  fr: {
    eyebrow: 'Imports CSV',
    uploadTitle: 'Importer un CSV',
    dropHint: 'Déposez le CSV ici',
    orText: 'ou',
    chooseFile: 'Choisir un CSV',
    changeFile: 'Choisir un autre fichier',
    advancedMapping: 'Mappage CSV avancé',
    dateColumn: 'Colonne date',
    tickerColumn: 'Colonne ticker',
    closeColumn: 'Colonne clôture',
    upload: 'Importer et valider',
    uploading: 'Import en cours…',
    stepUploaded: 'Importé',
    stepValidated: 'Validé',
    stepAwaitingReview: 'En attente de second avis',
    stepPublished: 'Publié',
    stepRejected: 'Validation échouée',
    previewTitle: 'Aperçu de l’import',
    file: 'Fichier',
    createdBy: 'Créé par',
    rows: 'Lignes',
    tickers: 'Tickers détectés',
    dateRange: 'Plage de dates',
    hash: 'Empreinte du contenu',
    errors: 'Erreurs',
    warnings: 'Avertissements',
    you: 'vous',
    reviewTitle: 'En attente d’une approbation indépendante',
    uploadedBy: 'Importé par',
    required: 'Requis',
    requiredValue: 'un administrateur de données différent',
    ownUploadNotice:
      'Vous avez importé ce fichier. La publication doit être approuvée par un autre administrateur de données.',
    approve: 'Approuver et publier',
    reason: 'Motif de revue',
    reasonHint: 'Notez brièvement ce que vous avez vérifié avant d’approuver.',
    historyTitle: 'Historique des imports',
    colStatus: 'Statut',
    colCreated: 'Créé le',
    colFile: 'Fichier',
    colRows: 'Lignes',
    colUploader: 'Importé par',
    colReviewer: 'Approuvé par',
    colPublished: 'Publié',
    colActions: 'Actions',
    statusLabels: {
      uploaded: 'Importé',
      previewed: 'En attente de revue',
      quarantined: 'En quarantaine',
      approved: 'Approuvé',
      rejected: 'Rejeté',
      published: 'Publié',
      failed: 'Échec',
    },
    emptyHistoryTitle: 'Aucun import pour le moment',
    emptyHistorySubtitle: 'Importez un CSV ci-dessus pour démarrer le circuit de revue.',
    marketDataOpsLink: 'Opérations sur les données de marché',
    dash: '—',
    publishedResult: (rows: number) =>
      `${rows} lignes publiées. Rechargez cette page pour actualiser la liste.`,
  },
  ar: {
    eyebrow: 'استيراد ملفات CSV',
    uploadTitle: 'رفع ملف CSV',
    dropHint: 'أفلت ملف CSV هنا',
    orText: 'أو',
    chooseFile: 'اختيار ملف CSV',
    changeFile: 'اختيار ملف آخر',
    advancedMapping: 'ربط أعمدة CSV المتقدم',
    dateColumn: 'عمود التاريخ',
    tickerColumn: 'عمود الرمز',
    closeColumn: 'عمود الإغلاق',
    upload: 'رفع الملف والتحقق',
    uploading: 'جارٍ الرفع…',
    stepUploaded: 'تم الرفع',
    stepValidated: 'تم التحقق',
    stepAwaitingReview: 'بانتظار مراجعة ثانية',
    stepPublished: 'تم النشر',
    stepRejected: 'فشل التحقق',
    previewTitle: 'معاينة الاستيراد',
    file: 'الملف',
    createdBy: 'أُنشئ بواسطة',
    rows: 'الصفوف',
    tickers: 'الرموز المكتشفة',
    dateRange: 'نطاق التواريخ',
    hash: 'بصمة المحتوى',
    errors: 'الأخطاء',
    warnings: 'التحذيرات',
    you: 'أنت',
    reviewTitle: 'بانتظار موافقة مستقلة',
    uploadedBy: 'رفعه',
    required: 'المطلوب',
    requiredValue: 'مسؤول بيانات مختلف',
    ownUploadNotice: 'لقد رفعت هذا الملف. يجب أن يوافق على النشر مسؤول بيانات آخر.',
    approve: 'الموافقة والنشر',
    reason: 'سبب المراجعة',
    reasonHint: 'دوّن باختصار ما راجعته قبل الموافقة.',
    historyTitle: 'سجل الاستيراد',
    colStatus: 'الحالة',
    colCreated: 'تاريخ الإنشاء',
    colFile: 'الملف',
    colRows: 'الصفوف',
    colUploader: 'رفعه',
    colReviewer: 'راجعه',
    colPublished: 'تاريخ النشر',
    colActions: 'الإجراءات',
    statusLabels: {
      uploaded: 'تم الرفع',
      previewed: 'بانتظار المراجعة',
      quarantined: 'قيد الحجر',
      approved: 'تمت الموافقة',
      rejected: 'مرفوض',
      published: 'منشور',
      failed: 'فشل',
    },
    emptyHistoryTitle: 'لا توجد عمليات استيراد بعد',
    emptyHistorySubtitle: 'ارفع ملف CSV أعلاه لبدء مسار المراجعة.',
    marketDataOpsLink: 'عمليات بيانات السوق',
    dash: '—',
    publishedResult: (rows: number) => `تم نشر ${rows} صف. أعد تحميل الصفحة لتحديث القائمة.`,
  },
} as const;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function localeTag(locale: Locale) {
  return locale === 'ar' ? 'ar-MA' : locale === 'fr' ? 'fr-MA' : 'en-MA';
}

function filenameFromObjectPath(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1] || path;
}

export function AdminCsvImports({
  locale,
  currentUserId,
  runs,
}: {
  locale: Locale;
  currentUserId: string;
  runs: CsvImportRun[];
}) {
  const t = copy[locale];
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [dateCol, setDateCol] = useState('time');
  const [tickerCol, setTickerCol] = useState('symbol');
  const [closeCol, setCloseCol] = useState('close');
  const [phase, setPhase] = useState<Phase>('idle');
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [publishResult, setPublishResult] = useState('');

  const pickFile = (picked: File | null | undefined) => {
    if (!picked) return;
    setFile(picked);
    setPreview(null);
    setPhase('idle');
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragOver(false);
    pickFile(event.dataTransfer.files?.[0]);
  };

  const submit = async () => {
    if (!file || phase === 'uploading') return;
    setPhase('uploading');
    const formData = new FormData();
    formData.set('file', file);
    formData.set('date', dateCol);
    formData.set('ticker', tickerCol);
    formData.set('close', closeCol);
    try {
      const response = await fetch('/api/admin/imports/preview', { method: 'POST', body: formData });
      const body = (await response.json()) as PreviewResponse;
      setPreview(body);
      setPhase(response.ok ? 'valid' : 'invalid');
    } catch {
      setPreview({ error: 'UPLOAD_FAILED' });
      setPhase('invalid');
    }
  };

  const publish = async (id: string, reason: string) => {
    setBusy(true);
    setPublishResult('');
    try {
      const response = await fetch(`/api/admin/imports/${id}/publish`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      const body = (await response.json()) as { publishedRows?: number; error?: string };
      setPublishResult(response.ok ? t.publishedResult(body.publishedRows ?? 0) : String(body.error ?? 'Error'));
    } finally {
      setBusy(false);
    }
  };

  const previewSummary = useMemo(() => {
    if (!preview?.candidates?.length) return null;
    const tickers = [...new Set(preview.candidates.map((c) => c.ticker))].sort();
    const dates = preview.candidates.map((c) => c.marketDate).sort();
    return {
      rowCount: preview.candidates.length,
      tickers,
      startDate: dates[0],
      endDate: dates[dates.length - 1],
    };
  }, [preview]);

  // lastCompleted = index of the last fully-completed step (-1 = none yet). failedIndex marks a
  // terminal failure at that step instead of a completion.
  const lastCompleted =
    phase === 'valid' && preview?.publicationStatus === 'awaiting_second_admin' ? 1 : -1;
  const failedIndex = phase === 'invalid' ? 1 : null;

  return (
    <div className="csv-import-page">
      <section className="card csv-upload-card">
        <div className="csv-upload-card-head">
          <h2>{t.uploadTitle}</h2>
          <a className="csv-market-data-link" href={`/${locale}/admin/market-data`}>
            {t.marketDataOpsLink} →
          </a>
        </div>
        <div
          className={`csv-dropzone${dragOver ? ' is-dragover' : ''}${file ? ' has-file' : ''}`}
          onDragOver={(event) => {
            event.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') fileInputRef.current?.click();
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="csv-dropzone-input"
            onChange={(event) => pickFile(event.target.files?.[0])}
          />
          {file ? (
            <div className="csv-dropzone-file">
              <strong className="technical" dir="ltr">
                {file.name}
              </strong>
              <span className="technical" dir="ltr">
                {formatBytes(file.size)}
              </span>
              <button
                type="button"
                className="advanced-toggle"
                onClick={(event) => {
                  event.stopPropagation();
                  fileInputRef.current?.click();
                }}
              >
                {t.changeFile}
              </button>
            </div>
          ) : (
            <>
              <strong>{t.dropHint}</strong>
              <span>{t.orText}</span>
              <span className="button compact secondary">{t.chooseFile}</span>
            </>
          )}
        </div>

        <button type="button" className="advanced-toggle" onClick={() => setAdvancedOpen((v) => !v)}>
          {t.advancedMapping}
        </button>
        {advancedOpen ? (
          <div className="csv-mapping-grid">
            <label>
              {t.dateColumn}
              <input
                className="technical"
                dir="ltr"
                value={dateCol}
                onChange={(event) => setDateCol(event.target.value)}
              />
            </label>
            <label>
              {t.tickerColumn}
              <input
                className="technical"
                dir="ltr"
                value={tickerCol}
                onChange={(event) => setTickerCol(event.target.value)}
              />
            </label>
            <label>
              {t.closeColumn}
              <input
                className="technical"
                dir="ltr"
                value={closeCol}
                onChange={(event) => setCloseCol(event.target.value)}
              />
            </label>
          </div>
        ) : null}

        <button className="button" disabled={!file || phase === 'uploading'} onClick={() => void submit()}>
          {phase === 'uploading' ? t.uploading : t.upload}
        </button>

        {phase !== 'idle' ? (
          <WorkflowStatus t={t} lastCompleted={lastCompleted} failedIndex={failedIndex} />
        ) : null}

        {preview ? (
          <ImportPreviewPanel
            t={t}
            locale={locale}
            preview={preview}
            summary={previewSummary}
            currentUserId={currentUserId}
            runs={runs}
            busy={busy}
            onApprove={publish}
          />
        ) : null}
        {publishResult ? (
          <p className="status-message" role="status">
            {publishResult}
          </p>
        ) : null}
      </section>

      <section className="card csv-history-card">
        <h2>{t.historyTitle}</h2>
        {runs.length === 0 ? (
          <div className="empty-panel">
            <strong>{t.emptyHistoryTitle}</strong>
            <span>{t.emptyHistorySubtitle}</span>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="table responsive-table">
              <thead>
                <tr>
                  <th>{t.colStatus}</th>
                  <th>{t.colCreated}</th>
                  <th>{t.colFile}</th>
                  <th data-numeric>{t.colRows}</th>
                  <th>{t.colUploader}</th>
                  <th>{t.colReviewer}</th>
                  <th>{t.colPublished}</th>
                  <th>{t.colActions}</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id}>
                    <td data-label={t.colStatus}>
                      <span className={`status-chip is-${statusChipTone(run.status)}`}>
                        {t.statusLabels[run.status as keyof typeof t.statusLabels] ?? run.status}
                      </span>
                      {run.validation_report?.warnings?.length ? (
                        <small className="warning-text">{run.validation_report.warnings.join(' · ')}</small>
                      ) : null}
                    </td>
                    <td data-label={t.colCreated} className="technical" dir="ltr">
                      {new Date(run.created_at).toLocaleString(localeTag(locale))}
                    </td>
                    <td data-label={t.colFile} className="technical" dir="ltr">
                      {filenameFromObjectPath(run.original_object_path)}
                    </td>
                    <td data-label={t.colRows} data-numeric className="technical" dir="ltr">
                      {run.candidate_count}
                    </td>
                    <td data-label={t.colUploader} className="technical" dir="ltr">
                      {run.proposed_by === currentUserId ? t.you : run.proposed_by.slice(0, 8)}
                    </td>
                    <td data-label={t.colReviewer} className="technical" dir="ltr">
                      {run.reviewed_by === null ? t.dash : run.reviewed_by === currentUserId ? t.you : run.reviewed_by.slice(0, 8)}
                    </td>
                    <td data-label={t.colPublished} className="technical" dir="ltr">
                      {run.published_at ? new Date(run.published_at).toLocaleDateString(localeTag(locale)) : t.dash}
                    </td>
                    <td data-label={t.colActions}>
                      {run.status === 'previewed' ? (
                        run.proposed_by === currentUserId ? (
                          <span className="csv-own-upload-note" title={t.ownUploadNotice}>
                            {t.required}: {t.requiredValue}
                          </span>
                        ) : (
                          <Approval disabled={busy} label={t.approve} reasonLabel={t.reason} onApprove={(reason) => publish(run.id, reason)} />
                        )
                      ) : (
                        t.dash
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function statusChipTone(status: string): string {
  if (status === 'published' || status === 'approved') return 'healthy';
  if (status === 'previewed' || status === 'uploaded') return 'running';
  if (status === 'quarantined') return 'stale';
  if (status === 'rejected' || status === 'failed') return 'failed';
  return 'unknown';
}

function WorkflowStatus({
  t,
  lastCompleted,
  failedIndex,
}: {
  t: Copy;
  lastCompleted: number;
  failedIndex: number | null;
}) {
  const steps = [t.stepUploaded, t.stepValidated, t.stepAwaitingReview, t.stepPublished];
  return (
    <ol className="csv-workflow-steps" aria-label={t.historyTitle}>
      {steps.map((label, index) => {
        const isFailed = failedIndex === index;
        const isDone = !isFailed && failedIndex === null && index <= lastCompleted;
        const isCurrent = !isFailed && failedIndex === null && index === lastCompleted + 1;
        return (
          <li key={label} className={isFailed ? 'is-failed' : isDone ? 'is-done' : isCurrent ? 'is-current' : ''}>
            {isFailed ? t.stepRejected : label}
          </li>
        );
      })}
    </ol>
  );
}

function ImportPreviewPanel({
  t,
  locale,
  preview,
  summary,
  currentUserId,
  runs,
  busy,
  onApprove,
}: {
  t: Copy;
  locale: Locale;
  preview: PreviewResponse;
  summary: { rowCount: number; tickers: string[]; startDate: string | undefined; endDate: string | undefined } | null;
  currentUserId: string;
  runs: CsvImportRun[];
  busy: boolean;
  onApprove: (id: string, reason: string) => Promise<void>;
}) {
  const matchedRun = preview.ingestionRunId ? runs.find((r) => r.id === preview.ingestionRunId) : undefined;
  return (
    <div className="csv-preview-panel" role="status">
      <h3>{t.previewTitle}</h3>
      <dl className="summary-grid">
        {preview.originalFileName ? (
          <div>
            <dt>{t.file}</dt>
            <dd className="technical" dir="ltr">
              {preview.originalFileName}
            </dd>
          </div>
        ) : null}
        <div>
          <dt>{t.createdBy}</dt>
          <dd>{t.you}</dd>
        </div>
        {summary ? (
          <div>
            <dt>{t.rows}</dt>
            <dd className="technical" dir="ltr">
              {summary.rowCount}
            </dd>
          </div>
        ) : null}
        {summary ? (
          <div>
            <dt>{t.dateRange}</dt>
            <dd className="technical" dir="ltr">
              {summary.startDate} – {summary.endDate}
            </dd>
          </div>
        ) : null}
        {preview.sourceHash ? (
          <div>
            <dt>{t.hash}</dt>
            <dd className="technical" dir="ltr">
              {preview.sourceHash.slice(0, 16)}…
            </dd>
          </div>
        ) : null}
      </dl>
      {summary?.tickers.length ? (
        <p className="csv-tickers-list">
          <span>{t.tickers}: </span>
          <span className="technical" dir="ltr">
            {summary.tickers.join(', ')}
          </span>
        </p>
      ) : null}
      {preview.errors?.length ? (
        <div>
          <strong>{t.errors}</strong>
          <ul className="error-list">
            {preview.errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {preview.warnings?.length ? (
        <div>
          <strong>{t.warnings}</strong>
          <ul className="warning-list">
            {preview.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {preview.error ? <p className="error-list">{preview.error}</p> : null}
      {preview.publicationStatus === 'awaiting_second_admin' ? (
        <div className="csv-two-admin-panel">
          <strong>{t.reviewTitle}</strong>
          <p>
            {t.uploadedBy}: {t.you} · {t.required}: <span dir={locale === 'ar' ? 'rtl' : 'ltr'}>{t.requiredValue}</span>
          </p>
          <p className="microcopy">{t.ownUploadNotice}</p>
          {matchedRun && matchedRun.proposed_by !== currentUserId ? (
            <Approval disabled={busy} label={t.approve} reasonLabel={t.reason} onApprove={(reason) => onApprove(matchedRun.id, reason)} />
          ) : null}
        </div>
      ) : null}
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
      <input aria-label={reasonLabel} value={reason} onChange={(event) => setReason(event.target.value)} />
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
