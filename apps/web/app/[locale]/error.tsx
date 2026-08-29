'use client';

import { useParams } from 'next/navigation';
import { asLocale, direction, getUi } from '@/lib/i18n';

export default function LocaleError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const params = useParams<{ locale?: string }>();
  const locale = asLocale(params?.locale);
  const t = getUi(locale);
  return (
    <main className="app-shell error-shell" dir={direction(locale)}>
      <section className="card error-card" role="alert">
        <span className="brand-mark">S</span>
        <h1>{t.brand}</h1>
        <p>{t.somethingWentWrong}</p>
        <div className="actions">
          <button className="button" type="button" onClick={reset}>
            {t.retry}
          </button>
          <a className="button secondary" href={`/${locale}`}>
            {t.home}
          </a>
        </div>
      </section>
    </main>
  );
}
