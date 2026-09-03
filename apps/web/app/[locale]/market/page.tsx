import type { Locale } from '@bvc/contracts';
import { asLocale, direction, getUi } from '@/lib/i18n';
import { createClient } from '@/lib/supabase/server';
import { MasiHeroChart, type IndexPoint } from '@/components/public/masi-hero-chart';
import { MarketTicker, type TickerItem } from '@/components/public/market-ticker';
import { PublicNav } from '@/components/public/public-nav';
import { PublicFooter } from '@/components/public/public-footer';
import { MiniSparkline, formatMoney } from '@/components/public/home-market-sections';

type SortMode = 'ticker' | 'change' | 'price';

interface SecurityRow {
  id: string;
  name: string;
  ticker: string;
  sector: string | null;
  listing_status: string;
  is_synthetic: boolean;
  latest_market_date: string | null;
  latest_close_price: string | null;
  daily_change_percent: string | number | null;
  latest_price_provisional: boolean | null;
}

interface IndexRow {
  id: string;
  code: string;
  name: string;
  family: string | null;
  latest_market_date: string | null;
  latest_close_value: string | null;
  daily_change_percent: string | number | null;
}

interface PriceHistoryRow {
  security_id: string;
  market_date: string;
  close_price: string;
  volume: string | null;
}

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
  const selectedSector = filters.sector ?? '';
  const pricedOnly = filters.priced === '1';
  const query = (filters.q ?? '').trim().toLowerCase();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [securitiesResult, indicesResult, masiHistoryResult] = await Promise.all([
    supabase
      .from('market_security_overview')
      .select(
        'id,name,ticker,sector,listing_status,is_synthetic,latest_market_date,latest_close_price,daily_change_percent,latest_price_provisional',
      )
      .in('listing_status', ['active', 'suspended'])
      .order('ticker'),
    supabase
      .from('market_index_overview')
      .select('id,code,name,family,latest_market_date,latest_close_value,daily_change_percent')
      .in('code', ['MASI', 'MSI20', 'ESGI', 'MASIMS'])
      .order('code'),
    supabase
      .from('market_index_history')
      .select('market_date,close_value')
      .eq('code', 'MASI')
      .order('market_date', { ascending: true })
      .limit(900),
  ]);

  const allSecurities = ((securitiesResult.data ?? []) as SecurityRow[]).filter(
    (security) => !security.is_synthetic,
  );
  const indices = (indicesResult.data ?? []) as IndexRow[];
  const masiHistory = (masiHistoryResult.data ?? []) as IndexPoint[];
  const sectors = [
    ...new Set(allSecurities.map((row) => row.sector).filter(Boolean)),
  ].sort() as string[];
  const visibleSecurities = sortSecurities(
    allSecurities.filter((security) => {
      const matchesQuery =
        !query ||
        security.ticker.toLowerCase().includes(query) ||
        security.name.toLowerCase().includes(query) ||
        (security.sector ?? '').toLowerCase().includes(query);
      const matchesSector = !selectedSector || security.sector === selectedSector;
      const matchesAvailability = !pricedOnly || security.latest_close_price !== null;
      return matchesQuery && matchesSector && matchesAvailability;
    }),
    sort,
  );
  const selectedIds = visibleSecurities.map((security) => security.id);
  const { data: priceRows } = selectedIds.length
    ? await supabase
        .from('market_price_history')
        .select('security_id,market_date,close_price,volume')
        .in('security_id', selectedIds)
        .order('market_date', { ascending: true })
    : { data: [] };

  const priceHistory = groupPriceHistory((priceRows ?? []) as PriceHistoryRow[]);
  const latestDate =
    allSecurities
      .flatMap((security) => (security.latest_market_date ? [security.latest_market_date] : []))
      .sort()
      .at(-1) ?? null;
  const masi = indices.find((index) => index.code === 'MASI');
  const tickerItems = buildTickerItems(locale, indices, allSecurities);
  const movers = buildMovers(allSecurities, priceHistory);

  return (
    <main className="public-page market-v2-page" dir={direction(locale)}>
      <PublicNav locale={locale} authenticated={Boolean(user)} />
      <MarketTicker locale={locale} items={tickerItems} />

      <section className="market-v2-hero">
        <div>
          <p className="public-eyebrow">{t.marketV2Eyebrow}</p>
          <h1>{t.marketV2Title}</h1>
          <p>{t.marketV2Subtitle}</p>
        </div>
        <div className="market-v2-hero-stats">
          <Metric label={t.totalListed} value={String(allSecurities.length)} />
          <Metric label={t.latestMarketDate} value={latestDate ?? '—'} />
          <Metric
            label="MASI"
            value={masi?.latest_close_value ? formatIndex(masi.latest_close_value, locale) : '—'}
          />
        </div>
      </section>

      <section className="market-v2-chart-block">
        <MasiHeroChart
          locale={locale}
          history={masiHistory}
          latestDate={masi?.latest_market_date ?? null}
        />
      </section>

      <section className="market-v2-indices" aria-label={t.indexOverviewTitle}>
        <div className="market-v2-section-head">
          <div>
            <p className="public-eyebrow">MASI</p>
            <h2>{t.indexOverviewTitle}</h2>
          </div>
          <span>{t.indexOverviewSubtitle}</span>
        </div>
        <div className="market-v2-index-strip">
          {indices.map((index) => (
            <article key={index.id}>
              <span>{index.code}</span>
              <strong className="technical" dir="ltr">
                {index.latest_close_value ? formatIndex(index.latest_close_value, locale) : '—'}
              </strong>
              <em className={movementClass(index.daily_change_percent)} dir="ltr">
                {formatPercent(index.daily_change_percent)}
              </em>
              <small>
                {index.name} · {index.latest_market_date ?? t.unavailable}
              </small>
            </article>
          ))}
        </div>
      </section>

      <section className="market-v2-movers" aria-label={t.marketMoversTitle}>
        <div className="market-v2-section-head">
          <div>
            <p className="public-eyebrow">{t.dailyChange}</p>
            <h2>{t.marketMoversTitle}</h2>
          </div>
        </div>
        <div className="market-v2-movers-grid">
          <MoversPanel title={t.topGainers} rows={movers.gainers} locale={locale} />
          <MoversPanel title={t.topLosers} rows={movers.losers} locale={locale} />
          {movers.active.length ? (
            <MoversPanel title={t.mostActive} rows={movers.active} locale={locale} />
          ) : null}
        </div>
      </section>

      <section className="market-v2-explorer" aria-label={t.equitiesExplorerTitle}>
        <div className="market-v2-section-head">
          <div>
            <p className="public-eyebrow">{t.navStocks}</p>
            <h2>{t.equitiesExplorerTitle}</h2>
          </div>
          <span>
            {visibleSecurities.length} / {allSecurities.length}
          </span>
        </div>

        <form className="market-v2-filters" method="get">
          <label>
            <span>{t.searchShort}</span>
            <input name="q" defaultValue={filters.q ?? ''} placeholder={t.search} />
          </label>
          <label>
            <span>{t.sector}</span>
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
            <span>{t.sortBy}</span>
            <select name="sort" defaultValue={sort}>
              <option value="ticker">{t.sortTicker}</option>
              <option value="change">{t.sortChange}</option>
              <option value="price">{t.sortPrice}</option>
            </select>
          </label>
          <label className="market-v2-check">
            <input type="checkbox" name="priced" value="1" defaultChecked={pricedOnly} />
            <span>{t.pricedOnly}</span>
          </label>
          <button type="submit">{t.searchShort}</button>
        </form>

        <div className="market-v2-table">
          <div className="market-v2-table-head">
            <span>{t.ticker}</span>
            <span>{t.security}</span>
            <span>{t.sector}</span>
            <span>{t.latestPrice}</span>
            <span>{t.dailyChange}</span>
            <span>{t.priceHistory}</span>
            <span>{t.dataStatus}</span>
          </div>
          {visibleSecurities.length ? (
            visibleSecurities.map((security) => (
              <a
                className="market-v2-row"
                href={`/${locale}/market/${security.id}`}
                key={security.id}
              >
                <span className="market-v2-symbol" dir="ltr">
                  {security.ticker}
                </span>
                <span className="market-v2-company">
                  <strong>{security.name}</strong>
                  <small>{security.latest_market_date ?? t.noPrice}</small>
                </span>
                <span>{security.sector ?? '—'}</span>
                <span className="technical market-v2-number" dir="ltr">
                  {formatMoney(security.latest_close_price, locale)}
                </span>
                <span
                  className={`technical market-v2-change ${movementClass(security.daily_change_percent)}`}
                  dir="ltr"
                >
                  {formatPercent(security.daily_change_percent)}
                </span>
                <MiniSparkline points={priceHistory.get(security.id)?.points ?? []} />
                <span className="market-v2-status">
                  {security.latest_price_provisional
                    ? t.provisional
                    : security.latest_close_price
                      ? t.priceCurrent
                      : t.unavailable}
                </span>
              </a>
            ))
          ) : (
            <p className="market-v2-empty">{t.noMarketResults}</p>
          )}
        </div>
      </section>

      <p className="market-v2-disclaimer">
        {t.demo} {t.noFabricatedData} {t.informationDisclaimer}
      </p>
      <PublicFooter locale={locale} authenticated={Boolean(user)} />
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <span>
      <small>{label}</small>
      <strong className="technical" dir="ltr">
        {value}
      </strong>
    </span>
  );
}

