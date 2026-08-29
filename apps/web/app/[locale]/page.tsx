import { createClient } from '@/lib/supabase/server';
import { asLocale, direction, getUi } from '@/lib/i18n';
import { SiteNav } from '@/components/site-nav';

export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: rawLocale } = await params;
  const locale = asLocale(rawLocale);
  const t = getUi(locale);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: securities } = await supabase
    .from('market_security_overview')
    .select('id,ticker,name,sector,latest_close_price,daily_change_percent,is_synthetic')
    .eq('listing_status', 'active')
    .order('ticker')
    .limit(6);
  return (
    <main className="app-shell" dir={direction(locale)}>
      <SiteNav locale={locale} authenticated={Boolean(user)} />
      <section className="landing-hero">
        <div className="landing-copy">
          <p className="eyebrow">{t.tagline}</p>
          <h1>{t.heroTitle}</h1>
          <p className="lead">{t.heroSubtitle}</p>
          <p className="broker-boundary">{t.notBroker}</p>
          <div className="actions">
            <a className="button" href={user ? `/${locale}/dashboard` : `/${locale}/register`}>
              {user ? t.dashboard : t.createAccount}
            </a>
            <a className="button secondary" href={`/${locale}/market`}>
              {t.market}
            </a>
          </div>
        </div>
        <div className="hero-terminal" aria-label={t.portfolioTitle}>
          <div className="terminal-topline">
            <span>SAIFINVEST</span>
            <span>BVC / MAD</span>
          </div>
          <div className="terminal-value">
            <small>{t.totalValue}</small>
            <strong>— MAD</strong>
          </div>
          <div className="terminal-grid">
            <div>
              <small>{t.cash}</small>
              <strong>—</strong>
            </div>
            <div>
              <small>{t.securitiesValue}</small>
              <strong>—</strong>
            </div>
            <div>
              <small>{t.totalGain}</small>
              <strong>—</strong>
            </div>
          </div>
          <div className="terminal-lines">
            <i></i>
            <i></i>
            <i></i>
            <i></i>
            <i></i>
            <i></i>
            <i></i>
          </div>
          <p>{t.noFabricatedData}</p>
        </div>
      </section>

      <section className="feature-strip">
        <article>
          <span>01</span>
          <h2>{t.dashboard}</h2>
          <p>{t.realTrackingHint}</p>
        </article>
        <article>
          <span>02</span>
          <h2>{t.performance}</h2>
          <p>
            {t.twr} · {t.xirr}
          </p>
        </article>
        <article>
          <span>03</span>
          <h2>{t.market}</h2>
          <p>{t.marketSubtitle}</p>
        </article>
      </section>

      <section className="landing-market">
        <div className="section-heading">
          <div>
            <p className="eyebrow">BVC</p>
            <h2>{t.marketTitle}</h2>
          </div>
          <a className="text-link" href={`/${locale}/market`}>
            {t.market} →
          </a>
        </div>
        <div className="security-preview-grid">
          {(securities ?? []).map((security) => {
            const change =
              security.daily_change_percent === null ? null : Number(security.daily_change_percent);
            return (
              <a
                className="security-preview"
                key={security.id}
                href={`/${locale}/market/${security.id}`}
              >
                <div>
                  <strong>{security.ticker}</strong>
                  <small>{security.sector ?? '—'}</small>
                </div>
                <div className="technical" dir="ltr">
                  <strong>
                    {security.latest_close_price
                      ? `${Number(security.latest_close_price).toFixed(2)} MAD`
                      : '—'}
                  </strong>
                  <small className={change === null ? '' : change >= 0 ? 'positive' : 'negative'}>
                    {change === null ? t.noPrice : `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`}
                  </small>
                </div>
              </a>
            );
          })}
        </div>
      </section>
      <p className="notice data-notice">{t.demo}</p>
      <footer>
        © 2026 SaifInvest · {t.notBroker} · {t.informationDisclaimer}
      </footer>
    </main>
  );
}
