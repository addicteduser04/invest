'use client';

import { usePathname } from 'next/navigation';
import type { Locale } from '@bvc/contracts';

export function LocaleSwitcher({ locale, label }: { locale: Locale; label: string }) {
  const pathname = usePathname();
  const hrefFor = (nextLocale: Locale) => {
    const segments = pathname.split('/');
    if (segments[1] === 'en' || segments[1] === 'fr' || segments[1] === 'ar')
      segments[1] = nextLocale;
    else segments.splice(1, 0, nextLocale);
    return segments.join('/') || `/${nextLocale}`;
  };
  return (
    <div className="locale-switch" aria-label={label}>
      {(['en', 'fr', 'ar'] as const).map((language) => {
        const href = hrefFor(language);
        return (
          <a
            key={language}
            href={href}
            aria-current={language === locale ? 'page' : undefined}
            onClick={(event) => {
              document.cookie = `saif_locale=${language}; Max-Age=31536000; Path=/; SameSite=Lax`;
              if (window.location.search) {
                event.preventDefault();
                window.location.assign(`${href}${window.location.search}`);
              }
            }}
          >
            {language.toUpperCase()}
          </a>
        );
      })}
    </div>
  );
}
