'use client';

import Script from 'next/script';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Locale } from '@bvc/contracts';
import { getUi } from '@/lib/i18n';

export interface IndexPoint {
  market_date: string;
  close_value: string;
}

type RangeKey = '1M' | '3M' | 'YTD' | '1Y' | '3Y';

type MasiChartSeries = {
  setData(data: readonly Record<string, unknown>[]): void;
  priceScale?: () => { applyOptions(options: Record<string, unknown>): void };
};

type MasiChartApi = {
  addSeries(definition: unknown, options?: Record<string, unknown>): MasiChartSeries;
  timeScale(): { fitContent(): void };
  resize(width: number, height: number): void;
  remove(): void;
};

type MasiLightweightCharts = {
  createChart(container: HTMLElement, options?: Record<string, unknown>): MasiChartApi;
  CandlestickSeries: unknown;
  LineSeries: unknown;
  HistogramSeries: unknown;
};

const rangeLabels: RangeKey[] = ['1M', '3M', 'YTD', '1Y', '3Y'];
const rangeDays: Partial<Record<RangeKey, number>> = { '1M': 31, '3M': 93, '1Y': 366, '3Y': 1098 };

export function MasiHeroChart({
  locale,
  history,
  latestDate,
}: {
  locale: Locale;
  history: IndexPoint[];
  latestDate: string | null;
}) {
  const t = getUi(locale);
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<MasiChartApi | null>(null);
  const [scriptReady, setScriptReady] = useState(false);
  const [scriptFailed, setScriptFailed] = useState(false);
  const [range, setRange] = useState<RangeKey>('1Y');

  const ordered = useMemo(
    () =>
      history
        .filter((point) => Number.isFinite(Number(point.close_value)))
        .sort((left, right) => left.market_date.localeCompare(right.market_date)),
    [history],
  );

  const availability = useMemo(() => {
    const last = ordered.at(-1);
    return new Map(
      rangeLabels.map((key) => {
        if (!last) return [key, false] as const;
        return [key, filterByRange(ordered, key).length >= 2] as const;
      }),
    );
  }, [ordered]);

  const filtered = useMemo(() => filterByRange(ordered, range), [ordered, range]);
  const first = filtered[0];
  const last = filtered.at(-1);
  const performance =
    first && last ? (Number(last.close_value) / Number(first.close_value) - 1) * 100 : null;
  const displayPoint = last ?? null;

  useEffect(() => {
    if (
      !scriptReady ||
      scriptFailed ||
      !containerRef.current ||
      !getLightweightCharts() ||
      filtered.length < 2
    )
      return;

    chartRef.current?.remove();
    const container = containerRef.current;
    const library = getLightweightCharts()!;
    const chart = library.createChart(container, {
      width: container.clientWidth,
      height: 420,
      layout: {
        background: { type: 'solid', color: '#071917' },
        textColor: '#8ea8a0',
        attributionLogo: true,
      },
      grid: {
        vertLines: { color: 'rgba(150, 188, 176, 0.08)' },
        horzLines: { color: 'rgba(150, 188, 176, 0.09)' },
      },
      rightPriceScale: { borderColor: 'rgba(150, 188, 176, 0.14)' },
      timeScale: { borderColor: 'rgba(150, 188, 176, 0.14)', rightOffset: 5 },
      crosshair: { mode: 0 },
      localization: {
        locale: locale === 'ar' ? 'ar-MA' : locale === 'fr' ? 'fr-MA' : 'en-MA',
        priceFormatter: (price: number) => indexNumber(price, locale),
      },
    });
    const series = chart.addSeries(library.LineSeries, {
      color: '#44d7be',
      lineWidth: 2,
      crosshairMarkerVisible: true,
      priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
    });
    series.setData(
      filtered.map((point) => ({
        time: point.market_date,
        value: Number(point.close_value),
      })),
    );

    chart.timeScale().fitContent();
    chartRef.current = chart;

    const observer = new ResizeObserver((entries) => {
      const width = Math.max(1, Math.floor(entries[0]?.contentRect.width ?? 1));
      chart.resize(width, 420);
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      chart.remove();
      if (chartRef.current === chart) chartRef.current = null;
    };
  }, [filtered, locale, scriptFailed, scriptReady]);

  const fallbackValues = filtered.map((point) => Number(point.close_value));
  const max = Math.max(...fallbackValues, 1);
  const min = Math.min(...fallbackValues, max);
  const spread = Math.max(max - min, 0.000001);

  return (
    <section className="masi-hero-panel" aria-label={t.masiChartTitle}>
      <Script
        src="https://unpkg.com/lightweight-charts@5.2.0/dist/lightweight-charts.standalone.production.js"
        strategy="afterInteractive"
        onReady={() => {
          if (getLightweightCharts()) setScriptReady(true);
          else setScriptFailed(true);
        }}
        onError={() => setScriptFailed(true)}
      />
      <div className="masi-chart-head">
        <div>
          <p>{t.masiChartTitle}</p>
          <strong className="technical" dir="ltr">
            {displayPoint ? indexNumber(Number(displayPoint.close_value), locale) : '—'}
          </strong>
        </div>
        <div className="masi-chart-delta technical" dir="ltr">
          <span className={performance === null ? '' : performance >= 0 ? 'positive' : 'negative'}>
            {performance === null
              ? '—'
              : `${performance >= 0 ? '+' : ''}${performance.toFixed(2)}%`}
          </span>
          <small>{displayPoint?.market_date ?? latestDate ?? t.unavailable}</small>
        </div>
      </div>
      <div className="masi-range-controls" aria-label={t.period}>
        {rangeLabels.map((key) => {
          const available = availability.get(key) ?? false;
          return (
            <button
              className={key === range ? 'active' : ''}
              disabled={!available}
              key={key}
              onClick={() => setRange(key)}
              type="button"
            >
              {key}
            </button>
          );
        })}
      </div>
      {!scriptFailed && filtered.length >= 2 ? (
        <div ref={containerRef} className="masi-chart-canvas" />
      ) : null}
      {!scriptReady && !scriptFailed && filtered.length >= 2 ? (
        <p className="masi-chart-state">{t.loading}</p>
      ) : null}
      {(scriptFailed || filtered.length < 2) && filtered.length >= 2 ? (
        <div className="masi-fallback-chart" role="img" aria-label={t.masiChartTitle}>
          {filtered.map((point) => {
            const height = ((Number(point.close_value) - min) / spread) * 78 + 12;
            return <span key={point.market_date} style={{ height: `${height}%` }} />;
          })}
        </div>
      ) : null}
      {filtered.length < 2 ? <p className="masi-chart-state">{t.masiChartUnavailable}</p> : null}
    </section>
  );
}

function filterByRange(points: IndexPoint[], range: RangeKey) {
  const last = points.at(-1);
  if (!last) return [];
  if (range === 'YTD') {
    const start = `${last.market_date.slice(0, 4)}-01-01`;
    return points.filter((point) => point.market_date >= start);
  }
  const cutoff = new Date(`${last.market_date}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - (rangeDays[range] ?? 366));
  const cutoffIso = cutoff.toISOString().slice(0, 10);
  return points.filter((point) => point.market_date >= cutoffIso);
}

function indexNumber(value: number, locale: Locale) {
  return new Intl.NumberFormat(locale === 'ar' ? 'ar-MA' : locale === 'fr' ? 'fr-MA' : 'en-MA', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  }).format(value);
}

function getLightweightCharts() {
  return (window as unknown as Record<string, MasiLightweightCharts | undefined>)[
    'LightweightCharts'
  ];
}
