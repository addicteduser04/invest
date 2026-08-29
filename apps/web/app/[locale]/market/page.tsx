import type { Locale } from '@bvc/contracts';
import { createClient } from '@/lib/supabase/server';
import { asLocale, direction, getUi } from '@/lib/i18n';
import { SiteNav } from '@/components/site-nav';

const price = (value: string | null, locale: Locale) =>
  value
    ? new Intl.NumberFormat(locale === 'ar' ? 'ar-MA' : locale === 'fr' ? 'fr-MA' : 'en-MA', {
        style: 'currency',
        currency: 'MAD',
        maximumFractionDigits: 2,
      }).format(Number(value))
    : '—';

type SortMode = 'ticker' | 'change' | 'price';

export default async function MarketPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string; sector?: string; sort?: string; priced?: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = asLocale(rawLocale);
  const t = getUi(locale);
  const filters = await searchParams;
  const sort: SortMode =
    filters.sort === 'change' || filters.sort === 'price' ? filters.sort : 'ticker';
  const pricedOnly = filters.priced === '1';
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data } = await supabase
    .from('market_security_overview')
    .select(
      'id,name,ticker,sector,listing_status,is_synthetic,latest_market_date,latest_close_price,previous_close_price,daily_change_percent,latest_price_provisional,latest_provider_id',
    );
  const rows = (data ?? []).filter(
    (row) => row.listing_status === 'active' || row.listing_status === 'suspended',
  );
  const sectors = [...new Set(rows.map((row) => row.sector).filter(Boolean))].sort() as string[];
  const query = (filters.q ?? '').trim().toLowerCase();
  const selectedSector = filters.sector ?? '';
  const filtered = rows
    .filter((row) => {
      const matchesQuery =
        !query ||
        row.ticker.toLowerCase().includes(query) ||
        row.name.toLowerCase().includes(query) ||
        (row.sector ?? '').toLowerCase().includes(query);
      const matchesSector = !selectedSector || row.sector === selectedSector;
      const matchesAvailability = !pricedOnly || row.latest_close_price !== null;
      return matchesQuery && matchesSector && matchesAvailability;
    })
    .sort((a, b) => {
      if (sort === 'change') {
        const left =
          a.daily_change_percent === null
            ? Number.NEGATIVE_INFINITY
            : Number(a.daily_change_percent);
        const right =
          b.daily_change_percent === null
            ? Number.NEGATIVE_INFINITY
            : Number(b.daily_change_percent);
        return right - left || a.ticker.localeCompare(b.ticker);
      }
      if (sort === 'price') {
        const left =
          a.latest_close_price === null ? Number.NEGATIVE_INFINITY : Number(a.latest_close_price);
        const right =
          b.latest_close_price === null ? Number.NEGATIVE_INFINITY : Number(b.latest_close_price);
        return right - left || a.ticker.localeCompare(b.ticker);
      }
      return a.ticker.localeCompare(b.ticker);
    });

  return (
    <main className="app-shell" dir={direction(locale)}>
      <SiteNav locale={locale} authenticated={Boolean(user)} />
      <section className="market-hero">
        <div>
          <p className="eyebrow">Bourse de Casablanca</p>
          <h1>{t.marketTitle}</h1>
          <p className="lead">{t.marketSubtitle}</p>
        </div>
        <div className="market-stat">
          <strong>{filtered.length}</strong>
          <span>{t.security}</span>
        </div>
      </section>
      <p className="notice data-notice">
        {t.demo} {t.noFabricatedData}
      </p>

      <form className="filter-bar market-filters" method="get">
        <label className="search-field">
          <span className="sr-only">{t.search}</span>
          <input name="q" defaultValue={filters.q ?? ''} placeholder={t.search} />
        </label>
        <label>
          <span className="sr-only">{t.sector}</span>
          <select name="sector" defaultValue={selectedSector}>
            <option value="">{t.allSectors}</option>
            {sectors.map((sector) => (
              <option key={sector} value={sector}>
                {sector}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">{t.sortBy}</span>
          <select name="sort" defaultValue={sort}>
            <option value="ticker">{t.sortTicker}</option>
            <option value="change">{t.sortChange}</option>
            <option value="price">{t.sortPrice}</option>
          </select>
        </label>
        <label className="data-availability-check">
          <input type="checkbox" name="priced" value="1" defaultChecked={pricedOnly} />
          <span>{t.pricedOnly}</span>
        </label>
        <button className="button compact" type="submit">
          {t.search}
        </button>
      </form>

      <section className="market-list" aria-label={t.marketTitle}>
        <div className="market-list-head">
          <span>{t.security}</span>
          <span>{t.sector}</span>
          <span>{t.latestPrice}</span>
          <span>{t.dailyChange}</span>
          <span>{t.dataStatus}</span>
        </div>
        {filtered.length ? (
          filtered.map((security) => {
            const change =
              security.daily_change_percent === null ? null : Number(security.daily_change_percent);
            return (
              <a className="market-row" href={`/${locale}/market/${security.id}`} key={security.id}>
                <span className="security-name">
                  <strong>{security.ticker}</strong>
                  <small>{security.name}</small>
                </span>
                <span>{security.sector ?? '—'}</span>
                <span className="technical" dir="ltr">
                  {price(
                    security.latest_close_price ? String(security.latest_close_price) : null,
                    locale,
                  )}
                  <small>{security.latest_market_date ?? t.noPrice}</small>
                </span>
                <span
                  className={`technical ${change === null ? '' : change >= 0 ? 'positive' : 'negative'}`}
                  dir="ltr"
                >
                  {change === null ? '—' : `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`}
                </span>
                <span className="data-badges">
                  {security.is_synthetic ? <em>{t.synthetic}</em> : null}
                  {security.latest_price_provisional ? <em>{t.provisional}</em> : null}
                  {security.listing_status === 'suspended' ? <em>{t.suspendedStatus}</em> : null}
                </span>
              </a>
            );
          })
        ) : (
          <p className="empty-state">{t.noMarketResults}</p>
        )}
      </section>
    </main>
  );
}
