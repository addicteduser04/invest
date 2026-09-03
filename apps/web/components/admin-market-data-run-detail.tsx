'use client';

import { useEffect, useState } from 'react';
import type { Locale } from '@bvc/contracts';
import { formatDuration, normalizeRun, type UiRun } from '@/lib/market-data-ui';

const POLL_INTERVAL_MS = 4000;

interface Props {
  locale: Locale;
  runId: string;
  initialRun: Record<string, unknown> | null;
}

const copy = {
  en: {
    notFoundTitle: 'Run not found',
    notFoundSubtitle: 'This ingestion run does not exist or is not visible to your account.',
    status: 'Status',
    marketDate: 'Market date',
    provider: 'Provider',
    triggerSource: 'Triggered by',
    started: 'Started',
    finished: 'Finished',
    duration: 'Duration',
    metricsTitle: 'Metrics',
    securities: 'Securities',
    indices: 'Indices',
    rowsReceived: 'Rows received',
    rowsAccepted: 'Rows accepted',
    rowsRejected: 'Rows rejected',
    rowsPublished: 'Rows published',
    retryCount: 'Retry count',
    failuresTitle: 'Failed instruments',
    noFailures: 'No instrument failures recorded for this run.',
    colTicker: 'Ticker',
    colStage: 'Stage',
    colDateRange: 'Date / range',
    colErrorCode: 'Error code',
    colMessage: 'Readable error',
    colAttempts: 'Attempts',
    attemptsSuffix: 'attempts',
    retryButton: 'Retry failed instruments',
    retryConfirmTitle: 'Retry failed instruments',
    retryConfirmBody: (count: number) =>
      `This will retry ${count} previously failed instrument${count === 1 ? '' : 's'}. Successful instruments will not be touched.`,
    cancelButton: 'Cancel',
    confirmRetryButton: 'Retry now',
    retryStarted: 'Retry started. A new run has been created.',
    viewRetryRun: 'View retry run',
    genericError: 'Something went wrong. Please try again.',
    triggerLabels: { schedule: 'schedule', manual: 'manual', retry: 'retry', cli: 'CLI' },
    statusLabels: {
      running: 'Running',
      succeeded: 'Succeeded',
      partial: 'Partial',
      failed: 'Failed',
    },
    stageLabels: {
      security_master: 'Security master',
      index_master: 'Index master',
      index_history: 'Index history',
      ohlcv: 'OHLCV',
    },
    dash: '—',
  },
  fr: {
    notFoundTitle: 'Exécution introuvable',
    notFoundSubtitle:
      'Cette exécution d’ingestion n’existe pas ou n’est pas visible pour votre compte.',
    status: 'Statut',
    marketDate: 'Date de marché',
    provider: 'Fournisseur',
    triggerSource: 'Déclenché par',
    started: 'Démarré',
    finished: 'Terminé',
    duration: 'Durée',
    metricsTitle: 'Métriques',
    securities: 'Valeurs',
    indices: 'Indices',
    rowsReceived: 'Lignes reçues',
    rowsAccepted: 'Lignes acceptées',
    rowsRejected: 'Lignes rejetées',
    rowsPublished: 'Lignes publiées',
    retryCount: 'Nombre de relances',
    failuresTitle: 'Instruments en échec',
    noFailures: 'Aucun échec d’instrument enregistré pour cette exécution.',
    colTicker: 'Ticker',
    colStage: 'Étape',
    colDateRange: 'Date / plage',
    colErrorCode: 'Code d’erreur',
    colMessage: 'Erreur lisible',
    colAttempts: 'Tentatives',
    attemptsSuffix: 'tentatives',
    retryButton: 'Relancer les instruments en échec',
    retryConfirmTitle: 'Relancer les instruments en échec',
    retryConfirmBody: (count: number) =>
      `Ceci relancera ${count} instrument${count === 1 ? '' : 's'} précédemment en échec. Les instruments réussis ne seront pas modifiés.`,
    cancelButton: 'Annuler',
    confirmRetryButton: 'Relancer maintenant',
    retryStarted: 'Relance démarrée. Une nouvelle exécution a été créée.',
    viewRetryRun: 'Voir l’exécution de relance',
    genericError: 'Une erreur est survenue. Veuillez réessayer.',
    triggerLabels: { schedule: 'planification', manual: 'manuel', retry: 'relance', cli: 'CLI' },
    statusLabels: { running: 'En cours', succeeded: 'Réussi', partial: 'Partiel', failed: 'Échec' },
    stageLabels: {
      security_master: 'Référentiel titres',
      index_master: 'Référentiel indices',
      index_history: 'Historique indices',
      ohlcv: 'OHLCV',
    },
    dash: '—',
  },
  ar: {
    notFoundTitle: 'التشغيل غير موجود',
    notFoundSubtitle: 'عملية الاستيراد هذه غير موجودة أو غير مرئية لحسابك.',
    status: 'الحالة',
    marketDate: 'تاريخ السوق',
    provider: 'المزوّد',
    triggerSource: 'المُشغِّل',
    started: 'البدء',
    finished: 'الانتهاء',
    duration: 'المدة',
    metricsTitle: 'المقاييس',
    securities: 'الأوراق المالية',
    indices: 'المؤشرات',
    rowsReceived: 'الصفوف المستلمة',
    rowsAccepted: 'الصفوف المقبولة',
    rowsRejected: 'الصفوف المرفوضة',
    rowsPublished: 'الصفوف المنشورة',
    retryCount: 'عدد إعادة المحاولات',
    failuresTitle: 'الأدوات الفاشلة',
    noFailures: 'لم يتم تسجيل أي إخفاقات لهذا التشغيل.',
    colTicker: 'الرمز',
    colStage: 'المرحلة',
    colDateRange: 'التاريخ / النطاق',
    colErrorCode: 'رمز الخطأ',
    colMessage: 'الخطأ المقروء',
    colAttempts: 'المحاولات',
    attemptsSuffix: 'محاولات',
    retryButton: 'إعادة محاولة الأدوات الفاشلة',
    retryConfirmTitle: 'إعادة محاولة الأدوات الفاشلة',
    retryConfirmBody: (count: number) =>
      `سيؤدي هذا إلى إعادة محاولة ${count} أداة فشلت سابقاً. لن يتم المساس بالأدوات الناجحة.`,
    cancelButton: 'إلغاء',
    confirmRetryButton: 'إعادة المحاولة الآن',
    retryStarted: 'بدأت إعادة المحاولة. تم إنشاء تشغيل جديد.',
    viewRetryRun: 'عرض تشغيل إعادة المحاولة',
    genericError: 'حدث خطأ ما. يرجى المحاولة مرة أخرى.',
    triggerLabels: { schedule: 'جدولة', manual: 'يدوي', retry: 'إعادة محاولة', cli: 'CLI' },
    statusLabels: { running: 'قيد التشغيل', succeeded: 'نجح', partial: 'جزئي', failed: 'فشل' },
    stageLabels: {
      security_master: 'مرجع الأوراق المالية',
      index_master: 'مرجع المؤشرات',
      index_history: 'سجل المؤشرات',
      ohlcv: 'OHLCV',
    },
    dash: '—',
  },
} as const;

