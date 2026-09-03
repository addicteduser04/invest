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
  return (
    <footer className="public-footer">
      <span>{t.brand}</span>
      <nav className="public-footer-nav" aria-label={t.footerNavigation}>
        {links.map((link) => (
          <a key={link.href} href={link.href}>
            {link.label}
          </a>
        ))}
      </nav>
      <span>{t.notBroker}</span>
      <span>{t.informationDisclaimer}</span>
    </footer>
  );
}
