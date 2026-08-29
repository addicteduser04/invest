'use client';

import { useState, type FormEvent } from 'react';
import type { Locale } from '@bvc/contracts';

export type AdminSecurityRow = {
  id: string;
  ticker: string;
  name: string;
  sector: string | null;
  listing_status: string;
  listed_on: string | null;
  is_synthetic: boolean;
  updated_at: string;
};

type Preview = {
  status: string;
  candidates?: {
    ticker: string;
    name: string;
    sector: string | null;
    listingStatus: string;
    listedOn: string | null;
  }[];
  errors?: string[];
  warnings?: string[];
  result?: { updatedRows?: number };
  error?: string;
};

const copy = {
  en: {
    title: 'Security master',
    hint: 'Upload a verified CSV with ticker,name,sector,listing_status,listed_on. No market price is invented.',
    validate: 'Validate file',
    apply: 'Apply validated rows',
    current: 'Current securities',
    status: 'Status',
    updated: 'Updated',
    preview: 'Validated rows',
    applied: 'Security master updated. Reload to refresh the table.',
    rows: 'rows',
    synthetic: 'Synthetic',
  },
  fr: {
    title: 'Référentiel des titres',
    hint: 'Importez un CSV vérifié avec ticker,name,sector,listing_status,listed_on. Aucun cours n’est inventé.',
    validate: 'Valider le fichier',
    apply: 'Appliquer les lignes validées',
    current: 'Titres actuels',
    status: 'Statut',
    updated: 'Mis à jour',
    preview: 'Lignes validées',
    applied: 'Référentiel mis à jour. Rechargez la page pour actualiser le tableau.',
    rows: 'lignes',
    synthetic: 'Synthétique',
  },
  ar: {
    title: 'مرجع الأوراق المالية',
    hint: 'ارفع ملف CSV موثوقاً بالأعمدة ticker,name,sector,listing_status,listed_on. لا يتم اختلاق أي سعر سوق.',
    validate: 'التحقق من الملف',
    apply: 'تطبيق الصفوف المتحقق منها',
    current: 'الأوراق الحالية',
    status: 'الحالة',
    updated: 'آخر تحديث',
    preview: 'الصفوف المتحقق منها',
    applied: 'تم تحديث المرجع. أعد تحميل الصفحة لتحديث الجدول.',
    rows: 'صفوف',
    synthetic: 'اصطناعي',
  },
} as const;

export function AdminSecurityImport({
  locale,
  rows,
}: {
  locale: Locale;
  rows: AdminSecurityRow[];
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
      const response = await fetch('/api/admin/securities/import', { method: 'POST', body: data });
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
      <section className="card">
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
        {preview?.errors?.length ? (
          <ul className="error-list">
            {preview.errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        ) : null}
        {preview?.warnings?.length ? (
          <ul className="warning-list">
            {preview.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        ) : null}
        {preview?.status === 'preview' ? (
          <div className="status-message">
            <strong>
              {t.preview}: {preview.candidates?.length ?? 0} {t.rows}
            </strong>
            <button
              className="button compact"
              type="button"
              disabled={busy}
              onClick={() => void submit(true)}
            >
              {t.apply}
            </button>
          </div>
        ) : null}
        {preview?.status === 'applied' ? (
          <p className="notice success-notice">{t.applied}</p>
        ) : null}
        {preview?.error ? <p className="error-text">{preview.error}</p> : null}
      </section>

      <section className="card span-2">
        <h2>{t.current}</h2>
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Ticker</th>
                <th>Name</th>
                <th>Sector</th>
                <th>{t.status}</th>
                <th>{t.updated}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <strong>{row.ticker}</strong>
                    {row.is_synthetic ? <small>{t.synthetic}</small> : null}
                  </td>
                  <td>{row.name}</td>
                  <td>{row.sector ?? '—'}</td>
                  <td>{row.listing_status}</td>
                  <td className="technical" dir="ltr">
                    {row.updated_at.slice(0, 10)}
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
