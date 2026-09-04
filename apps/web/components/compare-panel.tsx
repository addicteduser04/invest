'use client';

import React, { useMemo, useState } from 'react';
import type { Locale } from '@bvc/contracts';
import { getUi } from '@/lib/i18n';
import { formatMoney } from '@/components/public/home-market-sections';
import { CompareChart, type CompareSeriesInput } from '@/components/compare-chart';
import {
  annualizedVolatility,
  averageVolume,
  periodCutoff,
  periodHighLow,
  periodReturn,
  type ComparePeriod,
  type ComparePricePoint,
} from '@/lib/compare-metrics';
import type { ValuationSnapshot } from '@/lib/valuation-read';

export interface CompareSecurityDetail {
  id: string;
  ticker: string;
  name: string;
  sector: string | null;
  latest_market_date: string | null;
  latest_close_price: string | null;
  daily_change_percent: string | number | null;
  latest_price_provisional: boolean | null;
  history: ComparePricePoint[];
  valuation: ValuationSnapshot;
}

const PALETTE = ['#44d7be', '#c7a458', '#6fb3f2', '#d98cd6'];

export function ComparePanel({
  locale,
  securities,
}: {
  locale: Locale;
  securities: CompareSecurityDetail[];
}) {
  const t = getUi(locale);
  const [range, setRange] = useState<ComparePeriod>('1Y');

  const series: CompareSeriesInput[] = useMemo(
    () =>
      securities.map((security, index) => ({
        id: security.id,
        ticker: security.ticker,
        name: security.name,
        color: PALETTE[index % PALETTE.length] ?? '#44d7be',
        points: security.history,
      })),
    [securities],
  );

  const overallLatestDate = useMemo(
    () =>
      securities
        .flatMap((security) => security.history.map((point) => point.market_date))
        .sort()
        .at(-1) ?? null,
    [securities],
  );

  const rows = useMemo(
    () =>
      securities.map((security) => {
        const cutoff = overallLatestDate ? periodCutoff(range, overallLatestDate) : null;
        const scoped = cutoff
          ? security.history.filter((point) => point.market_date >= cutoff)
          : security.history;
        const { high, low } = periodHighLow(scoped);
        return {
          security,
          oneMonthReturn: periodReturn(security.history, '1M'),
          threeMonthReturn: periodReturn(security.history, '3M'),
          yearToDateReturn: periodReturn(security.history, 'YTD'),
          oneYearReturn: periodReturn(security.history, '1Y'),
          periodHigh: high,
          periodLow: low,
          averageVolume: averageVolume(scoped),
          volatility: annualizedVolatility(scoped),
          sessions: scoped.length,
        };
      }),
    [securities, range, overallLatestDate],
  );

  const sectorsDiffer =
    new Set(securities.map((security) => security.sector).filter(Boolean)).size > 1;

  return (
    <div className="compare-v2-panel">
      <CompareChart locale={locale} series={series} range={range} onRangeChange={setRange} />

      <section className="compare-v2-matrix-section" aria-label={t.compareMetricsTitle}>
        <h2>{t.compareMetricsTitle}</h2>
        <div className="compare-v2-matrix-scroll">
          <table className="compare-v2-matrix">
            <thead>
              <tr>
                <th scope="col" />
                {securities.map((security, index) => (
                  <th scope="col" key={security.id}>
                    <a href={`/${locale}/market/${security.id}`} className="compare-v2-matrix-head">
                      <i style={{ background: PALETTE[index % PALETTE.length] }} />
                      <span>
                        <b dir="ltr">{security.ticker}</b>
                        <small>{security.name}</small>
                        {sectorsDiffer && security.sector ? <em>{security.sector}</em> : null}
                      </span>
                    </a>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <MetricRow
                label={t.latestPrice}
                cells={securities.map((security) =>
                  formatMoney(security.latest_close_price, locale),
                )}
              />
              <MetricRow
                label={t.dailyChange}
                cells={securities.map((security) => formatPercent(security.daily_change_percent))}
                tones={securities.map((security) => movementClass(security.daily_change_percent))}
              />
              <MetricRow
                label={t.oneMonthReturn}
                cells={rows.map((row) => formatPercent(row.oneMonthReturn))}
                tones={rows.map((row) => movementClass(row.oneMonthReturn))}
              />
              <MetricRow
                label={t.threeMonthReturn}
                cells={rows.map((row) => formatPercent(row.threeMonthReturn))}
                tones={rows.map((row) => movementClass(row.threeMonthReturn))}
              />
              <MetricRow
                label={t.yearToDateReturn}
                cells={rows.map((row) => formatPercent(row.yearToDateReturn))}
                tones={rows.map((row) => movementClass(row.yearToDateReturn))}
              />
              <MetricRow
                label={t.oneYearReturn}
                cells={rows.map((row) => formatPercent(row.oneYearReturn))}
                tones={rows.map((row) => movementClass(row.oneYearReturn))}
              />
              <MetricRow
                label={t.periodHigh}
                cells={rows.map((row) =>
                  row.periodHigh === null ? '—' : formatMoney(row.periodHigh, locale),
                )}
              />
              <MetricRow
                label={t.periodLow}
                cells={rows.map((row) =>
                  row.periodLow === null ? '—' : formatMoney(row.periodLow, locale),
                )}
              />
              <MetricRow
                label={t.averageVolume}
                cells={rows.map((row) => formatVolume(row.averageVolume, locale))}
              />
              <MetricRow
                label={t.volatility}
                cells={rows.map((row) =>
                  row.volatility === null ? '—' : `${row.volatility.toFixed(1)}%`,
                )}
              />
              <MetricRow
                label={t.tradingSessions}
                cells={rows.map((row) => String(row.sessions))}
              />
              <MetricRow
                label={t.lastSession}
                cells={securities.map((security) => security.latest_market_date ?? '—')}
              />
              <MetricRow
                label={t.dataAvailability}
                cells={securities.map((security) =>
                  security.latest_price_provisional
                    ? t.provisional
                    : security.latest_close_price
                      ? t.priceCurrent
                      : t.unavailable,
                )}
              />
              <tr className="compare-v2-matrix-divider">
                <th scope="row" colSpan={securities.length + 1}>
                  {t.fundamentalsEyebrow}
                </th>
              </tr>
              <MetricRow
                label={t.screenerMarketCap}
                cells={securities.map((security) => compactMoney(security.valuation.marketCap, locale))}
              />
              <MetricRow
                label={t.screenerPe}
                cells={securities.map((security) => ratioX(security.valuation.pe, locale))}
              />
              <MetricRow
                label={t.screenerPb}
                cells={securities.map((security) => ratioX(security.valuation.pb, locale))}
              />
              <MetricRow
                label={t.screenerEvEbitda}
                cells={securities.map((security) => ratioX(security.valuation.evEbitda, locale))}
              />
              <MetricRow
                label={t.screenerRevenueGrowth}
                cells={securities.map((security) => percentRatio(security.valuation.revenueGrowth, locale))}
                tones={securities.map((security) => toneClass(security.valuation.revenueGrowth))}
              />
              <MetricRow
                label={t.screenerNetMargin}
                cells={securities.map((security) => percentRatio(security.valuation.netMargin, locale))}
                tones={securities.map((security) => toneClass(security.valuation.netMargin))}
              />
              <MetricRow
                label={t.screenerRoe}
                cells={securities.map((security) => percentRatio(security.valuation.roe, locale))}
                tones={securities.map((security) => toneClass(security.valuation.roe))}
              />
              <MetricRow
                label={t.screenerDebtEquity}
                cells={securities.map((security) => ratioX(security.valuation.debtEquity, locale))}
              />
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function MetricRow({ label, cells, tones }: { label: string; cells: string[]; tones?: string[] }) {
  return (
    <tr>
      <th scope="row">{label}</th>
      {cells.map((cell, index) => (
        <td key={index} className={`technical ${tones?.[index] ?? ''}`} dir="ltr">
          {cell}
        </td>
      ))}
    </tr>
  );
}

function formatPercent(value: number | string | null | undefined) {
  if (value === null || value === undefined) return '—';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '—';
  return `${numeric >= 0 ? '+' : ''}${numeric.toFixed(2)}%`;
}

function movementClass(value: number | string | null | undefined) {
  if (value === null || value === undefined) return '';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '';
  return numeric >= 0 ? 'positive' : 'negative';
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

function ratioX(value: number | null, locale: Locale) {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${new Intl.NumberFormat(intlLocale(locale), { maximumFractionDigits: 2 }).format(value)}x`;
}

// Ratio fields (revenueGrowth, netMargin, roe, ...) are stored as fractions (0.15 = 15%), unlike
// daily_change_percent which already arrives pre-multiplied -- this deliberately does not reuse
// formatPercent above, which would misrender a 0.15 ratio as "0.15%".
function percentRatio(value: number | null, locale: Locale) {
  if (value === null || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat(intlLocale(locale), {
    style: 'percent',
    maximumFractionDigits: 1,
    signDisplay: 'exceptZero',
  }).format(value);
}

function toneClass(value: number | null) {
  if (value === null || !Number.isFinite(value)) return '';
  return value >= 0 ? 'positive' : 'negative';
}
