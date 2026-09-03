import type { Locale } from '@bvc/contracts';
import { getUi } from '@/lib/i18n';
import { createClient } from '@/lib/supabase/server';
import { LocaleSwitcher } from '@/components/locale-switcher';

export async function PublicNav({
  locale,
  authenticated,
}: {
  locale: Locale;
  authenticated: boolean;
}) {
  const t = getUi(locale);
  let dataAdmin = false;
  if (authenticated) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const { data: role } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .eq('role', 'data_admin')
        .maybeSingle();
      dataAdmin = Boolean(role);
    }
  }
  const links = [
    { href: `/${locale}/market`, label: t.market },
    { href: `/${locale}/stocks`, label: t.navStocks },
    { href: `/${locale}/compare`, label: t.navCompare },
    { href: `/${locale}/dashboard`, label: t.dashboard },
    ...(dataAdmin ? [{ href: `/${locale}/admin/market-data`, label: t.navAdminDashboard }] : []),
  ];

  return (
    <header className="public-header">
      <nav className="public-nav" aria-label={t.primaryNavigation}>
        <a className="public-brand" href={`/${locale}`}>
          <span>SAIFINVEST</span>
        </a>
        <div className="public-nav-links">
          {links.map((link) => (
            <a key={`${link.href}-${link.label}`} href={link.href}>
              {link.label}
            </a>
          ))}
        </div>
        <form className="public-search" action={`/${locale}/market`}>
          <label>
            <span className="sr-only">{t.search}</span>
            <span className="public-search-glyph" aria-hidden="true">
              /
            </span>
            <input name="q" placeholder={t.searchShort} />
          </label>
        </form>
        <div className="public-nav-actions">
          <LocaleSwitcher locale={locale} label={t.language} />
          <a
            className="public-account-link"
            href={authenticated ? `/${locale}/account` : `/${locale}/login`}
          >
            {authenticated ? t.account : t.signIn}
          </a>
          {!authenticated ? (
            <a className="public-cta" href={`/${locale}/register`}>
              {t.createAccount}
            </a>
          ) : null}
        </div>
      </nav>
    </header>
  );
}
