import { requestPasswordReset } from '../auth-actions';
import { asLocale, direction, getUi } from '@/lib/i18n';
import { SiteNav } from '@/components/site-nav';

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
    <main className="app-shell auth-shell" dir={direction(locale)}>
      <SiteNav locale={locale} />
      <section className="auth-card">
        <div className="auth-copy">
          <p className="eyebrow">SaifInvest</p>
          <h1>{t.resetPassword}</h1>
          <p>{t.notBroker}</p>
        </div>
        <form className="form" action={requestPasswordReset}>
          <input type="hidden" name="locale" value={locale} />
          <label>
            {t.email}
            <input required name="email" type="email" autoComplete="email" />
          </label>
          <button className="button" type="submit">
            {t.sendResetLink}
          </button>
          {sent === '1' ? (
            <p className="status-message" role="status">
              {t.resetLinkSent}
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
