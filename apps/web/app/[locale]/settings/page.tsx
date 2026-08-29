import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { asLocale, direction, getUi } from '@/lib/i18n';
import { SiteNav } from '@/components/site-nav';
import {
  archivePortfolio,
  createPortfolio,
  logout,
  renamePortfolio,
  restorePortfolio,
  updateProfileSettings,
} from '../auth-actions';

export default async function SettingsPage({
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
    <main className="app-shell" dir={direction(locale)}>
      <SiteNav locale={locale} authenticated />
      <div className="page-heading">
        <div>
          <p className="eyebrow">SaifInvest</p>
          <h1>{t.accountSettings}</h1>
        </div>
        <form action={logout}>
          <input type="hidden" name="locale" value={locale} />
          <button className="text-button" type="submit">
            {t.signOut}
          </button>
        </form>
      </div>

      {saved === '1' ? (
        <p className="notice success-notice" role="status">
          {t.saved}
        </p>
      ) : null}

      <div className="settings-grid">
        <section className="card">
          <p className="eyebrow">{t.profileSettings}</p>
          <h2>{t.profileSettings}</h2>
          <form className="form settings-form" action={updateProfileSettings}>
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
            <button className="button" type="submit">
              {t.saveChanges}
            </button>
          </form>
        </section>

        <section className="card">
          <p className="eyebrow">{t.portfolioManagement}</p>
          <h2>{t.createAnotherPortfolio}</h2>
          <p className="microcopy">{t.notBroker}</p>
          <form className="form settings-form" action={createPortfolio}>
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
            <button className="button" type="submit">
              {t.create}
            </button>
          </form>
        </section>

        <section className="card span-2">
          <p className="eyebrow">{t.portfolioManagement}</p>
          <h2>{t.portfolioManagement}</h2>
          <p className="microcopy">{t.archiveWarning}</p>
          <div className="portfolio-management-list">
            {(portfolios ?? []).map((portfolio) => (
              <article className="portfolio-management-row" key={portfolio.id}>
                <div>
                  <span
                    className={`mode-badge ${portfolio.tracking_mode === 'virtual' ? 'virtual' : ''}`}
                  >
                    {portfolio.tracking_mode === 'virtual' ? t.virtual : t.realTracking}
                  </span>
                  <small>{portfolio.status === 'active' ? t.activeStatus : t.archivedStatus}</small>
                </div>
                <form className="inline-form" action={renamePortfolio}>
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
                  <button className="button secondary compact" type="submit">
                    {t.renamePortfolio}
                  </button>
                </form>
                {portfolio.status === 'active' ? (
                  <form action={archivePortfolio}>
                    <input type="hidden" name="locale" value={locale} />
                    <input type="hidden" name="portfolioId" value={portfolio.id} />
                    <button className="text-button danger-link" type="submit">
                      {t.archivePortfolio}
                    </button>
                  </form>
                ) : (
                  <form action={restorePortfolio}>
                    <input type="hidden" name="locale" value={locale} />
                    <input type="hidden" name="portfolioId" value={portfolio.id} />
                    <button className="text-button" type="submit">
                      {t.restorePortfolio}
                    </button>
                  </form>
                )}
              </article>
            ))}
          </div>
        </section>
      </div>

      {dataAdminRole ? (
        <section className="card admin-shortcuts">
          <p className="eyebrow">Admin</p>
          <h2>Market data</h2>
          <div className="actions">
            <a className="button secondary compact" href={`/${locale}/admin/securities`}>
              Security master
            </a>
            <a className="button secondary compact" href={`/${locale}/admin/import`}>
              Price imports
            </a>
          </div>
        </section>
      ) : null}
    </main>
  );
}
