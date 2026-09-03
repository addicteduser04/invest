import { requestPasswordReset } from '../auth-actions';
import { asLocale, direction, getUi } from '@/lib/i18n';
import { PublicNav } from '@/components/public/public-nav';
import { PublicFooter } from '@/components/public/public-footer';

export default async function ForgotPassword({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ sent?: string }>;
}) {
  const { locale: rawLocale } = await params;
  const { sent } = await searchParams;
  const locale = asLocale(rawLocale);
  const t = getUi(locale);
  return (
    <main className="public-page" dir={direction(locale)}>
      <PublicNav locale={locale} authenticated={false} />
      <div className="auth-v2-page">
        <section className="auth-v2-card">
          <p className="public-eyebrow">{t.brand}</p>
          <h1>{t.resetPassword}</h1>
          <p>{t.notBroker}</p>
          <form className="auth-v2-form" action={requestPasswordReset}>
            <input type="hidden" name="locale" value={locale} />
            <label>
              {t.email}
              <input required name="email" type="email" autoComplete="email" />
            </label>
            <button type="submit">{t.sendResetLink}</button>
            {sent === '1' ? (
              <p className="auth-v2-status" role="status">
                {t.resetLinkSent}
              </p>
            ) : null}
            <div className="auth-v2-links">
              <a href={`/${locale}/login`}>{t.signIn}</a>
            </div>
          </form>
        </section>
      </div>
      <PublicFooter locale={locale} authenticated={false} />
    </main>
  );
}
