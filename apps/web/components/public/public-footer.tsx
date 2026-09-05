import type { Locale } from '@bvc/contracts';
import { getUi } from '@/lib/i18n';

export function PublicFooter({
  locale,
  authenticated,
}: {
  locale: Locale;
  authenticated: boolean;
}) {
  const t = getUi(locale);
  const links = [
    { href: `/${locale}/market`, label: t.market },
    { href: `/${locale}/stocks`, label: t.navStocks },
    { href: `/${locale}/compare`, label: t.navCompare },
    { href: `/${locale}/dashboard`, label: t.dashboard },
    {
      href: authenticated ? `/${locale}/account` : `/${locale}/login`,
      label: authenticated ? t.account : t.signIn,
    },
  ];
  const year = new Date().getFullYear();
  return (
    <footer className="public-footer">
      <div className="public-footer-top">
        <div className="public-footer-brand">
          <span className="public-footer-mark">{t.brand}</span>
          <p className="public-footer-tagline">{t.tagline}</p>
        </div>
        <nav className="public-footer-nav" aria-label={t.footerNavigation}>
          <span className="public-footer-nav-heading">{t.footerNavigate}</span>
          <div className="public-footer-nav-links">
            {links.map((link) => (
              <a key={link.href} href={link.href}>
                {link.label}
              </a>
            ))}
          </div>
        </nav>
      </div>
      <div className="public-footer-legal">
        <p>{t.notBroker}</p>
        <p>{t.informationDisclaimer}</p>
        <p className="public-footer-copyright">
          © {year} {t.brand}
        </p>
      </div>
    </footer>
  );
}
