'use client';

import { useState, type FormEvent } from 'react';
import type { Locale } from '@bvc/contracts';

export type AdminFundamentalsRun = {
  id: string;
  status: string;
  source_hash: string;
  original_filename: string;
  row_count: number;
  inserted_count: number;
  updated_count: number;
  noop_count: number;
  rejected_count: number;
  created_by: string;
  created_at: string;
  applied_at: string | null;
};

type PreviewRow = {
  row: number;
  values: Record<string, string>;
  errors: string[];
  warnings: string[];
};

type Preview = {
  status?: 'preview' | 'rejected' | 'imported';
  sourceHash?: string;
  rows?: PreviewRow[];
  totals?: {
    total: number;
    valid: number;
    invalid: number;
    warnings: number;
    willInsert: number;
    willUpdate: number;
  };
  canConfirm?: boolean;
  result?: { insertedCount: number; updatedCount: number; noopCount: number; importRunId: string };
  error?: string;
};

const copy = {
  en: {
    title: 'Fundamentals import',
    hint: 'Upload a verified CSV with one row per company/period. Blanks stay unavailable; no figure is invented.',
    validate: 'Validate file',
    confirm: 'Confirm import',
    total: 'Total',
    valid: 'Valid',
    invalid: 'Invalid',
    warnings: 'Warnings',
    willInsert: 'Will insert',
    willUpdate: 'Will update',
    row: 'Row',
    data: 'Data',
    result: 'Result',
    rowValid: 'Valid',
    canConfirm: 'The file is valid and can be confirmed.',
    fixErrors: 'Fix the row errors above and re-upload before confirming.',
    imported: 'Import applied',
    inserted: 'Inserted',
    updated: 'Updated',
    noop: 'Unchanged',
    history: 'Import history',
    status: 'Status',
    rows: 'Rows',
    date: 'Date',
    file: 'File',
  },
  fr: {
    title: 'Import des fondamentaux',
    hint: 'Importez un CSV vérifié avec une ligne par entreprise/période. Les cases vides restent indisponibles ; aucun chiffre n’est inventé.',
    validate: 'Valider le fichier',
    confirm: 'Confirmer l’import',
    total: 'Total',
    valid: 'Valides',
    invalid: 'Invalides',
    warnings: 'Avertissements',
    willInsert: 'Seront créées',
    willUpdate: 'Seront mises à jour',
    row: 'Ligne',
    data: 'Données',
    result: 'Résultat',
    rowValid: 'Valide',
    canConfirm: 'Le fichier est valide et peut être confirmé.',
    fixErrors: 'Corrigez les erreurs de ligne ci-dessus puis réimportez avant de confirmer.',
    imported: 'Import appliqué',
    inserted: 'Créées',
    updated: 'Mises à jour',
    noop: 'Inchangées',
    history: 'Historique des imports',
    status: 'Statut',
    rows: 'Lignes',
    date: 'Date',
    file: 'Fichier',
  },
  ar: {
    title: 'استيراد الأساسيات المالية',
    hint: 'ارفع ملف CSV موثقاً بسطر واحد لكل شركة/فترة. تبقى الخانات الفارغة غير متاحة؛ ولا يتم اختلاق أي رقم.',
    validate: 'التحقق من الملف',
    confirm: 'تأكيد الاستيراد',
    total: 'الإجمالي',
    valid: 'صالحة',
    invalid: 'غير صالحة',
    warnings: 'تحذيرات',
    willInsert: 'سيتم إنشاؤها',
    willUpdate: 'سيتم تحديثها',
    row: 'السطر',
    data: 'البيانات',
    result: 'النتيجة',
    rowValid: 'صالح',
    canConfirm: 'الملف صالح ويمكن تأكيده.',
    fixErrors: 'صحّح أخطاء الأسطر أعلاه ثم أعد الرفع قبل التأكيد.',
    imported: 'تم تطبيق الاستيراد',
    inserted: 'أُنشئت',
    updated: 'حُدّثت',
    noop: 'دون تغيير',
    history: 'سجل الاستيراد',
    status: 'الحالة',
    rows: 'الأسطر',
    date: 'التاريخ',
    file: 'الملف',
  },
} as const;

