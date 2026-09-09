import type { Locale } from '@bvc/contracts';
import { asLocale, direction, getUi } from '@/lib/i18n';
import { createClient } from '@/lib/supabase/server';
import { MarketTicker, type TickerItem } from '@/components/public/market-ticker';
import { PublicNav } from '@/components/public/public-nav';
import { PublicFooter } from '@/components/public/public-footer';
import { MiniSparkline, formatMoney } from '@/components/public/home-market-sections';
import { readValuationSnapshots } from '@/lib/valuation-read';
import {
  COLUMN_GROUPS,
  SORT_MODES,
  hasAnyValuationFilter,
  matchesValuationFilters,
  parseFilterNumber,
  priorityRank,
  sortSecurities,
  type ColumnGroup,
  type SortDirection,
  type SortMode,
  type ValuationFilters,
} from '@/lib/stocks-screener';

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

interface RawFilters {
  q?: string | undefined;
  sector?: string | undefined;
  sort?: string | undefined;
  direction?: string | undefined;
  priced?: string | undefined;
  move?: string | undefined;
  cols?: string | undefined;
  peMax?: string | undefined;
  pbMax?: string | undefined;
  evEbitdaMax?: string | undefined;
  divYieldMin?: string | undefined;
  revGrowthMin?: string | undefined;
  epsGrowthMin?: string | undefined;
  netMarginMin?: string | undefined;
  roeMin?: string | undefined;
  debtEquityMax?: string | undefined;
  hasFundamentals?: string | undefined;
  hasValuation?: string | undefined;
}

