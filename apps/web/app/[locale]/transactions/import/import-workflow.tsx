'use client';
import { useRef, useState } from 'react';

type Portfolio = { id: string; name: string };
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
const safeCell = (value: string) => (/^[=+@-]/.test(value) ? `'${value}` : value);

export function ImportWorkflow({
  locale,
  portfolios,
}: {
  locale: 'fr' | 'ar';
  portfolios: Portfolio[];
}) {
  const ar = locale === 'ar';
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
          ? ar
            ? 'جارٍ إنشاء المعاينة…'
            : 'Création de la prévisualisation…'
          : busy === 'confirm'
            ? ar
              ? 'جارٍ التأكيد…'
              : 'Confirmation en cours…'
            : (failure?.message ?? '')}
      </div>
      {confirmedCount !== undefined ? (
        <section className="success-panel" role="status">
          <h2>{ar ? 'تم تأكيد الاستيراد' : 'Import confirmé'}</h2>
          <p>
            {ar
              ? `تم تسجيل ${confirmedCount} عملية بنجاح.`
              : `${confirmedCount} opération(s) enregistrée(s) avec succès.`}
          </p>
          <div className="actions">
            <a className="button" href={`/${locale}/dashboard`}>
              {ar ? 'العودة إلى المحفظة' : 'Voir le portefeuille'}
            </a>
            <a className="button secondary" href={`/${locale}/dashboard#transactions`}>
              {ar ? 'سجل العمليات' : 'Historique des opérations'}
            </a>
          </div>
        </section>
      ) : !preview ? (
        <section aria-labelledby="mapping-title">
          <h2 id="mapping-title">
            {ar ? 'الملف وتعيين الأعمدة' : 'Fichier et correspondance des colonnes'}
          </h2>
          <div className="form">
            <label>
              {ar ? 'المحفظة' : 'Portefeuille'}
              <select id="import-portfolio" disabled={Boolean(busy)}>
                {portfolios.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {ar ? 'ملف CSV الأصلي' : 'Fichier CSV original'}
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
              {ar ? 'إنشاء معاينة محفوظة' : 'Créer la prévisualisation'}
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
                  {ar ? 'استبدال الاستيراد غير المؤكد' : 'Remplacer l’import non confirmé'}
                </button>
              ) : (
                <p>
                  {ar
                    ? 'يجب تصحيح العمليات المؤكدة لاحقاً بواسطة العكس والاستبدال.'
                    : 'Les opérations confirmées devront être corrigées par le futur flux d’annulation/remplacement.'}
                </p>
              )}
            </div>
          ) : null}
        </section>
      ) : (
        <section aria-labelledby="preview-title">
          <h2 id="preview-title">{ar ? 'معاينة الاستيراد' : 'Prévisualisation de l’import'}</h2>
          <dl className="summary-grid">
            <div>
              <dt>{ar ? 'الملف' : 'Fichier'}</dt>
              <dd>{safeCell(preview.filename)}</dd>
            </div>
            <div>
              <dt>{ar ? 'المعرف' : 'Identifiant'}</dt>
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
          <h3>{ar ? 'ملخص الأنواع' : 'Résumé par type'}</h3>
          <p>
            {Object.entries(preview.typeSummary)
              .filter(([, n]) => n)
              .map(([type, n]) => `${type}: ${n}`)
              .join(' · ') || '—'}
          </p>
          <h3>{ar ? 'الآثار المتوقعة' : 'Effets attendus'}</h3>
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
                  <th>{ar ? 'السطر' : 'Ligne'}</th>
                  <th>{ar ? 'البيانات' : 'Données'}</th>
                  <th>{ar ? 'النتيجة' : 'Résultat'}</th>
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
                      {!row.errors.length && !row.warnings.length ? (ar ? 'صالح' : 'Valide') : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={preview.canConfirm ? 'success-text' : 'error-text'}>
            {preview.canConfirm
              ? ar
                ? 'المعاينة مؤهلة للتأكيد.'
                : 'La prévisualisation peut être confirmée.'
              : ar
                ? 'يجب تصحيح الأخطاء قبل التأكيد.'
                : 'Corrigez les erreurs avant de confirmer.'}
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
              {ar ? 'العودة إلى التعيين' : 'Retour au mapping'}
            </button>
            <button
              type="button"
              className="button"
              disabled={!preview.canConfirm || Boolean(busy)}
              aria-disabled={!preview.canConfirm || Boolean(busy)}
              onClick={() => void confirm()}
            >
              {busy === 'confirm'
                ? ar
                  ? 'جارٍ التأكيد…'
                  : 'Confirmation…'
                : ar
                  ? 'تأكيد جميع العمليات'
                  : 'Confirmer toutes les opérations'}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
