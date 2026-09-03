'use client';

import { useParams } from 'next/navigation';
import { asLocale, direction, getUi } from '@/lib/i18n';

export default function LocaleNotFound() {
  const params = useParams<{ locale?: string }>();
  const locale = asLocale(params?.locale);
  const t = getUi(locale);
  return (
    <main className="public-page state-v2-page" dir={direction(locale)}>
      <section className="state-v2-card" role="alert">
        <span className="brand-mark">S</span>
        <h1>{t.notFoundTitle}</h1>
        <p>{t.notFoundSubtitle}</p>
        <div className="state-v2-actions">
          <a className="primary" href={`/${locale}/market`}>
            {t.market}
          </a>
          <a className="secondary" href={`/${locale}`}>
            {t.home}
          </a>
        </div>
      </section>
    </main>
  );
}