export default async function StocksPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<RawFilters>;
}) {
  const { locale: rawLocale } = await params;
  const locale = asLocale(rawLocale);
  const t = getUi(locale);
  const filters = await searchParams;
  const sort: SortMode = (
    SORT_MODES.includes(filters.sort as SortMode) ? filters.sort : 'ticker'
  ) as SortMode;
  const sortDirection: SortDirection = filters.direction === 'asc' ? 'asc' : 'desc';
  const movement: MovementFilter = (
    ['gainers', 'losers'].includes(filters.move ?? '') ? filters.move : 'all'
  ) as MovementFilter;
  const columnGroup: ColumnGroup = (
    COLUMN_GROUPS.includes(filters.cols as ColumnGroup) ? filters.cols : 'none'
  ) as ColumnGroup;
  const selectedSector = filters.sector ?? '';
  const pricedOnly = filters.priced === '1';
  const hasFundamentalsOnly = filters.hasFundamentals === '1';
  const hasValuationOnly = filters.hasValuation === '1';
  const query = (filters.q ?? '').trim().toLowerCase();

  const valuationFilters: ValuationFilters = {
    hasFundamentalsOnly,
    hasValuationOnly,
    peMax: parseFilterNumber(filters.peMax),
    pbMax: parseFilterNumber(filters.pbMax),
    evEbitdaMax: parseFilterNumber(filters.evEbitdaMax),
    divYieldMin: parseFilterNumber(filters.divYieldMin),
    revGrowthMin: parseFilterNumber(filters.revGrowthMin),
    epsGrowthMin: parseFilterNumber(filters.epsGrowthMin),
    netMarginMin: parseFilterNumber(filters.netMarginMin),
    roeMin: parseFilterNumber(filters.roeMin),
    debtEquityMax: parseFilterNumber(filters.debtEquityMax),
  };
  const hasValuationFilters = hasAnyValuationFilter(valuationFilters);

  // Carries every current filter/sort param through sector-chip and pagination-style links.
  const currentFilterState: RawFilters = {
    q: filters.q,
    sector: filters.sector,
    sort: filters.sort,
    direction: filters.direction,
    priced: filters.priced,
    move: filters.move,
    cols: filters.cols,
    peMax: filters.peMax,
    pbMax: filters.pbMax,
    evEbitdaMax: filters.evEbitdaMax,
    divYieldMin: filters.divYieldMin,
    revGrowthMin: filters.revGrowthMin,
    epsGrowthMin: filters.epsGrowthMin,
    netMarginMin: filters.netMarginMin,
    roeMin: filters.roeMin,
    debtEquityMax: filters.debtEquityMax,
    hasFundamentals: filters.hasFundamentals,
    hasValuation: filters.hasValuation,
  };

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

  const coreFilteredSecurities = allSecurities.filter((security) => {
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

  // One batched read for however many securities matched the core filters -- never one query
  // per security. Mobile always needs P/E, ROE and revenue growth regardless of which desktop
  // column group is selected, so valuation data is always fetched, not just when filtering/
  // sorting by it.
  const valuationMap = await readValuationSnapshots(
    coreFilteredSecurities.map((security) => ({
      id: security.id,
      latestPrice: security.latest_close_price,
      priceDate: security.latest_market_date,
    })),
  );

  const filteredSecurities = coreFilteredSecurities.filter((security) =>
    matchesValuationFilters(valuationMap.get(security.id), valuationFilters),
  );

  const selectedIds = filteredSecurities.map((security) => security.id);
  const { data: priceRows } = selectedIds.length
    ? await supabase
        .from('market_price_history')
        .select('security_id,market_date,close_price,volume')
        .in('security_id', selectedIds)
        .order('market_date', { ascending: true })
    : { data: [] };
  const priceHistory = groupPriceHistory((priceRows ?? []) as PriceHistoryRow[]);
  const volumeBySecurity = new Map(
    [...priceHistory].map(([id, entry]) => [id, entry.latestVolume]),
  );

  const visibleSecurities = sortSecurities(
    filteredSecurities,
    sort,
    sortDirection,
    volumeBySecurity,
    valuationMap,
  );
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
              href={buildFilterHref(locale, { ...currentFilterState, sector: undefined })}
            >
              {t.allSectorsChip} <b>{allSecurities.length}</b>
            </a>
            {primarySectors.map((sector) => (
              <a
                key={sector}
                className={selectedSector === sector ? 'active' : ''}
                href={buildFilterHref(locale, { ...currentFilterState, sector })}
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
                      href={buildFilterHref(locale, { ...currentFilterState, sector })}
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
              <option value="marketCap">{t.screenerSortMarketCap}</option>
              <option value="pe">{t.screenerSortPe}</option>
              <option value="pb">{t.screenerSortPb}</option>
              <option value="evEbitda">{t.screenerSortEvEbitda}</option>
              <option value="dividendYield">{t.screenerSortDividendYield}</option>
              <option value="revenueGrowth">{t.screenerSortRevenueGrowth}</option>
              <option value="epsGrowth">{t.screenerSortEpsGrowth}</option>
              <option value="netMargin">{t.screenerSortNetMargin}</option>
              <option value="roe">{t.screenerSortRoe}</option>
              <option value="debtEquity">{t.screenerSortDebtEquity}</option>
            </select>
          </label>
          <label>
            <span>{t.screenerMoreColumns}</span>
            <select name="cols" defaultValue={columnGroup}>
              <option value="none">{t.screenerColumnGroupCore}</option>
              <option value="valuation">{t.screenerColumnGroupValuation}</option>
              <option value="growth">{t.screenerColumnGroupGrowth}</option>
              <option value="quality">{t.screenerColumnGroupQuality}</option>
              <option value="balance">{t.screenerColumnGroupBalanceSheet}</option>
            </select>
          </label>
          <label>
            <span>{t.screenerSortDirection}</span>
            <select name="direction" defaultValue={sortDirection}>
              <option value="desc">{t.screenerSortDescending}</option>
              <option value="asc">{t.screenerSortAscending}</option>
            </select>
          </label>
          <label className="stocks-v2-check">
            <input type="checkbox" name="priced" value="1" defaultChecked={pricedOnly} />
            <span>{t.pricedOnly}</span>
          </label>
          <button type="submit">{t.searchShort}</button>

          <details
            className="stocks-v2-sector-more stocks-v2-more-filters"
            open={hasValuationFilters || undefined}
          >
            <summary>{t.screenerFundamentalsColumns}</summary>
            <div className="stocks-v2-filter-groups">
              <fieldset>
                <legend>{t.screenerFiltersValuation}</legend>
                <label>
                  <span>{t.screenerPeMax}</span>
                  <input
                    type="number"
                    step="0.1"
                    name="peMax"
                    defaultValue={filters.peMax ?? ''}
                    placeholder="15"
                  />
                </label>
                <label>
                  <span>{t.screenerPbMax}</span>
                  <input
                    type="number"
                    step="0.1"
                    name="pbMax"
                    defaultValue={filters.pbMax ?? ''}
                    placeholder="3"
                  />
                </label>
                <label>
                  <span>{t.screenerEvEbitdaMax}</span>
                  <input
                    type="number"
                    step="0.1"
                    name="evEbitdaMax"
                    defaultValue={filters.evEbitdaMax ?? ''}
                    placeholder="10"
                  />
                </label>
                <label>
                  <span>{t.screenerDividendYieldMin}</span>
                  <input
                    type="number"
                    step="0.001"
                    name="divYieldMin"
                    defaultValue={filters.divYieldMin ?? ''}
                    placeholder="0.03"
                  />
                </label>
              </fieldset>
              <fieldset>
                <legend>{t.screenerFiltersGrowth}</legend>
                <label>
                  <span>{t.screenerRevenueGrowthMin}</span>
                  <input
                    type="number"
                    step="0.01"
                    name="revGrowthMin"
                    defaultValue={filters.revGrowthMin ?? ''}
                    placeholder="0.05"
                  />
                </label>
                <label>
                  <span>{t.screenerEpsGrowthMin}</span>
                  <input
                    type="number"
                    step="0.01"
                    name="epsGrowthMin"
                    defaultValue={filters.epsGrowthMin ?? ''}
                    placeholder="0.05"
                  />
                </label>
              </fieldset>
              <fieldset>
                <legend>{t.screenerFiltersQuality}</legend>
                <label>
                  <span>{t.screenerNetMarginMin}</span>
                  <input
                    type="number"
                    step="0.01"
                    name="netMarginMin"
                    defaultValue={filters.netMarginMin ?? ''}
                    placeholder="0.1"
                  />
                </label>
                <label>
                  <span>{t.screenerRoeMin}</span>
                  <input
                    type="number"
                    step="0.01"
                    name="roeMin"
                    defaultValue={filters.roeMin ?? ''}
                    placeholder="0.12"
                  />
                </label>
              </fieldset>
              <fieldset>
                <legend>{t.screenerFiltersRisk}</legend>
                <label>
                  <span>{t.screenerDebtEquityMax}</span>
                  <input
                    type="number"
                    step="0.1"
                    name="debtEquityMax"
                    defaultValue={filters.debtEquityMax ?? ''}
                    placeholder="1"
                  />
                </label>
                <label className="stocks-v2-check">
                  <input
                    type="checkbox"
                    name="hasFundamentals"
                    value="1"
                    defaultChecked={hasFundamentalsOnly}
                  />
                  <span>{t.screenerHasFundamentals}</span>
                </label>
                <label className="stocks-v2-check">
                  <input
                    type="checkbox"
                    name="hasValuation"
                    value="1"
                    defaultChecked={hasValuationOnly}
                  />
                  <span>{t.screenerHasValuation}</span>
                </label>
              </fieldset>
            </div>
            <button type="submit">{t.searchShort}</button>
          </details>
        </form>

        <div className={`stocks-v2-table cols-${columnGroup}`}>
          <div className="stocks-v2-table-head">
            <span>{t.ticker}</span>
            <span>{t.company}</span>
            <span>{t.sector}</span>
            <span>{t.latestPrice}</span>
            <span>{t.dailyChange}</span>
            {columnGroup === 'none' ? (
              <>
                <span>{t.volume}</span>
                <span>{t.priceHistory}</span>
                <span>{t.lastSession}</span>
              </>
            ) : null}
            {columnGroup === 'valuation' ? (
              <>
                <span>{t.screenerMarketCap}</span>
                <span>{t.screenerPe}</span>
                <span>{t.screenerPb}</span>
                <span>{t.screenerEvEbitda}</span>
                <span>{t.screenerDividendYield}</span>
              </>
            ) : null}
            {columnGroup === 'growth' ? (
              <>
                <span>{t.screenerRevenueGrowth}</span>
                <span>{t.screenerEbitdaGrowth}</span>
                <span>{t.screenerEpsGrowth}</span>
              </>
            ) : null}
            {columnGroup === 'quality' ? (
              <>
                <span>{t.screenerEbitdaMargin}</span>
                <span>{t.screenerNetMargin}</span>
                <span>{t.screenerRoe}</span>
              </>
            ) : null}
            {columnGroup === 'balance' ? (
              <>
                <span>{t.screenerDebtEquity}</span>
                <span>{t.screenerNetDebt}</span>
              </>
            ) : null}
          </div>
          {visibleSecurities.length ? (
            visibleSecurities.map((security) => {
              const absoluteChange = computeAbsoluteChange(
                security.latest_close_price,
                security.previous_close_price,
              );
              const volume = priceHistory.get(security.id)?.latestVolume ?? null;
              const v = valuationMap.get(security.id);
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

                  {columnGroup === 'none' ? (
                    <>
                      <span className="technical stocks-v2-volume" dir="ltr">
                        {formatVolume(volume, locale)}
                      </span>
                      <MiniSparkline points={priceHistory.get(security.id)?.points ?? []} />
                      <span className="stocks-v2-session">
                        {security.latest_market_date ?? '—'}
                      </span>
                    </>
                  ) : null}

                  {columnGroup === 'valuation' ? (
                    <>
                      <span className="technical stocks-v2-number stocks-v2-extra" dir="ltr">
                        {compactMoney(v?.marketCap ?? null, locale)}
                      </span>
                      <span className="technical stocks-v2-number stocks-v2-extra" dir="ltr">
                        {ratioX(v?.pe ?? null, locale)}
                      </span>
                      <span className="technical stocks-v2-number stocks-v2-extra" dir="ltr">
                        {ratioX(v?.pb ?? null, locale)}
                      </span>
                      <span className="technical stocks-v2-number stocks-v2-extra" dir="ltr">
                        {ratioX(v?.evEbitda ?? null, locale)}
                      </span>
                      <span className="technical stocks-v2-number stocks-v2-extra" dir="ltr">
                        {percentRatio(v?.dividendYield ?? null, locale)}
                      </span>
                    </>
                  ) : null}

                  {columnGroup === 'growth' ? (
                    <>
                      <span
                        className={`technical stocks-v2-number stocks-v2-extra ${movementClassSigned(v?.revenueGrowth ?? null)}`}
                        dir="ltr"
                      >
                        {percentRatio(v?.revenueGrowth ?? null, locale)}
                      </span>
                      <span
                        className={`technical stocks-v2-number stocks-v2-extra ${movementClassSigned(v?.ebitdaGrowth ?? null)}`}
                        dir="ltr"
                      >
                        {percentRatio(v?.ebitdaGrowth ?? null, locale)}
                      </span>
                      <span
                        className={`technical stocks-v2-number stocks-v2-extra ${movementClassSigned(v?.epsGrowth ?? null)}`}
                        dir="ltr"
                      >
                        {percentRatio(v?.epsGrowth ?? null, locale)}
                      </span>
                    </>
                  ) : null}

                  {columnGroup === 'quality' ? (
                    <>
                      <span className="technical stocks-v2-number stocks-v2-extra" dir="ltr">
                        {percentRatio(v?.ebitdaMargin ?? null, locale)}
                      </span>
                      <span className="technical stocks-v2-number stocks-v2-extra" dir="ltr">
                        {percentRatio(v?.netMargin ?? null, locale)}
                      </span>
                      <span className="technical stocks-v2-number stocks-v2-extra" dir="ltr">
                        {percentRatio(v?.roe ?? null, locale)}
                      </span>
                    </>
                  ) : null}

                  {columnGroup === 'balance' ? (
                    <>
                      <span className="technical stocks-v2-number stocks-v2-extra" dir="ltr">
                        {ratioX(v?.debtEquity ?? null, locale)}
                      </span>
                      <span className="technical stocks-v2-number stocks-v2-extra" dir="ltr">
                        {compactMoney(v?.netDebt ?? null, locale)}
                      </span>
                    </>
                  ) : null}

                  <div className="stocks-v2-mobile-metrics">
                    <span>
                      <small>{t.screenerPe}</small>
                      <b className="technical" dir="ltr">
                        {ratioX(v?.pe ?? null, locale)}
                      </b>
                    </span>
                    <span>
                      <small>{t.screenerRoe}</small>
                      <b className="technical" dir="ltr">
                        {percentRatio(v?.roe ?? null, locale)}
                      </b>
                    </span>
                    <span>
                      <small>{t.screenerRevenueGrowth}</small>
                      <b className="technical" dir="ltr">
                        {percentRatio(v?.revenueGrowth ?? null, locale)}
                      </b>
                    </span>
                  </div>
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

function buildFilterHref(locale: Locale, filters: RawFilters) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  const queryString = params.toString();
  return `/${locale}/stocks${queryString ? `?${queryString}` : ''}`;
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

function movementClassSigned(value: number | null) {
  if (value === null || !Number.isFinite(value)) return '';
  return value >= 0 ? 'positive' : 'negative';
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

function intlLocale(locale: Locale) {
  return locale === 'ar' ? 'ar-MA' : locale === 'fr' ? 'fr-MA' : 'en-MA';
}

function compactMoney(value: number | null, locale: Locale) {
  if (value === null || !Number.isFinite(value)) return '—';
  const formatted = new Intl.NumberFormat(intlLocale(locale), {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
  return `${formatted} MAD`;
}

function percentRatio(value: number | null, locale: Locale) {
  if (value === null || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat(intlLocale(locale), {
    style: 'percent',
    maximumFractionDigits: 1,
    signDisplay: 'exceptZero',
  }).format(value);
}

function ratioX(value: number | null, locale: Locale) {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${new Intl.NumberFormat(intlLocale(locale), { maximumFractionDigits: 2 }).format(value)}x`;
}
