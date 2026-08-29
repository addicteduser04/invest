import { register } from '../auth-actions';
import { asLocale, direction, getUi } from '@/lib/i18n';
import { SiteNav } from '@/components/site-nav';

export default async function Register({
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
          <h1>{t.registerTitle}</h1>
          <p>{t.notBroker}</p>
        </div>
        <form className="form" action={register}>
          <input type="hidden" name="locale" value={locale} />
          <label>
            {t.name}
            <input required name="displayName" autoComplete="name" />
          </label>
          <label>
            {t.email}
            <input required name="email" type="email" autoComplete="email" />
          </label>
          <label>
            {t.password}
            <input
              required
              name="password"
              type="password"
              minLength={10}
              autoComplete="new-password"
            />
          </label>
          <button className="button" type="submit">
            {t.createAccount}
          </button>
          {error === 'registration' ? (
            <p className="error-text" role="alert">
              {t.registrationFailed}
            </p>
          ) : null}
          <a className="text-link" href={`/${locale}/login`}>
            {t.signIn}
          </a>
        </form>
      </section>
    </main>
  );
}
