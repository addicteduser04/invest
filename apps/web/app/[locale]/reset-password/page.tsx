import { redirect } from 'next/navigation';
import { updatePassword } from '../auth-actions';
import { createClient } from '@/lib/supabase/server';
import { asLocale, direction, getUi } from '@/lib/i18n';
import { SiteNav } from '@/components/site-nav';

export default async function ResetPassword({
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
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/${locale}/login`);
  return (
    <main className="app-shell auth-shell" dir={direction(locale)}>
      <SiteNav locale={locale} authenticated />
      <section className="auth-card">
        <div className="auth-copy">
          <p className="eyebrow">SaifInvest</p>
          <h1>{t.resetPassword}</h1>
        </div>
        <form className="form" action={updatePassword}>
          <input type="hidden" name="locale" value={locale} />
          <label>
            {t.newPassword}
            <input
              required
              name="password"
              type="password"
              minLength={10}
              autoComplete="new-password"
            />
          </label>
          <button className="button" type="submit">
            {t.updatePassword}
          </button>
          {error === 'password' ? (
            <p className="error-text" role="alert">
              {t.passwordUpdateFailed}
            </p>
          ) : null}
        </form>
      </section>
    </main>
  );
}
