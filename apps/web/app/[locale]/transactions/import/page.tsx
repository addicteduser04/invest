import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

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
        <form
          className="form"
          action="/api/transaction-imports/preview"
          method="post"
          encType="multipart/form-data"
        >
          <input type="hidden" name="locale" value={locale} />
          <label>
            {ar ? 'المحفظة' : 'Portefeuille'}
            <select required name="portfolioId">
              {portfolios?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {ar ? 'ملف CSV الأصلي' : 'Fichier CSV original'}
            <input required type="file" name="file" accept=".csv,text/csv" />
          </label>
          {[
            ['date', 'date'],
            ['type', 'type'],
            ['security', 'security'],
            ['quantity', 'quantity'],
            ['unitPrice', 'value'],
            ['fees', 'fees'],
            ['taxes', 'taxes'],
            ['currency', 'currency'],
            ['externalReference', 'reference'],
            ['description', 'description'],
          ].map(([name, value]) => (
            <label key={name}>
              {ar ? `عمود ${name}` : `Colonne ${name}`}
              <input
                required={['date', 'type', 'externalReference'].includes(name!)}
                name={name}
                defaultValue={value}
              />
            </label>
          ))}
          <button className="button">{ar ? 'رفع ومعاينة' : 'Téléverser et prévisualiser'}</button>
        </form>
        <p>
          {ar
            ? 'تعرض الاستجابة الصفوف الصالحة والأخطاء والتحذيرات والمكررات وإمكانية التأكيد.'
            : 'La réponse affiche les lignes valides, erreurs, avertissements, doublons et l’autorisation de confirmer.'}
        </p>
      </section>
    </main>
  );
}
