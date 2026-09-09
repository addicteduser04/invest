import { createClient } from '@/lib/supabase/server';
import { asLocale, direction, getUi } from '@/lib/i18n';
import { PublicNav } from '@/components/public/public-nav';
import { PublicFooter } from '@/components/public/public-footer';
import { CompanyDirectory } from '@/components/company-directory';
import { listIssuers } from '@/lib/issuer-read';

export default async function CompaniesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: rawLocale } = await params;
  const locale = asLocale(rawLocale);
  const t = getUi(locale);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const issuers = await listIssuers();

  return (
    <main className="public-page market-v2-page" dir={direction(locale)}>
      <PublicNav locale={locale} authenticated={Boolean(user)} />
      <section className="market-v2-hero">
        <div>
          <p className="public-eyebrow">{t.companiesEyebrow}</p>
          <h1>{t.companiesTitle}</h1>
          <p className="admin-v2-subtitle">{t.companiesSubtitle}</p>
        </div>
      </section>
      <section className="market-v2-explorer">
        <CompanyDirectory locale={locale} issuers={issuers} />
      </section>
      <PublicFooter locale={locale} authenticated={Boolean(user)} />
    </main>
  );
}
