import { login } from '../auth-actions';
import { asLocale, direction, getUi } from '@/lib/i18n';
import { SiteNav } from '@/components/site-nav';

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
    <main className="app-shell auth-shell" dir={direction(locale)}>
      <SiteNav locale={locale} />
      <section className="auth-card">
        <div className="auth-copy">
          <p className="eyebrow">SaifInvest</p>
          <h1>{t.loginTitle}</h1>
          <p>{t.notBroker}</p>
        </div>
        <form className="form" action={login}>
          <input type="hidden" name="locale" value={locale} />
          <label>
            {t.email}
            <input required name="email" type="email" autoComplete="email" />
          </label>
          <label>
            {t.password}
            <input required name="password" type="password" autoComplete="current-password" />
          </label>
          <button className="button" type="submit">
            {t.signIn}
          </button>
          {error === 'credentials' ? (
            <p className="error-text" role="alert">
              {t.authInvalidCredentials}
            </p>
          ) : null}
          <a className="text-link" href={`/${locale}/forgot-password`}>
            {t.forgotPassword}
          </a>
          <a className="text-link" href={`/${locale}/register`}>
            {t.createAccount}
          </a>
        </form>
      </section>
    </main>
  );
}