function formatDateTime(iso: string | null, localeTag: string) {
  if (!iso) return null;
  return new Date(iso).toLocaleString(localeTag, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function AdminMarketDataRunDetail({ locale, runId, initialRun }: Props) {
  const t = copy[locale];
  const localeTag = locale === 'ar' ? 'ar-MA' : locale === 'fr' ? 'fr-MA' : 'en-MA';

  const [run, setRun] = useState<UiRun | null>(initialRun ? normalizeRun(initialRun) : null);
  const [retryPanelOpen, setRetryPanelOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [retryRunId, setRetryRunId] = useState<string | null>(null);

  useEffect(() => {
    if (!run || run.status !== 'running') return;
    let cancelled = false;
    const poll = async () => {
      const response = await fetch(`/api/admin/market-data/runs/${runId}`);
      if (!response.ok || cancelled) return;
      const body = await response.json();
      setRun(normalizeRun(body.run as Record<string, unknown>));
    };
    const interval = setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [run, runId]);

  if (!run) {
    return (
      <div className="card empty-panel">
        <strong>{t.notFoundTitle}</strong>
        <span>{t.notFoundSubtitle}</span>
      </div>
    );
  }

  const retryEligible =
    (run.status === 'partial' || run.status === 'failed') && run.instrumentFailures.length > 0;

  const confirmRetry = async () => {
    setBusy(true);
    setErrorMessage(null);
    try {
      const response = await fetch(`/api/admin/market-data/runs/${runId}/retry`, {
        method: 'POST',
      });
      const body = await response.json();
      if (!response.ok) {
        setErrorMessage(String(body.error ?? t.genericError));
        return;
      }
      setRetryPanelOpen(false);
      setMessage(t.retryStarted);
      if (body.runId) setRetryRunId(String(body.runId));
    } catch {
      setErrorMessage(t.genericError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dashboard-grid">
      <section className="card span-2">
        <div className="run-panel-trigger">
          <span className={`status-chip is-${run.status}`}>
            {t.statusLabels[run.status] ?? run.status}
          </span>
          {retryEligible ? (
            <button
              type="button"
              className="button"
              onClick={() => setRetryPanelOpen((value) => !value)}
            >
              {t.retryButton}
            </button>
          ) : null}
        </div>
        <dl className="health-metrics">
          <div>
            <dt>{t.marketDate}</dt>
            <dd dir="ltr">{run.marketDate ?? t.dash}</dd>
          </div>
          <div>
            <dt>{t.provider}</dt>
            <dd dir="ltr">{run.providerId}</dd>
          </div>
          <div>
            <dt>{t.triggerSource}</dt>
            <dd>
              {t.triggerLabels[run.triggerSource as keyof typeof t.triggerLabels] ??
                run.triggerSource}
            </dd>
          </div>
          <div>
            <dt>{t.started}</dt>
            <dd dir="ltr">{formatDateTime(run.startedAt, localeTag) ?? t.dash}</dd>
          </div>
          <div>
            <dt>{t.finished}</dt>
            <dd dir="ltr">{formatDateTime(run.finishedAt, localeTag) ?? t.dash}</dd>
          </div>
          <div>
            <dt>{t.duration}</dt>
            <dd dir="ltr">{formatDuration(run.startedAt, run.finishedAt)}</dd>
          </div>
        </dl>

        {retryPanelOpen ? (
          <div className="run-control-panel">
            <h3 className="microcopy">{t.retryConfirmTitle}</h3>
            <p>{t.retryConfirmBody(run.instrumentFailures.length)}</p>
            <div className="run-control-actions">
              <button
                type="button"
                className="button secondary"
                onClick={() => setRetryPanelOpen(false)}
              >
                {t.cancelButton}
              </button>
              <button
                type="button"
                className="button"
                disabled={busy}
                onClick={() => void confirmRetry()}
              >
                {t.confirmRetryButton}
              </button>
            </div>
          </div>
        ) : null}

        {message ? (
          <p className="status-message" role="status">
            {message}{' '}
            {retryRunId ? (
              <a href={`/${locale}/admin/market-data/runs/${retryRunId}`}>{t.viewRetryRun}</a>
            ) : null}
          </p>
        ) : null}
        {errorMessage ? <p className="error-list">{errorMessage}</p> : null}
      </section>

      <section className="card span-2">
        <div className="section-heading">
          <h2>{t.metricsTitle}</h2>
        </div>
        <dl className="health-metrics">
          <div>
            <dt>{t.securities}</dt>
            <dd dir="ltr">
              {run.metrics.securitiesSucceeded}/{run.metrics.securitiesExpected}
            </dd>
          </div>
          <div>
            <dt>{t.indices}</dt>
            <dd dir="ltr">
              {run.metrics.indicesSucceeded}/{run.metrics.indicesExpected}
            </dd>
          </div>
          <div>
            <dt>{t.rowsReceived}</dt>
            <dd dir="ltr">{run.metrics.rowsReceived}</dd>
          </div>
          <div>
            <dt>{t.rowsAccepted}</dt>
            <dd dir="ltr">{run.metrics.rowsAccepted}</dd>
          </div>
          <div>
            <dt>{t.rowsRejected}</dt>
            <dd dir="ltr" className={run.metrics.rowsRejected > 0 ? 'error-text' : undefined}>
              {run.metrics.rowsRejected}
            </dd>
          </div>
          <div>
            <dt>{t.rowsPublished}</dt>
            <dd dir="ltr">{run.metrics.rowsPublished}</dd>
          </div>
          <div>
            <dt>{t.retryCount}</dt>
            <dd dir="ltr">{run.metrics.retryCount}</dd>
          </div>
        </dl>
      </section>

      <section className="card span-2">
        <div className="section-heading">
          <h2>{t.failuresTitle}</h2>
        </div>
        {run.instrumentFailures.length === 0 ? (
          <div className="empty-panel">
            <strong>{t.noFailures}</strong>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="table responsive-table">
              <thead>
                <tr>
                  <th>{t.colTicker}</th>
                  <th>{t.colStage}</th>
                  <th>{t.colDateRange}</th>
                  <th>{t.colErrorCode}</th>
                  <th>{t.colMessage}</th>
                  <th>{t.colAttempts}</th>
                </tr>
              </thead>
              <tbody>
                {run.instrumentFailures.map((failure, index) => (
                  <tr key={`${failure.ticker}-${index}`}>
                    <td data-label={t.colTicker} className="technical" dir="ltr">
                      {failure.ticker}
                    </td>
                    <td data-label={t.colStage}>{t.stageLabels[failure.stage] ?? failure.stage}</td>
                    <td data-label={t.colDateRange} dir="ltr">
                      {failure.dateOrRange}
                    </td>
                    <td data-label={t.colErrorCode} className="failure-code" dir="ltr">
                      {failure.errorCode}
                    </td>
                    <td data-label={t.colMessage}>{failure.message}</td>
                    <td data-label={t.colAttempts}>
                      {failure.attempts} {t.attemptsSuffix}
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
