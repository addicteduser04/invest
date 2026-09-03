import { redirect } from 'next/navigation';
import type { Locale } from '@bvc/contracts';
import { asLocale, direction, getUi } from '@/lib/i18n';
import { createClient } from '@/lib/supabase/server';
import { MarketTicker, type TickerItem } from '@/components/public/market-ticker';
import { PublicNav } from '@/components/public/public-nav';
import { PublicFooter } from '@/components/public/public-footer';
import { CompareSelector } from '@/components/compare-selector';
import { ComparePanel, type CompareSecurityDetail } from '@/components/compare-panel';
import { formatMoney } from '@/components/public/home-market-sections';
import type { Security } from '@/components/security-picker';
import { MAX_COMPARE_SECURITIES } from '@/lib/compare-metrics';

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
  latest_close_value: string | null;
  daily_change_percent: string | number | null;
}

interface PriceHistoryRow {
  security_id: string;
  market_date: string;
  close_price: string;
  volume: string | null;
}

const SUGGESTED_TICKERS = ['IAM', 'ATW', 'BCP'];

export default async function ComparePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ securities?: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = asLocale(rawLocale);
  const t = getUi(locale);
  const query = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [securitiesResult, indicesResult] = await Promise.all([
    supabase
      .from('market_security_overview')
      .select(
        'id,name,ticker,sector,listing_status,is_synthetic,latest_market_date,latest_close_price,daily_change_percent,latest_price_provisional',
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
  const bySecurityId = new Map(allSecurities.map((security) => [security.id, security]));

  if (!query.securities) {
    const defaultIds = SUGGESTED_TICKERS.map((ticker) =>
      allSecurities.find(
        (security) => security.ticker === ticker && security.latest_close_price !== null,
      ),
    )
      .filter((security): security is SecurityRow => Boolean(security))
      .slice(0, 2)
      .map((security) => security.id);
    if (defaultIds.length >= 2) {
      redirect(`/${locale}/compare?securities=${defaultIds.join(',')}`);
    }
  }

  const requestedIds = [
    ...new Set((query.securities ?? '').split(',').map((id) => id.trim())),
  ].filter(Boolean);
  const selectedIds = requestedIds
    .filter((id) => bySecurityId.has(id))
    .slice(0, MAX_COMPARE_SECURITIES);
  const selectedSecurities = selectedIds
    .map((id) => bySecurityId.get(id))
    .filter((security): security is SecurityRow => Boolean(security));

  const historyResults =
    selectedSecurities.length >= 2
      ? await Promise.all(
          selectedSecurities.map((security) =>
            supabase
              .from('market_price_history')
              .select('security_id,market_date,close_price,volume')
              .eq('security_id', security.id)
              .order('market_date', { ascending: true })
              .limit(900),
          ),
        )
      : [];

  const historyBySecurityId = new Map<string, PriceHistoryRow[]>();
  historyResults.forEach((result, index) => {
    const security = selectedSecurities[index];
    if (security) historyBySecurityId.set(security.id, (result.data ?? []) as PriceHistoryRow[]);
  });

  const compareSecurities: CompareSecurityDetail[] = selectedSecurities.map((security) => ({
    id: security.id,
    ticker: security.ticker,
    name: security.name,
    sector: security.sector,
    latest_market_date: security.latest_market_date,
    latest_close_price: security.latest_close_price,
    daily_change_percent: security.daily_change_percent,
    latest_price_provisional: security.latest_price_provisional,
    history: (historyBySecurityId.get(security.id) ?? []).map((row) => ({
      market_date: row.market_date,
      close_price: row.close_price,
      volume: row.volume,
    })),
  }));

  const pickerSecurities: Security[] = allSecurities.map(({ id, ticker, name }) => ({
    id,
    ticker,
    name,
  }));
  const selectedForSelector: Security[] = selectedSecurities.map(({ id, ticker, name }) => ({
    id,
    ticker,
    name,
  }));

  const suggested = SUGGESTED_TICKERS.map((ticker) =>
    allSecurities.find(
      (security) => security.ticker === ticker && security.latest_close_price !== null,
    ),
  ).filter((security): security is SecurityRow => Boolean(security));

  const tickerItems = buildTickerItems(locale, indices, allSecurities);

  return (
    <main className="public-page compare-v2-page" dir={direction(locale)}>
      <PublicNav locale={locale} authenticated={Boolean(user)} />
      <MarketTicker locale={locale} items={tickerItems} />

      <section className="compare-v2-hero">
        <p className="public-eyebrow">{t.marketV2Eyebrow}</p>
        <h1>{t.compareHeroTitle}</h1>
        <p>{t.compareHeroSubtitle}</p>
      </section>

      <section className="compare-v2-selector-section">
        <CompareSelector
          locale={locale}
          availableSecurities={pickerSecurities}
          selectedSecurities={selectedForSelector}
        />
      </section>

      {compareSecurities.length >= 2 ? (
        <section className="compare-v2-workspace">
          <ComparePanel locale={locale} securities={compareSecurities} />
        </section>
      ) : selectedSecurities.length === 1 ? (
        <section className="compare-v2-prompt">
          <p>{t.compareNeedOneMore}</p>
        </section>
      ) : (
        <section className="compare-v2-empty">
          <p className="public-eyebrow">{t.compareSuggestedTitle}</p>
          <h2>{t.compareEmptyTitle}</h2>
          <p>{t.compareEmptySubtitle}</p>
          {suggested.length ? (
            <div className="compare-v2-suggested">
              {suggested.map((security) => (
                <a
                  key={security.id}
                  href={`/${locale}/compare?securities=${security.id}`}
                  className="compare-v2-suggested-card"
                >
                  <b dir="ltr">{security.ticker}</b>
                  <span>{security.name}</span>
                  <small className="technical" dir="ltr">
                    {formatMoney(security.latest_close_price, locale)}
                  </small>
                </a>
              ))}
            </div>
          ) : null}
        </section>
      )}
      <PublicFooter locale={locale} authenticated={Boolean(user)} />
    </main>
  );
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

function priorityRank(ticker: string) {
  const rank = SUGGESTED_TICKERS.indexOf(ticker);
  return rank === -1 ? 99 : rank;
}
