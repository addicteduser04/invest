import { redirect } from 'next/navigation';
import { updatePassword } from '../auth-actions';
import { createClient } from '@/lib/supabase/server';
import { asLocale, direction, getUi } from '@/lib/i18n';
import { PublicNav } from '@/components/public/public-nav';
import { PublicFooter } from '@/components/public/public-footer';

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
    <main className="public-page" dir={direction(locale)}>
      <PublicNav locale={locale} authenticated />
      <div className="auth-v2-page">
        <section className="auth-v2-card">
          <p className="public-eyebrow">{t.brand}</p>
          <h1>{t.resetPassword}</h1>
          <form className="auth-v2-form" action={updatePassword}>
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
            <button type="submit">{t.updatePassword}</button>
            {error === 'password' ? (
              <p className="auth-v2-error" role="alert">
                {t.passwordUpdateFailed}
              </p>
            ) : null}
          </form>
        </section>
      </div>
      <PublicFooter locale={locale} authenticated />
    </main>
  );
}
