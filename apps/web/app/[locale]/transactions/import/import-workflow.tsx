'use client';
import React, { useRef, useState } from 'react';
import type { Locale } from '@bvc/contracts';

type Portfolio = { id: string; name: string; tracking_mode: 'real_tracking' | 'virtual' };
type Message = { code: string; message: string; field?: string; row?: number };
type PreviewRow = {
  row: number;
  values: Record<string, string>;
  errors: Message[];
  warnings: Message[];
};
type Preview = {
  importId: string;
  filename: string;
  portfolioId: string;
  hash: string;
  totals: { total: number; valid: number; invalid: number; warnings: number; duplicates: number };
  canConfirm: boolean;
  existingTransactions: number;
  typeSummary: Record<string, number>;
  expectedEffects: { row: number; type: string; cash: string; holding: string | null }[];
  rows: PreviewRow[];
};
type Failure = { code: string; message: string; existingImport?: { id: string; status: string } };
const fields = [
  'date',
  'type',
  'security',
  'quantity',
  'unitPrice',
  'fees',
  'taxes',
  'currency',
  'externalReference',
  'description',
] as const;
const defaults: Record<(typeof fields)[number], string> = {
  date: 'date',
  type: 'type',
  security: 'security',
  quantity: 'quantity',
  unitPrice: 'value',
  fees: 'fees',
  taxes: 'taxes',
  currency: 'currency',
  externalReference: 'reference',
  description: 'description',
};
const labels = {
  en: {
    date: 'Date',
    type: 'Type',
    security: 'Security',
    quantity: 'Quantity',
    unitPrice: 'Amount / unit price',
    fees: 'Fees',
    taxes: 'Taxes',
    currency: 'Currency',
    externalReference: 'External reference',
    description: 'Description',
  },
  fr: {
    date: 'Date',
    type: 'Type',
    security: 'Titre',
    quantity: 'Quantité',
    unitPrice: 'Montant / prix unitaire',
    fees: 'Frais',
    taxes: 'Taxes',
    currency: 'Devise',
    externalReference: 'Référence externe',
    description: 'Description',
  },
  ar: {
    date: 'التاريخ',
    type: 'النوع',
    security: 'السهم',
    quantity: 'الكمية',
    unitPrice: 'المبلغ / سعر الوحدة',
    fees: 'الرسوم',
    taxes: 'الضرائب',
    currency: 'العملة',
    externalReference: 'المرجع الخارجي',
    description: 'الوصف',
  },
};
const copy = {
  en: {
    previewing: 'Creating preview…',
    confirming: 'Confirming…',
    confirmed: 'Import confirmed',
    confirmedCount: (n: number) => `${n} transaction(s) recorded successfully.`,
    portfolioBack: 'View portfolio',
    virtualLabel: 'Simulation',
    realLabel: 'Real tracking',
    history: 'Transaction history',
    mappingTitle: 'File and column mapping',
    portfolio: 'Portfolio',
    sourceFile: 'Original CSV file',
    createPreview: 'Create saved preview',
    replaceDraft: 'Replace unconfirmed import',
    immutableConfirmed:
      'Confirmed transactions must be corrected through the reversal/replacement workflow.',
    previewTitle: 'Import preview',
    file: 'File',
    id: 'Identifier',
    typeSummary: 'Type summary',
    effects: 'Expected effects',
    row: 'Row',
    data: 'Data',
    result: 'Result',
    valid: 'Valid',
    canConfirm: 'The preview can be confirmed.',
    fixErrors: 'Correct the errors before confirming.',
    back: 'Back to mapping',
    confirmBusy: 'Confirming…',
    confirmAll: 'Confirm all transactions',
  },
  fr: {
    previewing: 'Création de la prévisualisation…',
    confirming: 'Confirmation en cours…',
    confirmed: 'Import confirmé',
    confirmedCount: (n: number) => `${n} opération(s) enregistrée(s) avec succès.`,
    portfolioBack: 'Voir le portefeuille',
    virtualLabel: 'Simulation',
    realLabel: 'Suivi réel',
    history: 'Historique des opérations',
    mappingTitle: 'Fichier et correspondance des colonnes',
    portfolio: 'Portefeuille',
    sourceFile: 'Fichier CSV original',
    createPreview: 'Créer la prévisualisation',
    replaceDraft: 'Remplacer l’import non confirmé',
    immutableConfirmed:
      'Les opérations confirmées doivent être corrigées par le flux d’annulation/remplacement.',
    previewTitle: 'Prévisualisation de l’import',
    file: 'Fichier',
    id: 'Identifiant',
    typeSummary: 'Résumé par type',
    effects: 'Effets attendus',
    row: 'Ligne',
    data: 'Données',
    result: 'Résultat',
    valid: 'Valide',
    canConfirm: 'La prévisualisation peut être confirmée.',
    fixErrors: 'Corrigez les erreurs avant de confirmer.',
    back: 'Retour au mapping',
    confirmBusy: 'Confirmation…',
    confirmAll: 'Confirmer toutes les opérations',
  },
  ar: {
    previewing: 'جارٍ إنشاء المعاينة…',
    confirming: 'جارٍ التأكيد…',
    confirmed: 'تم تأكيد الاستيراد',
    confirmedCount: (n: number) => `تم تسجيل ${n} عملية بنجاح.`,
    portfolioBack: 'العودة إلى المحفظة',
    virtualLabel: 'محاكاة',
    realLabel: 'تتبع حقيقي',
    history: 'سجل العمليات',
    mappingTitle: 'الملف وتعيين الأعمدة',
    portfolio: 'المحفظة',
    sourceFile: 'ملف CSV الأصلي',
    createPreview: 'إنشاء معاينة محفوظة',
    replaceDraft: 'استبدال الاستيراد غير المؤكد',
    immutableConfirmed: 'يجب تصحيح العمليات المؤكدة بواسطة مسار العكس والاستبدال.',
    previewTitle: 'معاينة الاستيراد',
    file: 'الملف',
    id: 'المعرف',
    typeSummary: 'ملخص الأنواع',
    effects: 'الآثار المتوقعة',
    row: 'السطر',
    data: 'البيانات',
    result: 'النتيجة',
    valid: 'صالح',
    canConfirm: 'المعاينة مؤهلة للتأكيد.',
    fixErrors: 'يجب تصحيح الأخطاء قبل التأكيد.',
    back: 'العودة إلى التعيين',
    confirmBusy: 'جارٍ التأكيد…',
    confirmAll: 'تأكيد جميع العمليات',
  },
};
const safeCell = (value: string) => (/^[=+@-]/.test(value) ? `'${value}` : value);

