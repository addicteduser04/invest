import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { asLocale, direction, getUi } from '@/lib/i18n';
import { PublicNav } from '@/components/public/public-nav';
import { PublicFooter } from '@/components/public/public-footer';
import { AdminSecurityImport, type AdminSecurityRow } from '@/components/admin-security-import';

export default async function SecurityAdminPage({
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
  const { data: rows } = await supabase.rpc('list_market_security_master_admin');
  return (
    <main className="public-page admin-v2-page" dir={direction(locale)}>
      <PublicNav locale={locale} authenticated />
      <div className="admin-v2-hero">
        <div>
          <p className="public-eyebrow">{t.adminEyebrow}</p>
          <h1>{t.adminSecurityMasterTitle}</h1>
        </div>
        <a href={`/${locale}/admin/import`}>{t.adminPriceImportsLink}</a>
        <a href={`/${locale}/admin/market-data`}>{t.adminMarketDataLink}</a>
      </div>
      <div className="admin-v2-body">
        <AdminSecurityImport locale={locale} rows={(rows ?? []) as AdminSecurityRow[]} />
      </div>
      <PublicFooter locale={locale} authenticated />
    </main>
  );
}
