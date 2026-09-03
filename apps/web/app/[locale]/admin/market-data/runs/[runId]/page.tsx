import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { asLocale, direction, getUi } from '@/lib/i18n';
import { PublicNav } from '@/components/public/public-nav';
import { PublicFooter } from '@/components/public/public-footer';
import { AdminMarketDataRunDetail } from '@/components/admin-market-data-run-detail';

export default async function MarketDataRunDetailPage({
  params,
}: {
  params: Promise<{ locale: string; runId: string }>;
}) {
  const { locale: rawLocale, runId } = await params;
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

  const { data } = await supabase.rpc('get_market_ingestion_run', { p_run_id: runId });
  const run = Array.isArray(data) ? (data[0] ?? null) : (data ?? null);

  return (
    <main className="public-page admin-v2-page" dir={direction(locale)}>
      <PublicNav locale={locale} authenticated />
      <div className="admin-v2-hero">
        <div>
          <p className="public-eyebrow">{t.adminEyebrow}</p>
          <h1>{t.adminMarketDataTitle}</h1>
        </div>
        <a href={`/${locale}/admin/market-data`}>{t.adminMarketDataLink}</a>
      </div>
      <div className="admin-v2-body">
        <AdminMarketDataRunDetail locale={locale} runId={runId} initialRun={run} />
      </div>
      <PublicFooter locale={locale} authenticated />
    </main>
  );
}
