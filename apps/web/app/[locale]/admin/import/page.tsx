import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { asLocale, direction } from '@/lib/i18n';
import { SiteNav } from '@/components/site-nav';
import { AdminMarketImport } from '@/components/admin-market-import';

const copy = {
  en: {
    title: 'Market data administration',
    notice:
      'CSV files are validated and stored privately. Publication requires a distinct second data administrator.',
  },
  fr: {
    title: 'Administration des données de marché',
    notice:
      'Les fichiers CSV sont validés et conservés de façon privée. La publication exige un second administrateur données distinct.',
  },
  ar: {
    title: 'إدارة بيانات السوق',
    notice: 'يتم التحقق من ملفات CSV وحفظها بشكل خاص. يتطلب النشر مسؤول بيانات ثانياً مختلفاً.',
  },
} as const;

export default async function ImportPage({ params }: { params: Promise<{ locale: string }> }) {
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
  const { data: runs } = await supabase.rpc('list_market_price_imports');
  return (
    <main className="app-shell" dir={direction(locale)}>
      <SiteNav locale={locale} authenticated />
      <div className="page-heading">
        <div>
          <p className="eyebrow">Admin</p>
          <h1>{copy[locale].title}</h1>
        </div>
        <a className="button secondary compact" href={`/${locale}/admin/securities`}>
          Security master
        </a>
      </div>
      <p className="notice">{copy[locale].notice}</p>
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
    </main>
  );
}
