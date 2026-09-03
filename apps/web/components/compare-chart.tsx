'use client';

import Script from 'next/script';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Locale } from '@bvc/contracts';
import { getUi } from '@/lib/i18n';
import {
  comparePeriods,
  periodCutoff,
  rebaseToHundred,
  type ComparePeriod,
  type ComparePricePoint,
} from '@/lib/compare-metrics';

export interface CompareSeriesInput {
  id: string;
  ticker: string;
  name: string;
  color: string;
  points: ComparePricePoint[];
}

type ChartLineSeries = {
  setData(data: readonly Record<string, unknown>[]): void;
};

type CrosshairParam = {
  point?: { x: number; y: number };
  time?: string;
  seriesData?: Map<ChartLineSeries, unknown>;
};

type ChartApi = {
  addSeries(definition: unknown, options?: Record<string, unknown>): ChartLineSeries;
  timeScale(): { fitContent(): void };
  resize(width: number, height: number): void;
  remove(): void;
  subscribeCrosshairMove?(handler: (param: CrosshairParam) => void): void;
  unsubscribeCrosshairMove?(handler: (param: CrosshairParam) => void): void;
};

type LightweightChartsGlobal = {
  createChart(container: HTMLElement, options?: Record<string, unknown>): ChartApi;
  LineSeries: unknown;
};

