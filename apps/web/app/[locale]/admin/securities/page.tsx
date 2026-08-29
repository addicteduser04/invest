import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { asLocale, direction } from '@/lib/i18n';
import { SiteNav } from '@/components/site-nav';
import { AdminSecurityImport, type AdminSecurityRow } from '@/components/admin-security-import';

const copy = {
  en: { title: 'Security master administration', prices: 'Price imports' },
  fr: { title: 'Administration du référentiel titres', prices: 'Imports de cours' },
  ar: { title: 'إدارة مرجع الأوراق المالية', prices: 'استيراد الأسعار' },
} as const;

export default async function SecurityAdminPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = asLocale(rawLocale);
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
    <main className="app-shell" dir={direction(locale)}>
      <SiteNav locale={locale} authenticated />
      <div className="page-heading">
        <div>
          <p className="eyebrow">Admin</p>
          <h1>{copy[locale].title}</h1>
        </div>
        <a className="button secondary compact" href={`/${locale}/admin/import`}>
          {copy[locale].prices}
        </a>
      </div>
      <AdminSecurityImport locale={locale} rows={(rows ?? []) as AdminSecurityRow[]} />
    </main>
  );
}
