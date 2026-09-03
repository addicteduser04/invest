import { redirect } from 'next/navigation';
import { resolveIngestionProvider } from '@bvc/market-ingestion';
import { createClient } from '@/lib/supabase/server';
import { asLocale, direction, getUi } from '@/lib/i18n';
import { PublicNav } from '@/components/public/public-nav';
import { PublicFooter } from '@/components/public/public-footer';
import { AdminMarketData } from '@/components/admin-market-data';

export default async function MarketDataAdminPage({
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

  const [{ data: snapshot }, { data: runs }] = await Promise.all([
    supabase.rpc('get_market_data_operational_snapshot'),
    supabase.rpc('list_market_ingestion_runs', { p_limit: 20 }),
  ]);

  let provider: { id: string | null; error: string | null } = { id: null, error: null };
  try {
    provider = { id: resolveIngestionProvider(process.env).providerId, error: null };
  } catch (error) {
    provider = { id: null, error: error instanceof Error ? error.message : 'PROVIDER_UNAVAILABLE' };
  }

  return (
    <main className="public-page admin-v2-page" dir={direction(locale)}>
      <PublicNav locale={locale} authenticated />
      <div className="admin-v2-hero">
        <div>
          <p className="public-eyebrow">{t.adminEyebrow}</p>
          <h1>{t.adminMarketDataTitle}</h1>
        </div>
        <a href={`/${locale}/admin/securities`}>{t.adminSecurityMasterLink}</a>
        <a href={`/${locale}/admin/import`}>{t.adminPriceImportsLink}</a>
      </div>
      <p className="admin-v2-notice">{t.adminMarketDataNotice}</p>
      <div className="admin-v2-body">
        <AdminMarketData
          locale={locale}
          initialSnapshot={snapshot ?? null}
          initialRuns={runs ?? []}
          provider={provider}
        />
      </div>
      <PublicFooter locale={locale} authenticated />
    </main>
  );
}
