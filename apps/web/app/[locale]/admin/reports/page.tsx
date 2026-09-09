import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { asLocale, direction, getUi } from '@/lib/i18n';
import { PublicNav } from '@/components/public/public-nav';
import { PublicFooter } from '@/components/public/public-footer';
import { AdminReports, type AdminReportsProps } from '@/components/admin-reports';

export default async function ReportsAdminPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = asLocale(rawLocale);
  const t = getUi(locale);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/${locale}/login`);
  const { data: role } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id)
    .eq('role', 'data_admin')
    .maybeSingle();
  if (!role) redirect(`/${locale}/dashboard`);

  const [statsResult, runsResult, ambiguousResult, issuersResult] = await Promise.all([
    supabase.rpc('company_documents_coverage_stats'),
    supabase.rpc('list_document_sync_runs'),
    supabase.rpc('list_ambiguous_document_issuers'),
    supabase
      .from('issuer_directory')
      .select(
        'id,name,slug,equity_listing_status,issuer_type,ammc_issuer_id,security_id,security_ticker',
      )
      .order('name'),
  ]);

  return (
    <main className="public-page admin-v2-page" dir={direction(locale)}>
      <PublicNav locale={locale} authenticated />
      <div className="admin-v2-hero">
        <div>
          <p className="public-eyebrow">{t.adminEyebrow}</p>
          <h1>{t.adminReportsTitle}</h1>
          <p className="admin-v2-subtitle">{t.adminReportsSubtitle}</p>
        </div>
        <a href={`/${locale}/admin/securities`}>{t.adminSecurityMasterLink}</a>
        <a href={`/${locale}/admin/market-data`}>{t.adminMarketDataLink}</a>
        <a href={`/${locale}/admin/fundamentals`}>{t.adminFundamentalsLink}</a>
        <a href={`/${locale}/admin/import`}>{t.adminPriceImportsLink}</a>
      </div>
      <div className="admin-v2-body">
        <AdminReports
          locale={locale}
          stats={statsResult.data as AdminReportsProps['stats']}
          runs={(runsResult.data ?? []) as AdminReportsProps['runs']}
          ambiguous={(ambiguousResult.data ?? []) as AdminReportsProps['ambiguous']}
          issuers={(issuersResult.data ?? []) as AdminReportsProps['issuers']}
        />
      </div>
      <PublicFooter locale={locale} authenticated />
    </main>
  );
}
