'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { Locale } from '@bvc/contracts';
import {
  computeCoverageStatus,
  computeFreshness,
  computeHealthStatus,
  formatDuration,
  normalizeRun,
  type CoverageStatus,
  type OperationalSnapshot,
  type UiRun,
} from '@/lib/market-data-ui';

const CONFIGURED_SCHEDULE_TIME = '18:05';
const CONFIGURED_SCHEDULE_TZ = 'Africa/Casablanca';
const POLL_INTERVAL_MS = 4000;
type MessageTone = 'info' | 'success' | 'warning';

interface Props {
  locale: Locale;
  initialSnapshot: Record<string, unknown> | null;
  initialRuns: Record<string, unknown>[];
  provider: { id: string | null; error: string | null };
}

const copy = {
  en: {
    eyebrow: 'Market data',
    healthLabels: {
      healthy: 'Healthy',
      stale: 'Stale',
      running: 'Running',
      partial: 'Partial',
      failed: 'Failed',
      no_data: 'No previous runs',
    },
    runStatusLabels: {
      running: 'Running',
      succeeded: 'Succeeded',
      partial: 'Partial',
      failed: 'Failed',
    },
    latestEquitySession: 'Latest equity session',
    latestIndexSession: 'Latest MASI session',
    lastSuccessfulIngestion: 'Last successful ingestion',
    provider: 'Provider',
    providerUnavailable: 'Not configured',
    providerLabels: {
      bvc_public_testing: 'BVC public testing',
      licensed_api: 'Licensed API',
      licensed_sftp: 'Licensed SFTP feed',
    },
    coverage: 'Session coverage',
    failures: 'Failures',
    equityFailures: 'Equities failed',
    indexFailures: 'Indices failed',
    nextRefresh: 'Next expected refresh',
    runImportButton: 'Run market import',
    panelTitle: 'Run daily market import',
    dateLabel: 'Date',
    scopeLabel: 'Scope',
    scopeAll: 'All active securities',
    scopeSelected: 'Selected tickers',
    tickersPlaceholder: 'IAM, ATW, BCP',
    dryRunLabel: 'Dry run — fetch and validate only, nothing published',
    advancedToggle: 'Advanced options',
    concurrencyLabel: 'Concurrency',
    cancelButton: 'Cancel',
    confirmButton: 'Run import',
    runStartedMessage: 'Import started. Tracking live progress below.',
    runSucceededMessage: 'Import completed successfully.',
    runPartialMessage: 'Import completed with some failures. Review the details below.',
    runFailedMessage: 'The import failed. Review the failures and retry if needed.',
    viewRunDetails: 'View run details',
    dryRunPrefix: 'Dry run complete',
    genericError: 'Something went wrong. Please try again.',
    runningLabel: 'RUNNING',
    equitiesProcessed: 'equities processed',
    indicesLabel: 'Indices',
    publishedRowsLabel: 'Published rows',
    elapsedLabel: 'Elapsed',
    recentRunsTitle: 'Recent runs',
    noRunsTitle: 'No ingestion runs yet',
    noRunsSubtitle: 'Run the daily import above, or wait for the next scheduled run.',
    colStatus: 'Status',
    colDate: 'Market date',
    colProvider: 'Provider',
    colStarted: 'Started',
    colDuration: 'Duration',
    colEquities: 'Equities',
    colIndices: 'Indices',
    colPublished: 'Published',
    colFailures: 'Failures',
    colTrigger: 'Triggered by',
    triggerLabels: { schedule: 'schedule', manual: 'manual', retry: 'retry', cli: 'CLI' },
    coverageTitle: 'Data coverage',
    coverageSearchPlaceholder: 'Search ticker or company',
    coverageFilterAll: 'All statuses',
    coverageStatusLabels: {
      current: 'Current',
      stale: 'Stale',
      no_history: 'No price history',
      failed_last_run: 'Failed last run',
    },
    coverageSortTicker: 'Sort: ticker',
    coverageSortDate: 'Sort: latest date',
    coverageColTicker: 'Ticker',
    coverageColName: 'Company',
    coverageColLatestDate: 'Latest date',
    coverageColStatus: 'Status',
    coverageEmptyTitle: 'No securities match',
    coverageEmptySubtitle: 'Try a different search term or status filter.',
    indexHealthTitle: 'Index health',
    indexNoData: 'No index data yet',
    latestDate: 'Latest date',
    latestValue: 'Latest value',
    freshnessLabels: { current: 'Current', stale: 'Stale', no_data: 'No data' },
    providerUnavailableTitle: 'Provider unavailable',
    dash: '—',
  },
  fr: {
    eyebrow: 'Données de marché',
    healthLabels: {
      healthy: 'Sain',
      stale: 'Périmé',
      running: 'En cours',
      partial: 'Partiel',
      failed: 'Échec',
      no_data: 'Aucune exécution',
    },
    runStatusLabels: {
      running: 'En cours',
      succeeded: 'Réussi',
      partial: 'Partiel',
      failed: 'Échec',
    },
    latestEquitySession: 'Dernière séance actions',
    latestIndexSession: 'Dernière séance MASI',
    lastSuccessfulIngestion: 'Dernière ingestion réussie',
    provider: 'Fournisseur',
    providerUnavailable: 'Non configuré',
    providerLabels: {
      bvc_public_testing: 'Test public BVC',
      licensed_api: 'API sous licence',
      licensed_sftp: 'Flux SFTP sous licence',
    },
    coverage: 'Couverture de la séance',
    failures: 'Échecs',
    equityFailures: 'Actions en échec',
    indexFailures: 'Indices en échec',
    nextRefresh: 'Prochaine actualisation prévue',
    runImportButton: 'Lancer un import de marché',
    panelTitle: 'Lancer l’import quotidien de marché',
    dateLabel: 'Date',
    scopeLabel: 'Périmètre',
    scopeAll: 'Toutes les valeurs actives',
    scopeSelected: 'Tickers sélectionnés',
    tickersPlaceholder: 'IAM, ATW, BCP',
    dryRunLabel: 'Simulation — récupération et validation uniquement, rien n’est publié',
    advancedToggle: 'Options avancées',
    concurrencyLabel: 'Concurrence',
    cancelButton: 'Annuler',
    confirmButton: 'Lancer l’import',
    runStartedMessage: 'Import démarré. Suivez la progression en direct ci-dessous.',
    runSucceededMessage: 'Import terminé avec succès.',
    runPartialMessage: 'Import terminé avec certains échecs. Consultez le détail ci-dessous.',
    runFailedMessage: 'L’import a échoué. Consultez les échecs et relancez si nécessaire.',
    viewRunDetails: 'Voir les détails de l’exécution',
    dryRunPrefix: 'Simulation terminée',
    genericError: 'Une erreur est survenue. Veuillez réessayer.',
    runningLabel: 'EN COURS',
    equitiesProcessed: 'valeurs traitées',
    indicesLabel: 'Indices',
    publishedRowsLabel: 'Lignes publiées',
    elapsedLabel: 'Écoulé',
    recentRunsTitle: 'Exécutions récentes',
    noRunsTitle: 'Aucune exécution d’ingestion pour le moment',
    noRunsSubtitle:
      'Lancez l’import quotidien ci-dessus, ou attendez la prochaine exécution planifiée.',
    colStatus: 'Statut',
    colDate: 'Date de marché',
    colProvider: 'Fournisseur',
    colStarted: 'Démarré',
    colDuration: 'Durée',
    colEquities: 'Actions',
    colIndices: 'Indices',
    colPublished: 'Publiées',
    colFailures: 'Échecs',
    colTrigger: 'Déclenché par',
    triggerLabels: { schedule: 'planification', manual: 'manuel', retry: 'relance', cli: 'CLI' },
    coverageTitle: 'Couverture des données',
    coverageSearchPlaceholder: 'Rechercher un ticker ou une société',
    coverageFilterAll: 'Tous les statuts',
    coverageStatusLabels: {
      current: 'À jour',
      stale: 'Périmé',
      no_history: 'Aucun historique',
      failed_last_run: 'Échec dernière exécution',
    },
    coverageSortTicker: 'Trier : ticker',
    coverageSortDate: 'Trier : date la plus récente',
    coverageColTicker: 'Ticker',
    coverageColName: 'Société',
    coverageColLatestDate: 'Dernière date',
    coverageColStatus: 'Statut',
    coverageEmptyTitle: 'Aucune valeur ne correspond',
    coverageEmptySubtitle: 'Essayez un autre terme de recherche ou filtre de statut.',
    indexHealthTitle: 'Santé des indices',
    indexNoData: 'Aucune donnée d’indice pour le moment',
    latestDate: 'Dernière date',
    latestValue: 'Dernière valeur',
    freshnessLabels: { current: 'À jour', stale: 'Périmé', no_data: 'Aucune donnée' },
    providerUnavailableTitle: 'Fournisseur indisponible',
    dash: '—',
  },
  ar: {
    eyebrow: 'بيانات السوق',
    healthLabels: {
      healthy: 'سليم',
      stale: 'قديم',
      running: 'قيد التشغيل',
      partial: 'جزئي',
      failed: 'فشل',
      no_data: 'لا توجد عمليات سابقة',
    },
    runStatusLabels: { running: 'قيد التشغيل', succeeded: 'نجح', partial: 'جزئي', failed: 'فشل' },
    latestEquitySession: 'آخر جلسة أسهم',
    latestIndexSession: 'آخر جلسة MASI',
    lastSuccessfulIngestion: 'آخر استيراد ناجح',
    provider: 'المزوّد',
    providerUnavailable: 'غير مُهيأ',
    providerLabels: {
      bvc_public_testing: 'اختبار عام BVC',
      licensed_api: 'واجهة برمجة مرخصة',
      licensed_sftp: 'تغذية SFTP مرخصة',
    },
    coverage: 'تغطية الجلسة',
    failures: 'الإخفاقات',
    equityFailures: 'أسهم فاشلة',
    indexFailures: 'مؤشرات فاشلة',
    nextRefresh: 'التحديث المتوقع التالي',
    runImportButton: 'تشغيل استيراد بيانات السوق',
    panelTitle: 'تشغيل الاستيراد اليومي لبيانات السوق',
    dateLabel: 'التاريخ',
    scopeLabel: 'النطاق',
    scopeAll: 'جميع الأوراق المالية النشطة',
    scopeSelected: 'رموز محددة',
    tickersPlaceholder: 'IAM, ATW, BCP',
    dryRunLabel: 'تجربة — جلب وتحقق فقط، دون نشر',
    advancedToggle: 'خيارات متقدمة',
    concurrencyLabel: 'التزامن',
    cancelButton: 'إلغاء',
    confirmButton: 'تشغيل الاستيراد',
    runStartedMessage: 'بدأ الاستيراد. تابع التقدم المباشر أدناه.',
    runSucceededMessage: 'اكتمل الاستيراد بنجاح.',
    runPartialMessage: 'اكتمل الاستيراد مع بعض الإخفاقات. راجع التفاصيل أدناه.',
    runFailedMessage: 'فشل الاستيراد. راجع الإخفاقات وأعد المحاولة إذا لزم الأمر.',
    viewRunDetails: 'عرض تفاصيل التشغيل',
    dryRunPrefix: 'اكتملت التجربة',
    genericError: 'حدث خطأ ما. يرجى المحاولة مرة أخرى.',
    runningLabel: 'قيد التشغيل',
    equitiesProcessed: 'سهماً تمت معالجتها',
    indicesLabel: 'المؤشرات',
    publishedRowsLabel: 'الصفوف المنشورة',
    elapsedLabel: 'الوقت المنقضي',
    recentRunsTitle: 'العمليات الأخيرة',
    noRunsTitle: 'لا توجد عمليات استيراد بعد',
    noRunsSubtitle: 'شغّل الاستيراد اليومي أعلاه، أو انتظر التشغيل المجدول التالي.',
    colStatus: 'الحالة',
    colDate: 'تاريخ السوق',
    colProvider: 'المزوّد',
    colStarted: 'البدء',
    colDuration: 'المدة',
    colEquities: 'الأسهم',
    colIndices: 'المؤشرات',
    colPublished: 'المنشورة',
    colFailures: 'الإخفاقات',
    colTrigger: 'المُشغِّل',
    triggerLabels: { schedule: 'جدولة', manual: 'يدوي', retry: 'إعادة محاولة', cli: 'CLI' },
    coverageTitle: 'تغطية البيانات',
    coverageSearchPlaceholder: 'ابحث عن رمز أو شركة',
    coverageFilterAll: 'جميع الحالات',
    coverageStatusLabels: {
      current: 'محدّث',
      stale: 'قديم',
      no_history: 'لا يوجد سجل أسعار',
      failed_last_run: 'فشل آخر تشغيل',
    },
    coverageSortTicker: 'ترتيب: الرمز',
    coverageSortDate: 'ترتيب: أحدث تاريخ',
    coverageColTicker: 'الرمز',
    coverageColName: 'الشركة',
    coverageColLatestDate: 'أحدث تاريخ',
    coverageColStatus: 'الحالة',
    coverageEmptyTitle: 'لا توجد أوراق مالية مطابقة',
    coverageEmptySubtitle: 'جرّب كلمة بحث أو مرشح حالة مختلفاً.',
    indexHealthTitle: 'صحة المؤشرات',
    indexNoData: 'لا توجد بيانات مؤشر بعد',
    latestDate: 'أحدث تاريخ',
    latestValue: 'أحدث قيمة',
    freshnessLabels: { current: 'محدّث', stale: 'قديم', no_data: 'لا توجد بيانات' },
    providerUnavailableTitle: 'المزوّد غير متاح',
    dash: '—',
  },
} as const;

