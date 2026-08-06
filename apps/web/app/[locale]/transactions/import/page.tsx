import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { ImportWorkflow } from './import-workflow';

export default async function TransactionImportPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const ar = locale === 'ar';
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/${locale}/login`);
  const { data: portfolios } = await supabase
    .from('portfolios')
    .select('id,name')
    .order('created_at');
  return (
    <main className="shell" dir={ar ? 'rtl' : 'ltr'}>
      <nav className="nav">
        <span className="brand">BVC Portfolio</span>
        <a href={`/${locale}/dashboard`}>{ar ? 'لوحة المحفظة' : 'Tableau de bord'}</a>
      </nav>
      <section className="card">
        <h1>{ar ? 'استيراد عمليات CSV' : 'Importer des opérations CSV'}</h1>
        <p className="notice">
          {ar
            ? 'المعاينة لا تنشئ أي عملية. يتم التأكيد دفعة واحدة فقط بعد نجاح التحقق.'
            : 'La prévisualisation ne crée aucune opération. La confirmation est entièrement atomique après validation.'}
        </p>
        <ImportWorkflow locale={ar ? 'ar' : 'fr'} portfolios={portfolios ?? []} />
      </section>
    </main>
  );
}
