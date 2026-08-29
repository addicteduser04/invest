import type { Locale } from '@bvc/contracts';
import { getUi } from '@/lib/i18n';
import { LocaleSwitcher } from '@/components/locale-switcher';

export function SiteNav({
  locale,
  authenticated = false,
}: {
  locale: Locale;
  authenticated?: boolean;
}) {
  const t = getUi(locale);
  return (
    <nav className="topbar" aria-label="Primary navigation">
      <a className="brand-lockup" href={`/${locale}`}>
        <span className="brand-mark">S</span>
        <span>
          <strong>{t.brand}</strong>
          <small>{t.tagline}</small>
        </span>
      </a>
      <div className="nav-links">
        <a href={`/${locale}/market`}>{t.market}</a>
        {authenticated ? <a href={`/${locale}/dashboard`}>{t.dashboard}</a> : null}
        {authenticated ? <a href={`/${locale}/transactions`}>{t.transactions}</a> : null}
        {authenticated ? <a href={`/${locale}/transactions/import`}>{t.import}</a> : null}
        {authenticated ? <a href={`/${locale}/settings`}>{t.settings}</a> : null}
      </div>
      <div className="nav-actions">
        <LocaleSwitcher locale={locale} label={t.language} />
        {!authenticated ? (
          <a className="button compact" href={`/${locale}/login`}>
            {t.signIn}
          </a>
        ) : null}
      </div>
    </nav>
  );
}
