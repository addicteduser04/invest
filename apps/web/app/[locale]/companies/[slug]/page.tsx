import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { asLocale, direction, getUi } from '@/lib/i18n';
import { PublicNav } from '@/components/public/public-nav';
import { PublicFooter } from '@/components/public/public-footer';
import { SecurityAnnualReportsSection } from '@/components/security-annual-reports-section';
import { IssuerFundamentalsSection } from '@/components/issuer-fundamentals-section';
import { readIssuerBySlug } from '@/lib/issuer-read';
import { readIssuerAnnualReports } from '@/lib/reports-read';
import { readIssuerFundamentals } from '@/lib/issuer-fundamentals-read';

export default async function CompanyDetailPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale: rawLocale, slug } = await params;
  const locale = asLocale(rawLocale);
  const t = getUi(locale);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const issuer = await readIssuerBySlug(slug);
  if (!issuer) notFound();

  const [reports, fundamentals] = await Promise.all([
    readIssuerAnnualReports(issuer.id),
    readIssuerFundamentals(issuer.id),
  ]);

  const isListed = issuer.equityListingStatus === 'listed_bvc' && issuer.securityId;
  const isForeign = issuer.issuerType === 'foreign_issuer';
  const isHistorical = issuer.equityListingStatus === 'historical_or_delisted';

  return (
    <main className="public-page security-v2-page" dir={direction(locale)}>
      <PublicNav locale={locale} authenticated={Boolean(user)} />

      <section className="security-v2-hero">
        <div className="security-v2-identity">
          <a className="security-v2-back" href={`/${locale}/companies`}>
            {t.companiesBackToDirectory}
          </a>
          <p className="public-eyebrow">{issuer.sector ?? t.companiesEyebrow}</p>
          <h1>{issuer.name}</h1>
          <div className="security-v2-badges">
            {isListed ? (
              <span>
                {t.companiesListedBadge} · {issuer.securityTicker}
              </span>
            ) : (
              <span>{t.companiesNotListedBadge}</span>
            )}
            {isForeign ? <span>{t.companiesForeignBadge}</span> : null}
            {isHistorical ? <span>{t.companiesHistoricalBadge}</span> : null}
            {issuer.countryName ? <span>{issuer.countryName}</span> : null}
          </div>
        </div>
        {isListed ? (
          <a className="button" href={`/${locale}/market/${issuer.securityId}`}>
            {t.companiesViewSecurity}
          </a>
        ) : null}
      </section>

      <section className="security-v2-info">
        <div>
          <p className="public-eyebrow">{t.companiesOverviewEyebrow}</p>
          <h2>{issuer.name}</h2>
          <p>{isListed ? t.noFabricatedData : t.companiesMarketDataUnavailable}</p>
        </div>
        <dl>
          <div>
            <dt>{t.sector}</dt>
            <dd>{issuer.sector ?? '—'}</dd>
          </div>
          {issuer.countryName ? (
            <div>
              <dt>{t.companiesCountry}</dt>
              <dd>{issuer.countryName}</dd>
            </div>
          ) : null}
          {isListed ? (
            <div>
              <dt>{t.ticker}</dt>
              <dd dir="ltr">{issuer.securityTicker}</dd>
            </div>
          ) : null}
        </dl>
      </section>

      <IssuerFundamentalsSection locale={locale} fundamentals={fundamentals} />

      <SecurityAnnualReportsSection locale={locale} reports={reports} />

      <PublicFooter locale={locale} authenticated={Boolean(user)} />
    </main>
  );
}
