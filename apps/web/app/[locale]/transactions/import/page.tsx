import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { asLocale, direction, getUi } from '@/lib/i18n';
import { PublicNav } from '@/components/public/public-nav';
import { PublicFooter } from '@/components/public/public-footer';
import { ImportWorkflow } from './import-workflow';

export default async function TransactionImportPage({
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
  const { data: portfolios } = await supabase
    .from('portfolios')
    .select('id,name,tracking_mode')
    .eq('status', 'active')
    .order('created_at');
  return (
    <main className="public-page admin-v2-page" dir={direction(locale)}>
      <PublicNav locale={locale} authenticated />
      <div className="admin-v2-hero">
        <div>
          <p className="public-eyebrow">{t.transactions}</p>
          <h1>{t.importTransactionsTitle}</h1>
        </div>
      </div>
      <p className="admin-v2-notice">{t.importTransactionsNotice}</p>
      <div className="admin-v2-body">
        <ImportWorkflow locale={locale} portfolios={portfolios ?? []} />
      </div>
      <PublicFooter locale={locale} authenticated />
    </main>
  );
}
