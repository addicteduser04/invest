'use client';

import Script from 'next/script';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Locale } from '@bvc/contracts';

type HistoryPoint = {
  market_date: string;
  open_price: string | null;
  high_price: string | null;
  low_price: string | null;
  close_price: string;
  volume: string | null;
};

type ChartSeries = {
  setData(data: readonly Record<string, unknown>[]): void;
  createPriceLine?(options: Record<string, unknown>): void;
  priceScale?: () => { applyOptions(options: Record<string, unknown>): void };
};

type CrosshairParam = {
  point?: { x: number; y: number };
  time?: string;
  seriesData?: Map<ChartSeries, unknown>;
};

type ChartApi = {
  addSeries(definition: unknown, options?: Record<string, unknown>): ChartSeries;
  timeScale(): {
    fitContent(): void;
  };
  resize(width: number, height: number): void;
  remove(): void;
  subscribeCrosshairMove?(handler: (param: CrosshairParam) => void): void;
  unsubscribeCrosshairMove?(handler: (param: CrosshairParam) => void): void;
};

type LightweightChartsGlobal = {
  createChart(container: HTMLElement, options?: Record<string, unknown>): ChartApi;
  CandlestickSeries: unknown;
  LineSeries: unknown;
  HistogramSeries: unknown;
};

type RangeKey = '1M' | '3M' | 'YTD' | '1Y' | '3Y';

const rangeDays: Record<Exclude<RangeKey, 'YTD'>, number> = {
  '1M': 31,
  '3M': 93,
  '1Y': 366,
  '3Y': 1098,
};

const copy = {
  en: {
    loading: 'Loading interactive chart…',
    unavailable: 'Interactive chart unavailable; showing a simple price history fallback.',
    attribution: 'TradingView',
    dataBoundary:
      'TradingView provides the charting library only; price data comes from SaifInvest.',
    shortened: 'Range shortened to available local history.',
  },
  fr: {
    loading: 'Chargement du graphique interactif…',
    unavailable: 'Graphique interactif indisponible ; affichage de l’historique simplifié.',
    attribution: 'TradingView',
    dataBoundary:
      'TradingView fournit uniquement la bibliothèque graphique ; les prix proviennent de SaifInvest.',
    shortened: 'Période limitée par l’historique local disponible.',
  },
  ar: {
    loading: 'جارٍ تحميل الرسم التفاعلي…',
    unavailable: 'الرسم التفاعلي غير متاح؛ يتم عرض سجل أسعار مبسط.',
    attribution: 'TradingView',
    dataBoundary: 'توفر TradingView مكتبة الرسم فقط؛ أما بيانات الأسعار فتأتي من SaifInvest.',
    shortened: 'تم تقصير الفترة حسب السجل المحلي المتاح.',
  },
} as const;

const isFinitePrice = (value: string | null) => value !== null && Number.isFinite(Number(value));

