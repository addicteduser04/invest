import { register } from '../auth-actions';
import { asLocale, direction, getUi } from '@/lib/i18n';
import { PublicNav } from '@/components/public/public-nav';
import { PublicFooter } from '@/components/public/public-footer';

export default async function Register({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string; sent?: string }>;
}) {
  const { locale: rawLocale } = await params;
  const { error, sent } = await searchParams;
  const locale = asLocale(rawLocale);
  const t = getUi(locale);

  if (sent === '1') {
    return (
      <main className="public-page" dir={direction(locale)}>
        <PublicNav locale={locale} authenticated={false} />
        <div className="auth-v2-page">
          <section className="auth-v2-card">
            <p className="public-eyebrow">{t.brand}</p>
            <h1>{t.checkEmailTitle}</h1>
            <p>{t.checkEmailSubtitle}</p>
            <div className="auth-v2-links">
              <a href={`/${locale}/login`}>{t.signIn}</a>
            </div>
          </section>
        </div>
        <PublicFooter locale={locale} authenticated={false} />
      </main>
    );
  }

  return (
    <main className="public-page" dir={direction(locale)}>
      <PublicNav locale={locale} authenticated={false} />
      <div className="auth-v2-page">
        <section className="auth-v2-card">
          <p className="public-eyebrow">{t.brand}</p>
          <h1>{t.registerTitle}</h1>
          <p>{t.notBroker}</p>
          <form className="auth-v2-form" action={register}>
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
            <button type="submit">{t.createAccount}</button>
            {error === 'registration' ? (
              <p className="auth-v2-error" role="alert">
                {t.registrationFailed}
              </p>
            ) : null}
            {error === 'exists' ? (
              <p className="auth-v2-error" role="alert">
                {t.registrationAlreadyExists}
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
