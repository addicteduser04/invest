import { asLocale, direction } from '@/lib/i18n';

export default async function LocaleLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}>) {
  const { locale: rawLocale } = await params;
  const locale = asLocale(rawLocale);
  return (
    <div lang={locale} dir={direction(locale)} className="locale-root">
      {children}
    </div>
  );
}
