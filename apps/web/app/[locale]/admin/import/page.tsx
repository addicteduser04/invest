import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { asLocale, direction, getUi } from '@/lib/i18n';
import { PublicNav } from '@/components/public/public-nav';
import { PublicFooter } from '@/components/public/public-footer';
import { AdminMarketImport } from '@/components/admin-market-import';

export default async function ImportPage({ params }: { params: Promise<{ locale: string }> }) {
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
  const { data: runs } = await supabase.rpc('list_market_price_imports');
  return (
    <main className="public-page admin-v2-page" dir={direction(locale)}>
      <PublicNav locale={locale} authenticated />
      <div className="admin-v2-hero">
        <div>
          <p className="public-eyebrow">{t.adminEyebrow}</p>
          <h1>{t.adminPriceImportsTitle}</h1>
        </div>
        <a href={`/${locale}/admin/securities`}>{t.adminSecurityMasterLink}</a>
        <a href={`/${locale}/admin/market-data`}>{t.adminMarketDataLink}</a>
        <a href={`/${locale}/admin/fundamentals`}>{t.adminFundamentalsLink}</a>
      </div>
      <p className="admin-v2-notice">{t.adminPriceImportsNotice}</p>
      <div className="admin-v2-body">
        <AdminMarketImport
          locale={locale}
          currentUserId={user.id}
          bvcTestingEnabled={process.env.BVC_PUBLIC_TESTING_ENABLED === 'true'}
          runs={
            (runs ?? []) as {
              id: string;
              status: string;
              source_hash: string;
              original_object_path: string;
              proposed_by: string;
              reviewed_by: string | null;
              created_at: string;
              published_at: string | null;
              candidate_count: number;
              validation_report?: { errors?: string[]; warnings?: string[] } | null;
            }[]
          }
        />
      </div>
      <PublicFooter locale={locale} authenticated />
    </main>
  );
}
