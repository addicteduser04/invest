import { login } from '../auth-actions';
import { asLocale, direction, getUi } from '@/lib/i18n';
import { PublicNav } from '@/components/public/public-nav';
import { PublicFooter } from '@/components/public/public-footer';

export default async function Login({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { locale: rawLocale } = await params;
  const { error } = await searchParams;
  const locale = asLocale(rawLocale);
  const t = getUi(locale);
  return (
    <main className="public-page" dir={direction(locale)}>
      <PublicNav locale={locale} authenticated={false} />
      <div className="auth-v2-page">
        <section className="auth-v2-card">
          <p className="public-eyebrow">{t.brand}</p>
          <h1>{t.loginTitle}</h1>
          <p>{t.notBroker}</p>
          <form className="auth-v2-form" action={login}>
            <input type="hidden" name="locale" value={locale} />
            <label>
              {t.email}
              <input required name="email" type="email" autoComplete="email" />
            </label>
            <label>
              {t.password}
              <input required name="password" type="password" autoComplete="current-password" />
            </label>
            <button type="submit">{t.signIn}</button>
            {error === 'credentials' ? (
              <p className="auth-v2-error" role="alert">
                {t.authInvalidCredentials}
              </p>
            ) : null}
            <div className="auth-v2-links">
              <a href={`/${locale}/forgot-password`}>{t.forgotPassword}</a>
              <a href={`/${locale}/register`}>{t.createAccount}</a>
            </div>
          </form>
        </section>
      </div>
      <PublicFooter locale={locale} authenticated={false} />
    </main>
  );
}
