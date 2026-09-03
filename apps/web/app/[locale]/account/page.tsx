import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { asLocale, direction, getUi } from '@/lib/i18n';
import { PublicNav } from '@/components/public/public-nav';
import { PublicFooter } from '@/components/public/public-footer';
import {
  archivePortfolio,
  createPortfolio,
  logout,
  renamePortfolio,
  restorePortfolio,
  updateProfileSettings,
} from '../auth-actions';

export default async function AccountPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const { locale: rawLocale } = await params;
  const { saved } = await searchParams;
  const locale = asLocale(rawLocale);
  const t = getUi(locale);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/${locale}/login`);

  const [{ data: profile }, { data: portfolios }, { data: dataAdminRole }] = await Promise.all([
    supabase.from('profiles').select('display_name,locale').eq('id', user.id).maybeSingle(),
    supabase
      .from('portfolios')
      .select('id,name,tracking_mode,status,created_at')
      .order('created_at', { ascending: true }),
    supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('role', 'data_admin')
      .maybeSingle(),
  ]);

  return (
    <main className="public-page account-v2-page" dir={direction(locale)}>
      <PublicNav locale={locale} authenticated />

      <section className="account-v2-hero">
        <div>
          <p className="public-eyebrow">{t.account}</p>
          <h1>{t.accountSettings}</h1>
          <p>{t.notBroker}</p>
        </div>
        <form action={logout}>
          <input type="hidden" name="locale" value={locale} />
          <button className="account-v2-signout" type="submit">
            {t.signOut}
          </button>
        </form>
      </section>

      {saved === '1' ? (
        <div className="account-v2-success">
          <p role="status">{t.saved}</p>
        </div>
      ) : null}

      <div className="account-v2-grid">
        <section className="account-v2-panel">
          <p className="public-eyebrow">{t.profileSettings}</p>
          <h2>{t.profileSettings}</h2>
          <form className="account-v2-form" action={updateProfileSettings}>
            <input type="hidden" name="currentLocale" value={locale} />
            <label>
              {t.name}
              <input
                name="displayName"
                defaultValue={profile?.display_name ?? ''}
                maxLength={120}
                autoComplete="name"
              />
            </label>
            <label>
              {t.email}
              <input value={user.email ?? ''} disabled readOnly dir="ltr" />
            </label>
            <label>
              {t.preferredLanguage}
              <select name="preferredLocale" defaultValue={profile?.locale ?? locale}>
                <option value="en">English</option>
                <option value="fr">Français</option>
                <option value="ar">العربية</option>
              </select>
            </label>
            <button type="submit">{t.saveChanges}</button>
          </form>
        </section>

        <section className="account-v2-panel">
          <p className="public-eyebrow">{t.portfolioManagement}</p>
          <h2>{t.createAnotherPortfolio}</h2>
          <p className="account-v2-microcopy">{t.notBroker}</p>
          <form className="account-v2-form" action={createPortfolio}>
            <input type="hidden" name="locale" value={locale} />
            <label>
              {t.portfolioName}
              <input required name="name" maxLength={100} />
            </label>
            <label>
              {t.trackingMode}
              <select name="trackingMode" defaultValue="real_tracking">
                <option value="real_tracking">{t.realTracking}</option>
                <option value="virtual">{t.virtual}</option>
              </select>
            </label>
            <button type="submit">{t.create}</button>
          </form>
        </section>

        <section className="account-v2-panel span-2">
          <p className="public-eyebrow">{t.portfolioManagement}</p>
          <h2>{t.portfolioManagement}</h2>
          <p className="account-v2-microcopy">{t.archiveWarning}</p>
          <div className="account-v2-portfolio-list">
            {(portfolios ?? []).map((portfolio) => (
              <article className="account-v2-portfolio-row" key={portfolio.id}>
                <div>
                  <span
                    className={`account-v2-mode-badge ${portfolio.tracking_mode === 'virtual' ? 'virtual' : ''}`}
                  >
                    {portfolio.tracking_mode === 'virtual' ? t.virtual : t.realTracking}
                  </span>
                  <small>{portfolio.status === 'active' ? t.activeStatus : t.archivedStatus}</small>
                </div>
                <form className="account-v2-inline-form" action={renamePortfolio}>
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="portfolioId" value={portfolio.id} />
                  <label className="sr-only" htmlFor={`portfolio-${portfolio.id}`}>
                    {t.renamePortfolio}
                  </label>
                  <input
                    id={`portfolio-${portfolio.id}`}
                    name="name"
                    defaultValue={portfolio.name}
                    maxLength={100}
                    required
                  />
                  <button type="submit">{t.renamePortfolio}</button>
                </form>
                {portfolio.status === 'active' ? (
                  <form action={archivePortfolio}>
                    <input type="hidden" name="locale" value={locale} />
                    <input type="hidden" name="portfolioId" value={portfolio.id} />
                    <button className="account-v2-text-button danger" type="submit">
                      {t.archivePortfolio}
                    </button>
                  </form>
                ) : (
                  <form action={restorePortfolio}>
                    <input type="hidden" name="locale" value={locale} />
                    <input type="hidden" name="portfolioId" value={portfolio.id} />
                    <button className="account-v2-text-button" type="submit">
                      {t.restorePortfolio}
                    </button>
                  </form>
                )}
              </article>
            ))}
          </div>
        </section>

        <section className="account-v2-panel span-2">
          <p className="public-eyebrow">{t.transactions}</p>
          <h2>{t.transactions}</h2>
          <div className="account-v2-links-row">
            <a href={`/${locale}/dashboard`}>{t.dashboard}</a>
            <a href={`/${locale}/transactions`}>{t.viewAll}</a>
            <a href={`/${locale}/transactions/new`}>{t.recordTransaction}</a>
            <a href={`/${locale}/transactions/import`}>{t.import}</a>
          </div>
        </section>

        {dataAdminRole ? (
          <section className="account-v2-panel span-2">
            <p className="public-eyebrow">{t.adminEyebrow}</p>
            <h2>{t.adminPriceImportsTitle}</h2>
            <div className="account-v2-links-row">
              <a href={`/${locale}/admin/securities`}>{t.adminSecurityMasterLink}</a>
              <a href={`/${locale}/admin/import`}>{t.adminPriceImportsLink}</a>
              <a href={`/${locale}/admin/market-data`}>{t.adminMarketDataLink}</a>
            </div>
          </section>
        ) : null}
      </div>

      <PublicFooter locale={locale} authenticated />
    </main>
  );
}
