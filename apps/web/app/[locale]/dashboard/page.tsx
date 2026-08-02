import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { addTransaction, createPortfolio } from '../auth-actions';
export default async function Dashboard({ params }: { params: Promise<{ locale: string }> }) {
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
  const first = portfolios?.[0];
  const { data: securities } = await supabase.from('security_directory').select('id,ticker,name');
  return (
    <main className="shell" dir={ar ? 'rtl' : 'ltr'}>
      <nav className="nav">
        <span className="brand">BVC Portfolio</span>
        <span className="pill">{ar ? 'بيانات اصطناعية' : 'Données synthétiques'}</span>
      </nav>
      <h1>{ar ? 'لوحة المحفظة' : 'Tableau de bord'}</h1>
      {!first ? (
        <section className="card">
          <h2>{ar ? 'أنشئ محفظتك الأولى' : 'Créez votre premier portefeuille'}</h2>
          <form className="form" action={createPortfolio}>
            <input type="hidden" name="locale" value={locale} />
            <input required name="name" placeholder={ar ? 'اسم المحفظة' : 'Nom du portefeuille'} />
            <button className="button">{ar ? 'إنشاء' : 'Créer'}</button>
          </form>
        </section>
      ) : (
        <>
          <section className="card">
            <h2>{first.name}</h2>
            <p className="notice">
              {ar
                ? 'أضف إيداعاً أولاً، ثم سجّل عملية شراء. يتم احتساب التقييم بواسطة العامل غير المتزامن.'
                : 'Ajoutez d’abord un dépôt, puis enregistrez un achat. La valorisation est calculée par le worker asynchrone.'}
            </p>
            <form className="form" action={addTransaction}>
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="portfolioId" value={first.id} />
              <select name="type" defaultValue="deposit">
                <option value="deposit">{ar ? 'إيداع نقدي' : 'Dépôt'}</option>
                <option value="buy">{ar ? 'شراء أسهم' : 'Achat'}</option>
              </select>
              <label>
                {ar ? 'المبلغ بالدرهم' : 'Montant MAD'}
                <input name="amount" inputMode="decimal" pattern="\d+(\.\d+)?" />
              </label>
              <label>
                {ar ? 'السهم (للشراء)' : 'Titre (pour un achat)'}
                <select name="securityId">
                  <option value="">—</option>
                  {securities?.map((security) => (
                    <option key={security.id} value={security.id}>
                      {security.ticker} — {security.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {ar ? 'الكمية' : 'Quantité'}
                <input name="quantity" inputMode="decimal" pattern="\d+(\.\d+)?" />
              </label>
              <label>
                {ar ? 'سعر الوحدة' : 'Prix unitaire MAD'}
                <input name="unitPrice" inputMode="decimal" pattern="\d+(\.\d+)?" />
              </label>
              <label>
                {ar ? 'الرسوم' : 'Frais MAD'}
                <input name="fees" defaultValue="0" inputMode="decimal" />
              </label>
              <button className="button">{ar ? 'تسجيل' : 'Enregistrer'}</button>
            </form>
          </section>
        </>
      )}
    </main>
  );
}
