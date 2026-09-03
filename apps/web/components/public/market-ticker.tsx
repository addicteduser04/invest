import type { Locale } from '@bvc/contracts';
import { getUi } from '@/lib/i18n';

export interface TickerItem {
  id: string;
  ticker: string;
  name: string;
  href: string;
  price: string | null;
  changePercent: string | number | null;
  kind?: 'index' | 'security';
}

export function MarketTicker({ locale, items }: { locale: Locale; items: TickerItem[] }) {
  const t = getUi(locale);
  const visible = items.filter((item) => item.price !== null).slice(0, 14);
  const content = visible.length ? visible : items.slice(0, 8);
  const track = [...content, ...content];

  return (
    <section className="market-ticker-band" aria-label={t.liveTicker}>
      <div className="market-ticker-label">{t.liveTicker}</div>
      <div className="market-ticker-viewport">
        <div className="market-ticker-track">
          {track.map((item, index) => {
            const change = normalizePercent(item.changePercent);
            return (
              <a
                className="market-ticker-item"
                href={item.href}
                key={`${item.kind ?? 'security'}-${item.id}-${index}`}
              >
                <strong>{item.ticker}</strong>
                <span className="technical" dir="ltr">
                  {formatQuote(item.price, locale, item.kind)}
                </span>
                <em
                  className={change === null ? '' : change >= 0 ? 'positive' : 'negative'}
                  dir="ltr"
                >
                  {change === null
                    ? t.flatChange
                    : `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`}
                </em>
              </a>
            );
          })}
          {!track.length ? <p>{t.noTickerData}</p> : null}
        </div>
      </div>
    </section>
  );
}

function normalizePercent(value: string | number | null) {
  if (value === null) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function formatQuote(value: string | null, locale: Locale, kind: TickerItem['kind']) {
  if (!value) return '—';
  return new Intl.NumberFormat(locale === 'ar' ? 'ar-MA' : locale === 'fr' ? 'fr-MA' : 'en-MA', {
    maximumFractionDigits: 2,
    minimumFractionDigits: kind === 'index' ? 2 : 0,
  }).format(Number(value));
}