export function CompareChart({
  locale,
  series,
  range,
  onRangeChange,
}: {
  locale: Locale;
  series: CompareSeriesInput[];
  range: ComparePeriod;
  onRangeChange: (range: ComparePeriod) => void;
}) {
  const t = getUi(locale);
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ChartApi | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [scriptReady, setScriptReady] = useState(false);
  const [scriptFailed, setScriptFailed] = useState(false);

  const latestDate = useMemo(
    () =>
      series
        .flatMap((entry) => entry.points.map((point) => point.market_date))
        .sort()
        .at(-1) ?? null,
    [series],
  );

  const rebased = useMemo(() => {
    if (!latestDate) return [];
    const cutoff = periodCutoff(range, latestDate);
    return series.map((entry) => {
      const scoped = entry.points.filter((point) => point.market_date >= cutoff);
      const usable = scoped.length >= 2 ? scoped : entry.points;
      return { ...entry, rebased: rebaseToHundred(usable) };
    });
  }, [series, range, latestDate]);

  const insufficient = rebased.filter((entry) => entry.rebased.length < 2);
  const plottable = rebased.filter((entry) => entry.rebased.length >= 2);

  useEffect(() => {
    const library = getLightweightCharts();
    if (!scriptReady || scriptFailed || !containerRef.current || !library || !plottable.length)
      return;

    chartRef.current?.remove();
    const container = containerRef.current;
    const chart = library.createChart(container, {
      width: container.clientWidth,
      height: 420,
      layout: {
        background: { type: 'solid', color: '#071917' },
        textColor: '#8fa9a2',
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: 'rgba(150, 188, 176, 0.08)' },
        horzLines: { color: 'rgba(150, 188, 176, 0.1)' },
      },
      rightPriceScale: { borderColor: 'rgba(150, 188, 176, 0.14)' },
      timeScale: { borderColor: 'rgba(150, 188, 176, 0.14)', rightOffset: 5 },
      crosshair: { mode: 0 },
      localization: {
        locale: locale === 'ar' ? 'ar-MA' : locale === 'fr' ? 'fr-MA' : 'en-MA',
        priceFormatter: (value: number) => value.toFixed(1),
      },
    });

    const registered: Array<{ series: ChartLineSeries; ticker: string; color: string }> = [];
    for (const entry of plottable) {
      const line = chart.addSeries(library.LineSeries, {
        color: entry.color,
        lineWidth: 2,
        priceFormat: { type: 'price', precision: 1, minMove: 0.1 },
      });
      line.setData(entry.rebased.map((point) => ({ time: point.market_date, value: point.value })));
      registered.push({ series: line, ticker: entry.ticker, color: entry.color });
    }

    const showTooltip = (param: CrosshairParam) => {
      const tooltip = tooltipRef.current;
      if (!tooltip || !param.point || !param.time || !param.seriesData) {
        if (tooltip) tooltip.style.opacity = '0';
        return;
      }
      const lines = registered
        .map(({ series: lineSeries, ticker }) => {
          const value = param.seriesData?.get(lineSeries) as
            { value?: number } | number | undefined;
          const numeric = typeof value === 'number' ? value : value?.value;
          return numeric === undefined ? null : `${ticker}  ${numeric.toFixed(1)}`;
        })
        .filter((line): line is string => line !== null);
      if (!lines.length) {
        tooltip.style.opacity = '0';
        return;
      }
      tooltip.textContent = `${param.time}\n${lines.join('\n')}`;
      tooltip.style.opacity = '1';
      tooltip.style.transform = `translate(${Math.min(param.point.x + 14, container.clientWidth - 170)}px, ${Math.max(
        10,
        param.point.y - 20,
      )}px)`;
    };

    chart.subscribeCrosshairMove?.(showTooltip);
    chart.timeScale().fitContent();
    chartRef.current = chart;
    const observer = new ResizeObserver((entries) => {
      const width = Math.max(1, Math.floor(entries[0]?.contentRect.width ?? 1));
      chart.resize(width, 420);
    });
    observer.observe(container);

    return () => {
      chart.unsubscribeCrosshairMove?.(showTooltip);
      observer.disconnect();
      chart.remove();
      if (chartRef.current === chart) chartRef.current = null;
    };
  }, [locale, plottable, scriptFailed, scriptReady]);

  return (
    <div className="compare-v2-chart-shell" dir="ltr">
      <Script
        src="https://unpkg.com/lightweight-charts@5.2.0/dist/lightweight-charts.standalone.production.js"
        strategy="afterInteractive"
        onReady={() => {
          if (getLightweightCharts()) setScriptReady(true);
          else setScriptFailed(true);
        }}
        onError={() => setScriptFailed(true)}
      />
      <div className="compare-v2-chart-head">
        <div className="compare-v2-chart-legend">
          {series.map((entry) => (
            <span key={entry.id}>
              <i style={{ background: entry.color }} />
              <b dir="ltr">{entry.ticker}</b>
            </span>
          ))}
        </div>
        <div className="compare-v2-chart-toolbar" aria-label={t.period}>
          {comparePeriods.map((key) => (
            <button
              key={key}
              type="button"
              className={key === range ? 'active' : ''}
              onClick={() => onRangeChange(key)}
            >
              {key === 'YTD' ? t.yearToDate : key}
            </button>
          ))}
        </div>
      </div>

      {plottable.length ? (
        <div className="compare-v2-chart-canvas-wrap">
          <div
            ref={containerRef}
            className="compare-v2-chart-canvas"
            aria-label={t.compareChartTitle}
          />
          <div ref={tooltipRef} className="compare-v2-chart-tooltip" aria-hidden="true" />
        </div>
      ) : (
        <p className="compare-v2-chart-state">{t.compareInsufficientHistory}</p>
      )}
      {!scriptReady && !scriptFailed && plottable.length ? (
        <p className="compare-v2-chart-state">{t.loading}</p>
      ) : null}

      {insufficient.length ? (
        <p className="compare-v2-chart-note">
          {t.compareMissingHistory}{' '}
          {insufficient.map((entry, index) => (
            <span key={entry.id} dir="ltr">
              {entry.ticker}
              {index < insufficient.length - 1 ? ', ' : ''}
            </span>
          ))}
        </p>
      ) : null}
      <p className="compare-v2-chart-explainer">{t.compareRebaseExplainer}</p>
    </div>
  );
}

function getLightweightCharts() {
  return (window as unknown as Record<string, LightweightChartsGlobal | undefined>)[
    'LightweightCharts'
  ];
}
