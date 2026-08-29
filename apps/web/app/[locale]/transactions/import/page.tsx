import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { asLocale, direction } from '@/lib/i18n';
import { SiteNav } from '@/components/site-nav';
import { ImportWorkflow } from './import-workflow';

const copy = {
  en: {
    title: 'Import transactions from CSV',
    notice: 'Previewing does not create transactions. Confirmation is atomic after validation.',
  },
  fr: {
    title: 'Importer des opérations CSV',
    notice:
      'La prévisualisation ne crée aucune opération. La confirmation est entièrement atomique après validation.',
  },
  ar: {
    title: 'استيراد عمليات CSV',
    notice: 'المعاينة لا تنشئ أي عملية. يتم التأكيد دفعة واحدة فقط بعد نجاح التحقق.',
  },
} as const;

export default async function TransactionImportPage({
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
  const { data: portfolios } = await supabase
    .from('portfolios')
    .select('id,name,tracking_mode')
    .eq('status', 'active')
    .order('created_at');
  return (
    <main className="app-shell" dir={direction(locale)}>
      <SiteNav locale={locale} authenticated />
      <section className="card" style={{ marginTop: 40 }}>
        <h1>{copy[locale].title}</h1>
        <p className="notice">{copy[locale].notice}</p>
        <ImportWorkflow locale={locale} portfolios={portfolios ?? []} />
      </section>
    </main>
  );
}