function MoversPanel({
  title,
  rows,
  locale,
}: {
  title: string;
  rows: SecurityRow[];
  locale: Locale;
}) {
  const t = getUi(locale);
  return (
    <article className="market-v2-movers-panel">
      <h3>{title}</h3>
      {rows.length ? (
        rows.map((security) => (
          <a href={`/${locale}/market/${security.id}`} key={security.id}>
            <span>
              <strong dir="ltr">{security.ticker}</strong>
              <small>{security.name}</small>
            </span>
            <span className="technical" dir="ltr">
              <b>{formatMoney(security.latest_close_price, locale)}</b>
              <em className={movementClass(security.daily_change_percent)}>
                {formatPercent(security.daily_change_percent)}
              </em>
            </span>
          </a>
        ))
      ) : (
        <p>{t.unavailable}</p>
      )}
    </article>
  );
}

function sortSecurities(rows: SecurityRow[], sort: SortMode) {
  return [...rows].sort((left, right) => {
    if (sort === 'change') {
      return (
        compareNullableNumber(right.daily_change_percent, left.daily_change_percent) ||
        left.ticker.localeCompare(right.ticker)
      );
    }
    if (sort === 'price') {
      return (
        compareNullableNumber(right.latest_close_price, left.latest_close_price) ||
        left.ticker.localeCompare(right.ticker)
      );
    }
    return (
      priorityRank(left.ticker) - priorityRank(right.ticker) ||
      left.ticker.localeCompare(right.ticker)
    );
  });
}