function todayIso() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Casablanca' }).format(new Date());
}

function formatDateTime(iso: string | null, localeTag: string) {
  if (!iso) return null;
  return new Date(iso).toLocaleString(localeTag, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatTime(iso: string, localeTag: string) {
  return new Date(iso).toLocaleTimeString(localeTag, { hour: '2-digit', minute: '2-digit' });
}

export function AdminMarketData({ locale, initialSnapshot, initialRuns, provider }: Props) {
  const t = copy[locale];
  const router = useRouter();
  const localeTag = locale === 'ar' ? 'ar-MA' : locale === 'fr' ? 'fr-MA' : 'en-MA';

  const [snapshot, setSnapshot] = useState<OperationalSnapshot | null>(
    initialSnapshot as OperationalSnapshot | null,
  );
  const [runs, setRuns] = useState<UiRun[]>(initialRuns.map(normalizeRun));
  const initialLastRun = (initialSnapshot?.['lastRun'] ?? null) as Record<string, unknown> | null;
  const [activeRunId, setActiveRunId] = useState<string | null>(
    initialLastRun && initialLastRun['status'] === 'running' ? String(initialLastRun['id']) : null,
  );
  const [liveRun, setLiveRun] = useState<UiRun | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [scope, setScope] = useState<'all' | 'selected'>('all');
  const [tickersText, setTickersText] = useState('');
  const [dryRun, setDryRun] = useState(false);
  const [concurrency, setConcurrency] = useState(2);
  const [date, setDate] = useState(todayIso);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<MessageTone>('info');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [terminalRunId, setTerminalRunId] = useState<string | null>(null);

  const [coverageSearch, setCoverageSearch] = useState('');
  const [coverageFilter, setCoverageFilter] = useState<'all' | CoverageStatus>('all');
  const [coverageSort, setCoverageSort] = useState<'ticker' | 'date'>('ticker');

  const refresh = useCallback(async () => {
    const response = await fetch('/api/admin/market-data');
    if (!response.ok) return;
    const body = await response.json();
    setSnapshot(body.snapshot ?? null);
    setRuns(((body.runs ?? []) as Record<string, unknown>[]).map(normalizeRun));
  }, []);

  const pollGuard = useRef<string | null>(null);
  useEffect(() => {
    if (!activeRunId) return;
    pollGuard.current = activeRunId;
    let cancelled = false;

    const poll = async () => {
      const response = await fetch(`/api/admin/market-data/runs/${activeRunId}`);
      if (!response.ok || cancelled || pollGuard.current !== activeRunId) return;
      const body = await response.json();
      const run = normalizeRun(body.run as Record<string, unknown>);
      setLiveRun(run);
      if (run.status !== 'running') {
        setActiveRunId(null);
        // The "import started" banner must not linger once the run reaches a terminal state --
        // replace it with an outcome-specific message instead of leaving the started/-progress
        // text visible after the run has actually succeeded, partially failed, or failed.
        if (run.status === 'succeeded') {
          setMessage(t.runSucceededMessage);
          setMessageTone('success');
          setErrorMessage(null);
          setTerminalRunId(null);
        } else if (run.status === 'partial') {
          setMessage(t.runPartialMessage);
          setMessageTone('warning');
          setErrorMessage(null);
          setTerminalRunId(null);
        } else {
          setMessage(null);
          setErrorMessage(t.runFailedMessage);
          setTerminalRunId(run.id);
        }
        void refresh();
      }
    };
    void poll();
    const interval = setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [activeRunId, refresh, t]);

  const health = snapshot ? computeHealthStatus(snapshot) : 'no_data';
  const lastRun = snapshot?.lastRun ?? null;
  // "Last successful ingestion" must reflect a run that actually published something
  // (succeeded or partial), never a fully failed run's finish time.
  const lastSuccessfulRun =
    runs.find((run) => run.status === 'succeeded' || run.status === 'partial') ?? null;

  const submitRun = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setErrorMessage(null);
    setMessage(null);
    setMessageTone('info');
    setTerminalRunId(null);
    try {
      const tickers =
        scope === 'selected'
          ? tickersText
              .split(',')
              .map((value) => value.trim().toUpperCase())
              .filter(Boolean)
          : undefined;
      const response = await fetch('/api/admin/market-data/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          date,
          ...(tickers?.length ? { tickers } : {}),
          dryRun,
          concurrency,
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        setErrorMessage(String(body.error ?? t.genericError));
        return;
      }
      if (body.runId) {
        setActiveRunId(String(body.runId));
        setPanelOpen(false);
        setMessage(t.runStartedMessage);
      } else if (body.summary) {
        const summary = body.summary as {
          metrics: { securitiesSucceeded: number; securitiesExpected: number };
        };
        setMessage(
          `${t.dryRunPrefix}: ${summary.metrics.securitiesSucceeded}/${summary.metrics.securitiesExpected}`,
        );
      }
    } catch {
      setErrorMessage(t.genericError);
    } finally {
      setBusy(false);
    }
  };

  const filteredCoverage = useMemo(() => {
    const rows = snapshot?.coverage ?? [];
    const query = coverageSearch.trim().toLowerCase();
    const filtered = rows.filter((row) => {
      if (
        query &&
        !row.ticker.toLowerCase().includes(query) &&
        !row.name.toLowerCase().includes(query)
      )
        return false;
      if (coverageFilter !== 'all' && computeCoverageStatus(row) !== coverageFilter) return false;
      return true;
    });
    return filtered.slice().sort((a, b) => {
      if (coverageSort === 'ticker') return a.ticker.localeCompare(b.ticker);
      return (b.latestMarketDate ?? '').localeCompare(a.latestMarketDate ?? '');
    });
  }, [snapshot, coverageSearch, coverageFilter, coverageSort]);

  const lastRunMetrics = lastRun?.['metrics'] as
    | { securitiesFailed?: number; indicesFailed?: number }
    | undefined;
  const providerLabel = provider.id
    ? (t.providerLabels[provider.id as keyof typeof t.providerLabels] ?? provider.id)
    : t.providerUnavailable;

  return (
    <div className="market-data-grid">
      <section className="card">
        <div className="run-panel-trigger">
          <div>
            <p className="eyebrow">{t.eyebrow}</p>
            <span className={`status-chip is-${health}`}>{t.healthLabels[health]}</span>
          </div>
          {provider.error ? (
            <span className="microcopy error-text">
              {t.providerUnavailableTitle}: {provider.error}
            </span>
          ) : (
            <button
              type="button"
              className="button"
              onClick={() => setPanelOpen((value) => !value)}
              disabled={Boolean(provider.error)}
            >
              {t.runImportButton}
            </button>
          )}
        </div>

        <dl className="health-metrics">
          <div>
            <dt>{t.latestEquitySession}</dt>
            <dd dir="ltr">{snapshot?.latestEquityDate ?? t.dash}</dd>
          </div>
          <div>
            <dt>{t.latestIndexSession}</dt>
            <dd dir="ltr">{snapshot?.latestIndexDate ?? t.dash}</dd>
          </div>
          <div>
            <dt>{t.lastSuccessfulIngestion}</dt>
            <dd>{formatDateTime(lastSuccessfulRun?.finishedAt ?? null, localeTag) ?? t.dash}</dd>
          </div>
          <div>
            <dt>{t.provider}</dt>
            <dd className="is-technical" dir="ltr">
              {providerLabel}
              {provider.id ? <small dir="ltr">{provider.id}</small> : null}
            </dd>
          </div>
          <div>
            <dt>{t.coverage}</dt>
            <dd className="is-technical" dir="ltr">
              {snapshot
                ? snapshot.coverage.filter((row) => computeCoverageStatus(row) === 'current').length
                : 0}
              {' / '}
              {snapshot?.coverage.length ?? 0}
            </dd>
          </div>
          <div>
            <dt>{t.equityFailures}</dt>
            <dd
              className={lastRunMetrics?.securitiesFailed ? 'is-technical error-text' : 'is-technical'}
              dir="ltr"
            >
              {lastRunMetrics?.securitiesFailed ?? 0}
            </dd>
          </div>
          <div>
            <dt>{t.indexFailures}</dt>
            <dd
              className={lastRunMetrics?.indicesFailed ? 'is-technical error-text' : 'is-technical'}
              dir="ltr"
            >
              {lastRunMetrics?.indicesFailed ?? 0}
            </dd>
          </div>
          <div>
            <dt>{t.nextRefresh}</dt>
            <dd className="is-technical" dir="ltr">
              {CONFIGURED_SCHEDULE_TIME}
              <small dir="ltr">{CONFIGURED_SCHEDULE_TZ}</small>
            </dd>
          </div>
        </dl>

        {panelOpen ? (
          <form className="run-control-panel" onSubmit={(event) => void submitRun(event)}>
            <h3 className="microcopy">{t.panelTitle}</h3>
            <div className="form-grid">
              <label>
                {t.dateLabel}
                <input
                  type="date"
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                  dir="ltr"
                  required
                />
              </label>
              <label>
                {t.provider}
                <input value={provider.id ?? t.providerUnavailable} readOnly dir="ltr" />
              </label>
            </div>
            <div className="radio-row">
              <label>
                <input
                  type="radio"
                  name="scope"
                  checked={scope === 'all'}
                  onChange={() => setScope('all')}
                />
                {t.scopeAll}
              </label>
              <label>
                <input
                  type="radio"
                  name="scope"
                  checked={scope === 'selected'}
                  onChange={() => setScope('selected')}
                />
                {t.scopeSelected}
              </label>
            </div>
            {scope === 'selected' ? (
              <label>
                {t.scopeLabel}
                <input
                  value={tickersText}
                  onChange={(event) => setTickersText(event.target.value)}
                  placeholder={t.tickersPlaceholder}
                  dir="ltr"
                />
              </label>
            ) : null}
            <label className="radio-row">
              <input
                type="checkbox"
                checked={dryRun}
                onChange={(event) => setDryRun(event.target.checked)}
              />
              {t.dryRunLabel}
            </label>
            <button
              type="button"
              className="advanced-toggle"
              onClick={() => setShowAdvanced((value) => !value)}
            >
              {t.advancedToggle}
            </button>
            {showAdvanced ? (
              <label>
                {t.concurrencyLabel}
                <input
                  type="number"
                  min={1}
                  max={5}
                  value={concurrency}
                  onChange={(event) => setConcurrency(Number(event.target.value))}
                  dir="ltr"
                />
              </label>
            ) : null}
            <div className="run-control-actions">
              <button
                type="button"
                className="button secondary"
                onClick={() => setPanelOpen(false)}
              >
                {t.cancelButton}
              </button>
              <button type="submit" className="button" disabled={busy}>
                {t.confirmButton}
              </button>
            </div>
          </form>
        ) : null}

        {liveRun && liveRun.status === 'running' ? <LiveRunPanel run={liveRun} t={t} /> : null}
        {message ? (
          <p className={`run-banner is-${messageTone}`} role="status">
            {message}
          </p>
        ) : null}
        {errorMessage ? (
          <div className="run-banner is-error" role="alert">
            <span>{errorMessage}</span>
            {terminalRunId ? (
              <a
                className="button secondary compact"
                href={`/${locale}/admin/market-data/runs/${terminalRunId}`}
              >
                {t.viewRunDetails}
              </a>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="card">
        <div className="section-heading">
          <h2>{t.recentRunsTitle}</h2>
        </div>
        {runs.length === 0 ? (
          <div className="empty-panel">
            <strong>{t.noRunsTitle}</strong>
            <span>{t.noRunsSubtitle}</span>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="table responsive-table runs-table">
              <thead>
                <tr>
                  <th>{t.colStatus}</th>
                  <th>{t.colDate}</th>
                  <th>{t.colProvider}</th>
                  <th>{t.colStarted}</th>
                  <th data-numeric>{t.colDuration}</th>
                  <th data-numeric>{t.colEquities}</th>
                  <th data-numeric>{t.colIndices}</th>
                  <th data-numeric>{t.colPublished}</th>
                  <th data-numeric>{t.colFailures}</th>
                  <th>{t.colTrigger}</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr
                    key={run.id}
                    tabIndex={0}
                    style={{ cursor: 'pointer' }}
                    onClick={() => router.push(`/${locale}/admin/market-data/runs/${run.id}`)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter')
                        router.push(`/${locale}/admin/market-data/runs/${run.id}`);
                    }}
                  >
                    <td data-label={t.colStatus}>
                      <span className={`status-chip is-${run.status}`}>
                        {t.runStatusLabels[run.status] ?? run.status}
                      </span>
                    </td>
                    <td data-label={t.colDate} className="technical" dir="ltr">
                      {run.marketDate ?? t.dash}
                    </td>
                    <td data-label={t.colProvider} className="technical" dir="ltr">
                      {run.providerId}
                    </td>
                    <td data-label={t.colStarted} className="technical" dir="ltr">
                      {formatTime(run.startedAt, localeTag)}
                    </td>
                    <td data-label={t.colDuration} data-numeric dir="ltr">
                      {formatDuration(run.startedAt, run.finishedAt)}
                    </td>
                    <td data-label={t.colEquities} data-numeric dir="ltr">
                      {run.metrics.securitiesSucceeded}/{run.metrics.securitiesExpected}
                    </td>
                    <td data-label={t.colIndices} data-numeric dir="ltr">
                      {run.metrics.indicesSucceeded}/{run.metrics.indicesExpected}
                    </td>
                    <td data-label={t.colPublished} data-numeric dir="ltr">
                      {run.metrics.rowsPublished}
                    </td>
                    <td
                      data-label={t.colFailures}
                      data-numeric
                      dir="ltr"
                      className={run.instrumentFailures.length ? 'error-text' : undefined}
                    >
                      {run.instrumentFailures.length}
                    </td>
                    <td data-label={t.colTrigger}>
                      {t.triggerLabels[run.triggerSource as keyof typeof t.triggerLabels] ??
                        run.triggerSource}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <div className="section-heading">
          <h2>{t.coverageTitle}</h2>
        </div>
        <div className="coverage-toolbar">
          <input
            value={coverageSearch}
            onChange={(event) => setCoverageSearch(event.target.value)}
            placeholder={t.coverageSearchPlaceholder}
          />
          <select
            value={coverageFilter}
            onChange={(event) => setCoverageFilter(event.target.value as typeof coverageFilter)}
          >
            <option value="all">{t.coverageFilterAll}</option>
            {(Object.keys(t.coverageStatusLabels) as CoverageStatus[]).map((status) => (
              <option key={status} value={status}>
                {t.coverageStatusLabels[status]}
              </option>
            ))}
          </select>
          <select
            value={coverageSort}
            onChange={(event) => setCoverageSort(event.target.value as typeof coverageSort)}
          >
            <option value="ticker">{t.coverageSortTicker}</option>
            <option value="date">{t.coverageSortDate}</option>
          </select>
        </div>
        {filteredCoverage.length === 0 ? (
          <div className="empty-panel">
            <strong>{t.coverageEmptyTitle}</strong>
            <span>{t.coverageEmptySubtitle}</span>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="table responsive-table">
              <thead>
                <tr>
                  <th>{t.coverageColTicker}</th>
                  <th>{t.coverageColName}</th>
                  <th>{t.coverageColLatestDate}</th>
                  <th>{t.coverageColStatus}</th>
                </tr>
              </thead>
              <tbody>
                {filteredCoverage.map((row) => {
                  const status = computeCoverageStatus(row);
                  return (
                    <tr key={row.securityId}>
                      <td data-label={t.coverageColTicker} className="technical" dir="ltr">
                        {row.ticker}
                      </td>
                      <td data-label={t.coverageColName}>{row.name}</td>
                      <td data-label={t.coverageColLatestDate} dir="ltr">
                        {row.latestMarketDate ?? t.dash}
                      </td>
                      <td data-label={t.coverageColStatus}>
                        <span
                          className={`status-chip is-${status === 'current' ? 'healthy' : status === 'failed_last_run' ? 'failed' : status === 'no_history' ? 'unknown' : 'stale'}`}
                        >
                          {t.coverageStatusLabels[status]}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <div className="section-heading">
          <h2>{t.indexHealthTitle}</h2>
        </div>
        {!snapshot?.indices.length ? (
          <div className="empty-panel">
            <strong>{t.indexNoData}</strong>
          </div>
        ) : (
          <div className="index-health-grid">
            {snapshot.indices.map((index) => {
              const freshness = computeFreshness(index.latestMarketDate);
              return (
                <div key={index.code} className="card index-health-card">
                  <h3 dir="ltr">{index.code}</h3>
                  <p className="microcopy">{index.name}</p>
                  <p>
                    {t.latestDate}: <span dir="ltr">{index.latestMarketDate ?? t.dash}</span>
                  </p>
                  <p>
                    {t.latestValue}: <span dir="ltr">{index.latestCloseValue ?? t.dash}</span>
                  </p>
                  <span
                    className={`status-chip is-${freshness === 'current' ? 'healthy' : freshness === 'stale' ? 'stale' : 'unknown'}`}
                  >
                    {t.freshnessLabels[freshness]}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function LiveRunPanel({ run, t }: { run: UiRun; t: (typeof copy)[keyof typeof copy] }) {
  const equitiesTotal = run.metrics.securitiesExpected || 0;
  const equitiesDone = run.metrics.securitiesSucceeded + run.metrics.securitiesFailed;
  const percent = equitiesTotal ? Math.round((equitiesDone / equitiesTotal) * 100) : 0;
  const [elapsedLabel, setElapsedLabel] = useState('0:00');

  useEffect(() => {
    const started = new Date(run.startedAt).getTime();
    const tick = () => {
      const totalSeconds = Math.max(0, Math.round((Date.now() - started) / 1000));
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = String(totalSeconds % 60).padStart(2, '0');
      setElapsedLabel(`${minutes}:${seconds}`);
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [run.startedAt]);

  return (
    <div className="run-control-panel">
      <span className="status-chip is-running">{t.runningLabel}</span>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${percent}%` }} />
      </div>
      <div className="progress-label">
        <span>
          <span dir="ltr">
            {equitiesDone} / {equitiesTotal}
          </span>{' '}
          {t.equitiesProcessed}
        </span>
        <span dir="ltr">{percent}%</span>
      </div>
      <dl className="health-metrics">
        <div>
          <dt>{t.indicesLabel}</dt>
          <dd dir="ltr">
            {run.metrics.indicesSucceeded}/{run.metrics.indicesExpected}
          </dd>
        </div>
        <div>
          <dt>{t.publishedRowsLabel}</dt>
          <dd dir="ltr">{run.metrics.rowsPublished}</dd>
        </div>
        <div>
          <dt>{t.failures}</dt>
          <dd dir="ltr" className={run.metrics.securitiesFailed > 0 ? 'error-text' : undefined}>
            {run.metrics.securitiesFailed}
          </dd>
        </div>
        <div>
          <dt>{t.elapsedLabel}</dt>
          <dd dir="ltr">{elapsedLabel}</dd>
        </div>
      </dl>
    </div>
  );
}