export function AdminFundamentalsImport({
  locale,
  runs,
}: {
  locale: Locale;
  runs: AdminFundamentalsRun[];
}) {
  const t = copy[locale];
  const [file, setFile] = useState<File>();
  const [preview, setPreview] = useState<Preview>();
  const [busy, setBusy] = useState(false);

  const submit = async (confirm: boolean) => {
    if (!file || busy) return;
    setBusy(true);
    const data = new FormData();
    data.set('file', file);
    if (confirm) data.set('confirm', '1');
    try {
      const response = await fetch('/api/admin/fundamentals/import', {
        method: 'POST',
        body: data,
      });
      setPreview((await response.json()) as Preview);
    } finally {
      setBusy(false);
    }
  };

  const validate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submit(false);
  };

  return (
    <div className="dashboard-grid">
      <section className="card span-2">
        <h2>{t.title}</h2>
        <p className="microcopy">{t.hint}</p>
        <form className="form" onSubmit={validate}>
          <input
            type="file"
            accept=".csv,text/csv"
            required
            onChange={(event) => {
              setFile(event.target.files?.[0]);
              setPreview(undefined);
            }}
          />
          <button className="button" disabled={!file || busy}>
            {t.validate}
          </button>
        </form>

        {preview?.totals ? (
          <dl className="summary-grid">
            <div>
              <dt>{t.total}</dt>
              <dd>{preview.totals.total}</dd>
            </div>
            <div>
              <dt>{t.valid}</dt>
              <dd>{preview.totals.valid}</dd>
            </div>
            <div>
              <dt>{t.invalid}</dt>
              <dd>{preview.totals.invalid}</dd>
            </div>
            <div>
              <dt>{t.warnings}</dt>
              <dd>{preview.totals.warnings}</dd>
            </div>
            <div>
              <dt>{t.willInsert}</dt>
              <dd>{preview.totals.willInsert}</dd>
            </div>
            <div>
              <dt>{t.willUpdate}</dt>
              <dd>{preview.totals.willUpdate}</dd>
            </div>
          </dl>
        ) : null}

        {preview?.rows?.length ? (
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
                            {value || '—'}
                          </span>
                        </div>
                      ))}
                    </td>
                    <td>
                      {row.errors.map((message) => (
                        <p className="error-text" key={message}>
                          {message}
                        </p>
                      ))}
                      {row.warnings.map((message) => (
                        <p className="warning-text" key={message}>
                          {message}
                        </p>
                      ))}
                      {!row.errors.length && !row.warnings.length ? t.rowValid : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {preview?.status === 'preview' ? (
          <div className="status-message">
            <p className={preview.canConfirm ? 'success-text' : 'error-text'}>
              {preview.canConfirm ? t.canConfirm : t.fixErrors}
            </p>
            <button
              className="button compact"
              type="button"
              disabled={!preview.canConfirm || busy}
              onClick={() => void submit(true)}
            >
              {t.confirm}
            </button>
          </div>
        ) : null}

        {preview?.status === 'rejected' ? <p className="error-text">{t.fixErrors}</p> : null}

        {preview?.status === 'imported' && preview.result ? (
          <p className="notice success-notice">
            {t.imported}: {t.inserted} {preview.result.insertedCount} · {t.updated}{' '}
            {preview.result.updatedCount} · {t.noop} {preview.result.noopCount}
          </p>
        ) : null}

        {preview?.error ? <p className="error-text">{preview.error}</p> : null}
      </section>

      <section className="card span-2">
        <h2>{t.history}</h2>
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>{t.file}</th>
                <th>{t.status}</th>
                <th>{t.rows}</th>
                <th>{t.inserted}</th>
                <th>{t.updated}</th>
                <th>{t.noop}</th>
                <th>{t.date}</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id}>
                  <td className="technical" dir="ltr">
                    {run.original_filename}
                  </td>
                  <td>{run.status}</td>
                  <td className="technical" dir="ltr">
                    {run.row_count}
                  </td>
                  <td className="technical" dir="ltr">
                    {run.inserted_count}
                  </td>
                  <td className="technical" dir="ltr">
                    {run.updated_count}
                  </td>
                  <td className="technical" dir="ltr">
                    {run.noop_count}
                  </td>
                  <td className="technical" dir="ltr">
                    {run.created_at.slice(0, 10)}
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
