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
  priceScale?: () => { applyOptions(options: Record<string, unknown>): void };
};

type ChartApi = {
  addSeries(definition: unknown, options?: Record<string, unknown>): ChartSeries;
  timeScale(): {
    fitContent(): void;
  };
  resize(width: number, height: number): void;
  remove(): void;
};

type LightweightChartsGlobal = {
  createChart(container: HTMLElement, options?: Record<string, unknown>): ChartApi;
  CandlestickSeries: unknown;
  LineSeries: unknown;
  HistogramSeries: unknown;
};

declare global {
  interface Window {
    LightweightCharts?: LightweightChartsGlobal;
  }
}

type RangeKey = '1M' | '3M' | '1Y' | '3Y';

const rangeDays: Record<RangeKey, number> = {
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
  },
  fr: {
    loading: 'Chargement du graphique interactif…',
    unavailable: 'Graphique interactif indisponible ; affichage de l’historique simplifié.',
    attribution: 'TradingView',
    dataBoundary:
      'TradingView fournit uniquement la bibliothèque graphique ; les prix proviennent de SaifInvest.',
  },
  ar: {
    loading: 'جارٍ تحميل الرسم التفاعلي…',
    unavailable: 'الرسم التفاعلي غير متاح؛ يتم عرض سجل أسعار مبسط.',
    attribution: 'TradingView',
    dataBoundary: 'توفر TradingView مكتبة الرسم فقط؛ أما بيانات الأسعار فتأتي من SaifInvest.',
  },
} as const;

const isFinitePrice = (value: string | null) => value !== null && Number.isFinite(Number(value));

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
  const [scriptReady, setScriptReady] = useState(false);
  const [scriptFailed, setScriptFailed] = useState(false);
  const [range, setRange] = useState<RangeKey>('1Y');
  const t = copy[locale];

  const filtered = useMemo(() => {
    const ordered = [...history].sort((a, b) => a.market_date.localeCompare(b.market_date));
    const last = ordered.at(-1);
    if (!last) return ordered;
    const cutoff = new Date(`${last.market_date}T00:00:00Z`);
    cutoff.setUTCDate(cutoff.getUTCDate() - rangeDays[range]);
    const cutoffIso = cutoff.toISOString().slice(0, 10);
    return ordered.filter((point) => point.market_date >= cutoffIso);
  }, [history, range]);

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
      !window.LightweightCharts ||
      !filtered.length
    )
      return;

    chartRef.current?.remove();
    const library = window.LightweightCharts;
    const container = containerRef.current;
    const styles = getComputedStyle(container);
    const textColor = styles.getPropertyValue('--muted').trim() || '#64716b';
    const lineColor = styles.getPropertyValue('--line').trim() || '#d8dfda';
    const surface = styles.getPropertyValue('--surface').trim() || '#ffffff';
    const green = styles.getPropertyValue('--green').trim() || '#153f31';
    const green2 = styles.getPropertyValue('--green-2').trim() || '#43866c';

    const chart = library.createChart(container, {
      width: container.clientWidth,
      height: 360,
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

    if (hasCandles) {
      const candleSeries = chart.addSeries(library.CandlestickSeries, {
        upColor: green2,
        downColor: '#a34747',
        wickUpColor: green2,
        wickDownColor: '#a34747',
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
    } else {
      const lineSeries = chart.addSeries(library.LineSeries, {
        color: green,
        lineWidth: 2,
        priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
      });
      lineSeries.setData(
        filtered.map((point) => ({ time: point.market_date, value: Number(point.close_price) })),
      );
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

    chart.timeScale().fitContent();
    chartRef.current = chart;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) chart.resize(Math.max(1, Math.floor(entry.contentRect.width)), 360);
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      chart.remove();
      if (chartRef.current === chart) chartRef.current = null;
    };
  }, [filtered, hasCandles, locale, scriptFailed, scriptReady]);

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
          if (window.LightweightCharts) setScriptReady(true);
          else setScriptFailed(true);
        }}
        onError={() => setScriptFailed(true)}
      />
      <div className="market-chart-toolbar" aria-label={`${ticker} chart period`}>
        {(Object.keys(rangeDays) as RangeKey[]).map((key) => (
          <button
            key={key}
            type="button"
            className={key === range ? 'active' : ''}
            onClick={() => setRange(key)}
          >
            {key}
          </button>
        ))}
      </div>
      {!scriptFailed ? (
        <div
          ref={containerRef}
          className="tradingview-chart"
          aria-label={`${ticker} price chart`}
        />
      ) : null}
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