function priorityRank(ticker: string) {
  const rank = ['IAM', 'ATW', 'BCP'].indexOf(ticker);
  return rank === -1 ? 99 : rank;
}

function compareNullableNumber(left: string | number | null, right: string | number | null) {
  const leftNumber = left === null ? Number.NEGATIVE_INFINITY : Number(left);
  const rightNumber = right === null ? Number.NEGATIVE_INFINITY : Number(right);
  return leftNumber - rightNumber;
}

function groupPriceHistory(rows: PriceHistoryRow[]) {
  return rows.reduce((map, row) => {
    const current = map.get(row.security_id) ?? { points: [], latestVolume: null as number | null };
    current.points.push({ market_date: row.market_date, close_price: row.close_price });
    const volume = row.volume === null ? null : Number(row.volume);
    if (volume !== null && Number.isFinite(volume)) current.latestVolume = volume;
    map.set(row.security_id, current);
    return map;
  }, new Map<string, { points: Array<{ market_date: string; close_price: string }>; latestVolume: number | null }>());
}

function buildTickerItems(locale: Locale, indices: IndexRow[], securities: SecurityRow[]) {
  const indexItems: TickerItem[] = indices.map((index) => ({
    id: index.id,
    ticker: index.code,
    name: index.name,
    href: `/${locale}/market`,
    price: index.latest_close_value,
    changePercent: index.daily_change_percent,
    kind: 'index',
  }));
  const securityItems = sortSecurities(
    securities.filter((security) => security.latest_close_price !== null),
    'ticker',
  )
    .slice(0, 10)
    .map<TickerItem>((security) => ({
      id: security.id,
      ticker: security.ticker,
      name: security.name,
      href: `/${locale}/market/${security.id}`,
      price: security.latest_close_price,
      changePercent: security.daily_change_percent,
      kind: 'security',
    }));
  return [...indexItems, ...securityItems];
}

function buildMovers(
  securities: SecurityRow[],
  history: Map<
    string,
    { points: Array<{ market_date: string; close_price: string }>; latestVolume: number | null }
  >,
) {
  const priced = securities.filter(
    (security) =>
      security.latest_close_price !== null &&
      security.daily_change_percent !== null &&
      Number.isFinite(Number(security.daily_change_percent)),
  );
  const gainers = priced
    .filter((security) => Number(security.daily_change_percent) >= 0)
    .sort((left, right) => Number(right.daily_change_percent) - Number(left.daily_change_percent))
    .slice(0, 5);
  const losers = priced
    .filter((security) => Number(security.daily_change_percent) < 0)
    .sort((left, right) => Number(left.daily_change_percent) - Number(right.daily_change_percent))
    .slice(0, 5);
  const active = securities
    .filter((security) => history.get(security.id)?.latestVolume)
    .sort(
      (left, right) =>
        (history.get(right.id)?.latestVolume ?? 0) - (history.get(left.id)?.latestVolume ?? 0),
    )
    .slice(0, 5);
  return { gainers, losers, active };
}

function movementClass(value: string | number | null | undefined) {
  if (value === null || value === undefined) return '';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '';
  return numeric >= 0 ? 'positive' : 'negative';
}

function formatPercent(value: string | number | null | undefined) {
  if (value === null || value === undefined) return '—';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '—';
  return `${numeric >= 0 ? '+' : ''}${numeric.toFixed(2)}%`;
}

function formatIndex(value: string | number, locale: Locale) {
  return new Intl.NumberFormat(locale === 'ar' ? 'ar-MA' : locale === 'fr' ? 'fr-MA' : 'en-MA', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  }).format(Number(value));
}
