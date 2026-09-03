import type { Locale } from '@bvc/contracts';
import { asLocale, direction, getUi } from '@/lib/i18n';
import { createClient } from '@/lib/supabase/server';
import { MarketTicker, type TickerItem } from '@/components/public/market-ticker';
import { PublicNav } from '@/components/public/public-nav';
import { PublicFooter } from '@/components/public/public-footer';
import { MiniSparkline, formatMoney } from '@/components/public/home-market-sections';

type SortMode = 'ticker' | 'name' | 'price' | 'change' | 'volume';
type MovementFilter = 'all' | 'gainers' | 'losers';

interface SecurityRow {
  id: string;
  name: string;
  ticker: string;
  sector: string | null;
  listing_status: string;
  is_synthetic: boolean;
  latest_market_date: string | null;
  latest_close_price: string | null;
  previous_close_price: string | null;
  daily_change_percent: string | number | null;
  latest_price_provisional: boolean | null;
}

interface IndexRow {
  id: string;
  code: string;
  name: string;
  latest_close_value: string | null;
  daily_change_percent: string | number | null;
}

interface PriceHistoryRow {
  security_id: string;
  market_date: string;
  close_price: string;
  volume: string | null;
}

export default async function StocksPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{
    q?: string;
    sector?: string;
    sort?: string;
    priced?: string;
    move?: string;
  }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = asLocale(rawLocale);
  const t = getUi(locale);
  const filters = await searchParams;
  const sort: SortMode = (
    ['name', 'price', 'change', 'volume'].includes(filters.sort ?? '') ? filters.sort : 'ticker'
  ) as SortMode;
  const movement: MovementFilter = (
    ['gainers', 'losers'].includes(filters.move ?? '') ? filters.move : 'all'
  ) as MovementFilter;
  const selectedSector = filters.sector ?? '';
  const pricedOnly = filters.priced === '1';
  const query = (filters.q ?? '').trim().toLowerCase();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [securitiesResult, indicesResult] = await Promise.all([
    supabase
      .from('market_security_overview')
      .select(
        'id,name,ticker,sector,listing_status,is_synthetic,latest_market_date,latest_close_price,previous_close_price,daily_change_percent,latest_price_provisional',
      )
      .in('listing_status', ['active', 'suspended'])
      .order('ticker'),
    supabase
      .from('market_index_overview')
      .select('id,code,name,latest_close_value,daily_change_percent')
      .in('code', ['MASI', 'MSI20', 'ESGI', 'MASIMS'])
      .order('code'),
  ]);

  const allSecurities = ((securitiesResult.data ?? []) as SecurityRow[]).filter(
    (security) => !security.is_synthetic,
  );
  const indices = (indicesResult.data ?? []) as IndexRow[];

  const activeCount = allSecurities.filter(
    (security) => security.listing_status === 'active',
  ).length;
  const sectorCounts = new Map<string, number>();
  for (const security of allSecurities) {
    if (!security.sector) continue;
    sectorCounts.set(security.sector, (sectorCounts.get(security.sector) ?? 0) + 1);
  }
  const sectors = [...sectorCounts.keys()].sort();
  const sectorsByCount = [...sectors].sort(
    (left, right) =>
      (sectorCounts.get(right) ?? 0) - (sectorCounts.get(left) ?? 0) || left.localeCompare(right),
  );
  const PRIMARY_SECTOR_COUNT = 8;
  const primarySectors = sectorsByCount.slice(0, PRIMARY_SECTOR_COUNT);
  const overflowSectors = sectorsByCount
    .slice(PRIMARY_SECTOR_COUNT)
    .sort((left, right) => left.localeCompare(right));
  const pricedCount = allSecurities.filter(
    (security) => security.latest_close_price !== null,
  ).length;

  const filteredSecurities = allSecurities.filter((security) => {
    const matchesQuery =
      !query ||
      security.ticker.toLowerCase().includes(query) ||
      security.name.toLowerCase().includes(query) ||
      (security.sector ?? '').toLowerCase().includes(query);
    const matchesSector = !selectedSector || security.sector === selectedSector;
    const matchesAvailability = !pricedOnly || security.latest_close_price !== null;
    const changeValue =
      security.daily_change_percent === null ? null : Number(security.daily_change_percent);
    const matchesMovement =
      movement === 'all' ||
      (changeValue !== null &&
        Number.isFinite(changeValue) &&
        (movement === 'gainers' ? changeValue >= 0 : changeValue < 0));
    return matchesQuery && matchesSector && matchesAvailability && matchesMovement;
  });

  const selectedIds = filteredSecurities.map((security) => security.id);
  const { data: priceRows } = selectedIds.length
    ? await supabase
        .from('market_price_history')
        .select('security_id,market_date,close_price,volume')
        .in('security_id', selectedIds)
        .order('market_date', { ascending: true })
    : { data: [] };
  const priceHistory = groupPriceHistory((priceRows ?? []) as PriceHistoryRow[]);

  const visibleSecurities = sortSecurities(filteredSecurities, sort, priceHistory);
  const tickerItems = buildTickerItems(locale, indices, allSecurities);

  return (
    <main className="public-page stocks-v2-page" dir={direction(locale)}>
      <PublicNav locale={locale} authenticated={Boolean(user)} />
      <MarketTicker locale={locale} items={tickerItems} />

      <section className="stocks-v2-hero">
        <div>
          <p className="public-eyebrow">{t.marketV2Eyebrow}</p>
          <h1>{t.stocksV2Title}</h1>
          <p>{t.stocksV2Subtitle}</p>
        </div>
        <div className="stocks-v2-hero-stats">
          <Metric label={t.totalListed} value={String(activeCount)} />
          <Metric label={t.sectorsRepresented} value={String(sectors.length)} />
          <Metric label={t.withPriceHistory} value={String(pricedCount)} />
        </div>
      </section>

      {sectors.length ? (
        <section className="stocks-v2-sectors" aria-label={t.sectorOverviewTitle}>
          <div className="stocks-v2-section-head">
            <div>
              <p className="public-eyebrow">{t.sectorOverviewTitle}</p>
              <h2>{t.sectorOverviewSubtitle}</h2>
            </div>
          </div>
          <div className="stocks-v2-sector-chips">
            <a
              className={selectedSector ? '' : 'active'}
              href={buildFilterHref(locale, {
                q: filters.q,
                sector: undefined,
                sort: filters.sort,
                priced: filters.priced,
                move: filters.move,
              })}
            >
              {t.allSectorsChip} <b>{allSecurities.length}</b>
            </a>
            {primarySectors.map((sector) => (
              <a
                key={sector}
                className={selectedSector === sector ? 'active' : ''}
                href={buildFilterHref(locale, {
                  q: filters.q,
                  sector,
                  sort: filters.sort,
                  priced: filters.priced,
                  move: filters.move,
                })}
              >
                {sector} <b>{sectorCounts.get(sector)}</b>
              </a>
            ))}
            {overflowSectors.length ? (
              <details
                className="stocks-v2-sector-more"
                open={overflowSectors.includes(selectedSector) || undefined}
              >
                <summary>
                  {t.moreSectors} <b>{overflowSectors.length}</b>
                </summary>
                <div className="stocks-v2-sector-chips overflow">
                  {overflowSectors.map((sector) => (
                    <a
                      key={sector}
                      className={selectedSector === sector ? 'active' : ''}
                      href={buildFilterHref(locale, {
                        q: filters.q,
                        sector,
                        sort: filters.sort,
                        priced: filters.priced,
                        move: filters.move,
                      })}
                    >
                      {sector} <b>{sectorCounts.get(sector)}</b>
                    </a>
                  ))}
                </div>
              </details>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="stocks-v2-explorer" aria-label={t.stocksV2Title}>
        <div className="stocks-v2-section-head">
          <div>
            <p className="public-eyebrow">{t.navStocks}</p>
            <h2>{t.equitiesExplorerTitle}</h2>
          </div>
          <span>
            {visibleSecurities.length} / {allSecurities.length}
          </span>
        </div>

        <form className="stocks-v2-filters" method="get">
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
            <span>{t.movement}</span>
            <select name="move" defaultValue={movement}>
              <option value="all">{t.allMovement}</option>
              <option value="gainers">{t.gainersOnly}</option>
              <option value="losers">{t.losersOnly}</option>
            </select>
          </label>
          <label>
            <span>{t.sortBy}</span>
            <select name="sort" defaultValue={sort}>
              <option value="ticker">{t.sortTicker}</option>
              <option value="name">{t.sortName}</option>
              <option value="price">{t.sortPrice}</option>
              <option value="change">{t.sortChange}</option>
              <option value="volume">{t.sortVolume}</option>
            </select>
          </label>
          <label className="stocks-v2-check">
            <input type="checkbox" name="priced" value="1" defaultChecked={pricedOnly} />
            <span>{t.pricedOnly}</span>
          </label>
          <button type="submit">{t.searchShort}</button>
        </form>

        <div className="stocks-v2-table">
          <div className="stocks-v2-table-head">
            <span>{t.ticker}</span>
            <span>{t.company}</span>
            <span>{t.sector}</span>
            <span>{t.latestPrice}</span>
            <span>{t.dailyChange}</span>
            <span>{t.volume}</span>
            <span>{t.priceHistory}</span>
            <span>{t.lastSession}</span>
          </div>
          {visibleSecurities.length ? (
            visibleSecurities.map((security) => {
              const absoluteChange = computeAbsoluteChange(
                security.latest_close_price,
                security.previous_close_price,
              );
              const volume = priceHistory.get(security.id)?.latestVolume ?? null;
              return (
                <a
                  className="stocks-v2-row"
                  href={`/${locale}/market/${security.id}`}
                  key={security.id}
                >
                  <span className="stocks-v2-symbol" dir="ltr">
                    {security.ticker}
                  </span>
                  <span className="stocks-v2-company">
                    <strong>{security.name}</strong>
                    {security.latest_price_provisional ? (
                      <small>{t.provisional}</small>
                    ) : !security.latest_close_price ? (
                      <small>{t.unavailable}</small>
                    ) : null}
                  </span>
                  <span className="stocks-v2-sector">{security.sector ?? '—'}</span>
                  <span className="technical stocks-v2-number" dir="ltr">
                    {formatMoney(security.latest_close_price, locale)}
                  </span>
                  <span
                    className={`technical stocks-v2-change ${movementClass(security.daily_change_percent)}`}
                    dir="ltr"
                  >
                    <b>{formatPercent(security.daily_change_percent)}</b>
                    <em>{formatAbsolute(absoluteChange, locale)}</em>
                  </span>
                  <span className="technical stocks-v2-volume" dir="ltr">
                    {formatVolume(volume, locale)}
                  </span>
                  <MiniSparkline points={priceHistory.get(security.id)?.points ?? []} />
                  <span className="stocks-v2-session">{security.latest_market_date ?? '—'}</span>
                </a>
              );
            })
          ) : (
            <p className="stocks-v2-empty">{t.noMarketResults}</p>
          )}
        </div>
      </section>

      <p className="stocks-v2-disclaimer">
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

function sortSecurities(
  rows: SecurityRow[],
  sort: SortMode,
  history: Map<
    string,
    { points: Array<{ market_date: string; close_price: string }>; latestVolume: number | null }
  >,
) {
  return [...rows].sort((left, right) => {
    if (sort === 'name') return left.name.localeCompare(right.name);
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
    if (sort === 'volume') {
      const leftVolume = history.get(left.id)?.latestVolume ?? -1;
      const rightVolume = history.get(right.id)?.latestVolume ?? -1;
      return rightVolume - leftVolume || left.ticker.localeCompare(right.ticker);
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
  const securityItems = [...securities]
    .filter((security) => security.latest_close_price !== null)
    .sort(
      (left, right) =>
        priorityRank(left.ticker) - priorityRank(right.ticker) ||
        left.ticker.localeCompare(right.ticker),
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

function buildFilterHref(
  locale: Locale,
  filters: {
    q: string | undefined;
    sector: string | undefined;
    sort: string | undefined;
    priced: string | undefined;
    move: string | undefined;
  },
) {
  const params = new URLSearchParams();
  if (filters.q) params.set('q', filters.q);
  if (filters.sector) params.set('sector', filters.sector);
  if (filters.sort) params.set('sort', filters.sort);
  if (filters.priced) params.set('priced', filters.priced);
  if (filters.move) params.set('move', filters.move);
  const query = params.toString();
  return `/${locale}/stocks${query ? `?${query}` : ''}`;
}

function computeAbsoluteChange(latest: string | null, previous: string | null) {
  if (latest === null || previous === null) return null;
  const latestValue = Number(latest);
  const previousValue = Number(previous);
  if (!Number.isFinite(latestValue) || !Number.isFinite(previousValue)) return null;
  return latestValue - previousValue;
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

function formatAbsolute(value: number | null, locale: Locale) {
  if (value === null) return '';
  const formatted = new Intl.NumberFormat(
    locale === 'ar' ? 'ar-MA' : locale === 'fr' ? 'fr-MA' : 'en-MA',
    { maximumFractionDigits: 2, minimumFractionDigits: 2 },
  ).format(Math.abs(value));
  return `${value >= 0 ? '+' : '-'}${formatted}`;
}

function formatVolume(value: number | null, locale: Locale) {
  if (value === null) return '—';
  return new Intl.NumberFormat(locale === 'ar' ? 'ar-MA' : locale === 'fr' ? 'fr-MA' : 'en-MA', {
    maximumFractionDigits: 0,
  }).format(value);
}