function rangeStart(range: RangeKey, latestDate: string) {
  if (range === 'YTD') return `${latestDate.slice(0, 4)}-01-01`;
  const cutoff = new Date(`${latestDate}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - rangeDays[range]);
  return cutoff.toISOString().slice(0, 10);
}

export function MarketPriceChart({
  locale,
  ticker,
  history,
}: {
  locale: Locale;
  ticker: string;
  history: HistoryPoint[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ChartApi | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [scriptReady, setScriptReady] = useState(false);
  const [scriptFailed, setScriptFailed] = useState(false);
  const [range, setRange] = useState<RangeKey>('1Y');
  const t = copy[locale];
  const orderedHistory = useMemo(
    () => [...history].sort((a, b) => a.market_date.localeCompare(b.market_date)),
    [history],
  );

  const filtered = useMemo(() => {
    const last = orderedHistory.at(-1);
    if (!last) return orderedHistory;
    const cutoffIso = rangeStart(range, last.market_date);
    const scoped = orderedHistory.filter((point) => point.market_date >= cutoffIso);
    return scoped.length >= 2 ? scoped : orderedHistory;
  }, [orderedHistory, range]);

  const firstAvailable = orderedHistory[0]?.market_date ?? null;
  const lastAvailable = orderedHistory.at(-1)?.market_date ?? null;
  const rangeShortened =
    Boolean(firstAvailable && lastAvailable) &&
    filtered[0]?.market_date === firstAvailable &&
    rangeStart(range, lastAvailable ?? firstAvailable ?? '') < firstAvailable;

  const hasCandles =
    filtered.filter(
      (point) =>
        isFinitePrice(point.open_price) &&
        isFinitePrice(point.high_price) &&
        isFinitePrice(point.low_price) &&
        Number.isFinite(Number(point.close_price)),
    ).length >= Math.min(2, filtered.length);

  useEffect(() => {
    if (
      !scriptReady ||
      scriptFailed ||
      !containerRef.current ||
      !getLightweightCharts() ||
      !filtered.length
    )
      return;

    chartRef.current?.remove();
    const library = getLightweightCharts()!;
    const container = containerRef.current;
    const styles = getComputedStyle(container);
    const textColor = styles.getPropertyValue('--muted').trim() || '#64716b';
    const lineColor = styles.getPropertyValue('--line').trim() || '#d8dfda';
    const surface = styles.getPropertyValue('--surface').trim() || '#ffffff';
    const green2 = styles.getPropertyValue('--green-2').trim() || '#43866c';

    const chart = library.createChart(container, {
      width: container.clientWidth,
      height: 420,
      layout: {
        background: { type: 'solid', color: surface },
        textColor,
        attributionLogo: true,
      },
      grid: {
        vertLines: { color: lineColor },
        horzLines: { color: lineColor },
      },
      rightPriceScale: {
        borderColor: lineColor,
      },
      timeScale: {
        borderColor: lineColor,
        timeVisible: false,
        rightOffset: 4,
      },
      crosshair: {
        mode: 0,
      },
      localization: {
        locale: locale === 'ar' ? 'ar-MA' : locale === 'fr' ? 'fr-MA' : 'en-MA',
        priceFormatter: (price: number) => `${price.toFixed(2)} MAD`,
      },
    });

    let primarySeries: ChartSeries;
    if (hasCandles) {
      const candleSeries = chart.addSeries(library.CandlestickSeries, {
        upColor: green2,
        downColor: '#e05c58',
        wickUpColor: green2,
        wickDownColor: '#e05c58',
        borderVisible: false,
        priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
      });
      candleSeries.setData(
        filtered
          .filter(
            (point) =>
              isFinitePrice(point.open_price) &&
              isFinitePrice(point.high_price) &&
              isFinitePrice(point.low_price) &&
              Number.isFinite(Number(point.close_price)),
          )
          .map((point) => ({
            time: point.market_date,
            open: Number(point.open_price),
            high: Number(point.high_price),
            low: Number(point.low_price),
            close: Number(point.close_price),
          })),
      );
      primarySeries = candleSeries;
    } else {
      const lineSeries = chart.addSeries(library.LineSeries, {
        color: green2,
        lineWidth: 2,
        priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
      });
      lineSeries.setData(
        filtered.map((point) => ({ time: point.market_date, value: Number(point.close_price) })),
      );
      primarySeries = lineSeries;
    }

    const latest = filtered.at(-1);
    if (latest) {
      primarySeries.createPriceLine?.({
        price: Number(latest.close_price),
        color: green2,
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: `${ticker} ${Number(latest.close_price).toFixed(2)}`,
      });
    }

    const volumeRows = filtered.filter(
      (point) => point.volume !== null && Number.isFinite(Number(point.volume)),
    );
    if (volumeRows.length) {
      const volumeSeries = chart.addSeries(library.HistogramSeries, {
        priceFormat: { type: 'volume' },
        priceScaleId: '',
        color: 'rgba(67, 134, 108, 0.28)',
      });
      volumeSeries.setData(
        volumeRows.map((point) => ({
          time: point.market_date,
          value: Number(point.volume),
          color: 'rgba(67, 134, 108, 0.28)',
        })),
      );
      const volumeScale = volumeSeries.priceScale?.();
      volumeScale?.applyOptions({
        scaleMargins: { top: 0.82, bottom: 0 },
      });
    }

    const showTooltip = (param: CrosshairParam) => {
      const tooltip = tooltipRef.current;
      if (!tooltip || !param.point || !param.time) {
        if (tooltip) tooltip.style.opacity = '0';
        return;
      }
      const row = filtered.find((point) => point.market_date === param.time);
      if (!row) {
        tooltip.style.opacity = '0';
        return;
      }
      tooltip.textContent = `${row.market_date}\nO ${row.open_price ?? '—'} H ${
        row.high_price ?? '—'
      } L ${row.low_price ?? '—'} C ${row.close_price}\nVOL ${row.volume ?? '—'}`;
      tooltip.style.opacity = '1';
      tooltip.style.transform = `translate(${Math.min(param.point.x + 14, container.clientWidth - 190)}px, ${Math.max(
        10,
        param.point.y - 34,
      )}px)`;
    };

    chart.subscribeCrosshairMove?.(showTooltip);
    chart.timeScale().fitContent();
    chartRef.current = chart;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) chart.resize(Math.max(1, Math.floor(entry.contentRect.width)), 420);
    });
    observer.observe(container);

    return () => {
      chart.unsubscribeCrosshairMove?.(showTooltip);
      observer.disconnect();
      chart.remove();
      if (chartRef.current === chart) chartRef.current = null;
    };
  }, [filtered, hasCandles, locale, scriptFailed, scriptReady, ticker]);

  const fallbackValues = filtered.map((point) => Number(point.close_price)).filter(Number.isFinite);
  const max = Math.max(...fallbackValues, 1);
  const min = Math.min(...fallbackValues, max);
  const spread = Math.max(max - min, 0.000001);

  return (
    <div className="market-chart-shell" dir="ltr">
      <Script
        src="https://unpkg.com/lightweight-charts@5.2.0/dist/lightweight-charts.standalone.production.js"
        strategy="afterInteractive"
        onReady={() => {
          if (getLightweightCharts()) setScriptReady(true);
          else setScriptFailed(true);
        }}
        onError={() => setScriptFailed(true)}
      />
      <div className="market-chart-toolbar" aria-label={`${ticker} chart period`}>
        {(['1M', '3M', 'YTD', '1Y', '3Y'] as RangeKey[]).map((key) => (
          <button
            key={key}
            type="button"
            className={key === range ? 'active' : ''}
            disabled={orderedHistory.length < 2}
            onClick={() => setRange(key)}
          >
            {key}
          </button>
        ))}
      </div>
      {!scriptFailed ? (
        <div className="tradingview-chart-wrap">
          <div
            ref={containerRef}
            className="tradingview-chart"
            aria-label={`${ticker} price chart`}
          />
          <div ref={tooltipRef} className="market-chart-tooltip" aria-hidden="true" />
        </div>
      ) : null}
      {rangeShortened ? <p className="chart-loading">{t.shortened}</p> : null}
      {!scriptReady && !scriptFailed ? <p className="chart-loading">{t.loading}</p> : null}
      {scriptFailed ? (
        <>
          <p className="chart-loading">{t.unavailable}</p>
          <div
            className="price-chart chart-fallback"
            role="img"
            aria-label={`${ticker} price history`}
          >
            {filtered.map((point) => {
              const height = ((Number(point.close_price) - min) / spread) * 85 + 8;
              return (
                <span
                  key={point.market_date}
                  style={{ height: `${height}%` }}
                  title={`${point.market_date}: ${point.close_price} MAD`}
                />
              );
            })}
          </div>
        </>
      ) : null}
      <p className="chart-data-boundary">{t.dataBoundary}</p>
      <div className="tradingview-attribution">
        <span>TradingView Lightweight Charts™ — Copyright (c) 2025 TradingView, Inc.</span>{' '}
        <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">
          {t.attribution}
        </a>
      </div>
    </div>
  );
}

function getLightweightCharts() {
  return (window as unknown as Record<string, LightweightChartsGlobal | undefined>)[
    'LightweightCharts'
  ];
}