export function ImportWorkflow({
  locale,
  portfolios,
}: {
  locale: Locale;
  portfolios: Portfolio[];
}) {
  const t = copy[locale];
  const [file, setFile] = useState<File>();
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState(defaults);
  const [preview, setPreview] = useState<Preview>();
  const [failure, setFailure] = useState<Failure>();
  const [busy, setBusy] = useState<'preview' | 'confirm' | 'supersede'>();
  const [confirmedCount, setConfirmedCount] = useState<number>();
  const statusRef = useRef<HTMLDivElement>(null);
  const focusStatus = () => queueMicrotask(() => statusRef.current?.focus());

  const chooseFile = async (selected?: File) => {
    setFile(selected);
    setPreview(undefined);
    setFailure(undefined);
    if (!selected) return setHeaders([]);
    const first = (await selected.text()).replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0] ?? '';
    setHeaders(first.split(',').map((item) => item.trim().replace(/^"|"$/g, '')));
  };
  const generate = async (supersedesImportId?: string) => {
    if (!file) return;
    setBusy('preview');
    setFailure(undefined);
    const data = new FormData();
    data.set('file', file);
    data.set('locale', locale);
    data.set(
      'portfolioId',
      (document.getElementById('import-portfolio') as HTMLSelectElement).value,
    );
    for (const field of fields) data.set(field, mapping[field]);
    if (supersedesImportId) data.set('supersedesImportId', supersedesImportId);
    const response = await fetch('/api/transaction-imports/preview', {
      method: 'POST',
      body: data,
    });
    const body = await response.json();
    if (response.ok) {
      setPreview(body);
      setFailure(undefined);
    } else {
      setPreview(body.importId ? body : undefined);
      setFailure(body);
    }
    setBusy(undefined);
    focusStatus();
  };
  const confirm = async () => {
    if (!preview?.canConfirm || busy) return;
    setBusy('confirm');
    const response = await fetch(`/api/transaction-imports/${preview.importId}/confirm`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ locale }),
    });
    const body = await response.json();
    if (response.ok) {
      setFailure(undefined);
      setPreview({ ...preview, canConfirm: false });
      setConfirmedCount(Array.isArray(body.transactionIds) ? body.transactionIds.length : 0);
    } else setFailure(body);
    setBusy(undefined);
    focusStatus();
  };
  const supersede = async () => {
    const existing = failure?.existingImport;
    if (!existing || busy) return;
    setFailure(undefined);
    await generate(existing.id);
  };

  return (
    <div className="import-flow">
      <div
        ref={statusRef}
        tabIndex={-1}
        role="status"
        aria-live="polite"
        className="status-message"
      >
        {busy === 'preview'
          ? t.previewing
          : busy === 'confirm'
            ? t.confirming
            : (failure?.message ?? '')}
      </div>
      {confirmedCount !== undefined ? (
        <section className="success-panel" role="status">
          <h2>{t.confirmed}</h2>
          <p>{t.confirmedCount(confirmedCount)}</p>
          <div className="actions">
            <a
              className="button"
              href={`/${locale}/dashboard${preview?.portfolioId ? `?portfolio=${preview.portfolioId}` : ''}`}
            >
              {t.portfolioBack}
            </a>
            <a
              className="button secondary"
              href={`/${locale}/transactions${preview?.portfolioId ? `?portfolio=${preview.portfolioId}` : ''}`}
            >
              {t.history}
            </a>
          </div>
        </section>
      ) : !preview ? (
        <section aria-labelledby="mapping-title">
          <h2 id="mapping-title">{t.mappingTitle}</h2>
          <div className="form">
            <label>
              {t.portfolio}
              <select id="import-portfolio" disabled={Boolean(busy)}>
                {portfolios.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {p.tracking_mode === 'virtual' ? t.virtualLabel : t.realLabel}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t.sourceFile}
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={(event) => void chooseFile(event.target.files?.[0])}
              />
            </label>
            {file &&
              fields.map((field) => (
                <label key={field}>
                  {labels[locale][field]}
                  <select
                    value={mapping[field]}
                    onChange={(event) =>
                      setMapping((current) => ({ ...current, [field]: event.target.value }))
                    }
                  >
                    <option value="">—</option>
                    {headers.map((header) => (
                      <option key={header} value={header}>
                        {safeCell(header)}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            <button
              type="button"
              className="button"
              disabled={!file || Boolean(busy)}
              onClick={() => void generate()}
            >
              {t.createPreview}
            </button>
          </div>
          {failure?.existingImport ? (
            <div className="notice">
              <p>{failure.message}</p>
              {failure.existingImport.status !== 'confirmed' ? (
                <button
                  type="button"
                  className="button secondary"
                  disabled={Boolean(busy)}
                  onClick={() => void supersede()}
                >
                  {t.replaceDraft}
                </button>
              ) : (
                <p>{t.immutableConfirmed}</p>
              )}
            </div>
          ) : null}
        </section>
      ) : (
        <section aria-labelledby="preview-title">
          <h2 id="preview-title">{t.previewTitle}</h2>
          <dl className="summary-grid">
            <div>
              <dt>{t.file}</dt>
              <dd>{safeCell(preview.filename)}</dd>
            </div>
            <div>
              <dt>{t.id}</dt>
              <dd className="technical" dir="ltr">
                {preview.hash.slice(0, 12)}…
              </dd>
            </div>
            {Object.entries({
              total: preview.totals.total,
              valid: preview.totals.valid,
              invalid: preview.totals.invalid,
              warnings: preview.totals.warnings,
              duplicates: preview.totals.duplicates,
              existing: preview.existingTransactions,
            }).map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <h3>{t.typeSummary}</h3>
          <p>
            {Object.entries(preview.typeSummary)
              .filter(([, n]) => n)
              .map(([type, n]) => `${type}: ${n}`)
              .join(' · ') || '—'}
          </p>
          <h3>{t.effects}</h3>
          <ul>
            {preview.expectedEffects.map((effect) => (
              <li key={effect.row}>
                <span className="technical" dir="ltr">
                  #{effect.row} {effect.cash}
                  {effect.holding ? ` · ${effect.holding}` : ''}
                </span>
              </li>
            ))}
          </ul>
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>{t.row}</th>
                  <th>{t.data}</th>
                  <th>{t.result}</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => (
                  <tr key={row.row}>
                    <td className="technical" dir="ltr">
                      {row.row}
                    </td>
                    <td>
                      {Object.entries(row.values).map(([key, value]) => (
                        <div key={key}>
                          <span>{key}: </span>
                          <span className="technical" dir="ltr">
                            {safeCell(value)}
                          </span>
                        </div>
                      ))}
                    </td>
                    <td>
                      {[...row.errors, ...row.warnings].map((message, index) => (
                        <p
                          className={row.errors.includes(message) ? 'error-text' : 'warning-text'}
                          key={`${message.code}-${index}`}
                        >
                          {message.message}
                        </p>
                      ))}
                      {!row.errors.length && !row.warnings.length ? t.valid : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={preview.canConfirm ? 'success-text' : 'error-text'}>
            {preview.canConfirm ? t.canConfirm : t.fixErrors}
          </p>
          {failure ? (
            <p className="error-text" role="alert">
              {failure.message}
            </p>
          ) : null}
          <div className="actions">
            <button
              type="button"
              className="button secondary"
              disabled={Boolean(busy)}
              onClick={() => {
                setPreview(undefined);
                setFailure(undefined);
              }}
            >
              {t.back}
            </button>
            <button
              type="button"
              className="button"
              disabled={!preview.canConfirm || Boolean(busy)}
              aria-disabled={!preview.canConfirm || Boolean(busy)}
              onClick={() => void confirm()}
            >
              {busy === 'confirm' ? t.confirmBusy : t.confirmAll}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
