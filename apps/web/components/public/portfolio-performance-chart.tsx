'use client';

import Script from 'next/script';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Locale } from '@bvc/contracts';
import { getUi } from '@/lib/i18n';

export interface PortfolioChartPoint {
  date: string;
  totalValue: string;
  cumulativeReturn: string | null;
}

export interface BenchmarkChartPoint {
  market_date: string;
  close_value: string;
}

type PortfolioChartSeries = {
  setData(data: readonly Record<string, unknown>[]): void;
};

type PortfolioChartApi = {
  addSeries(definition: unknown, options?: Record<string, unknown>): PortfolioChartSeries;
  timeScale(): { fitContent(): void };
  resize(width: number, height: number): void;
  remove(): void;
};

type PortfolioLightweightCharts = {
  createChart(container: HTMLElement, options?: Record<string, unknown>): PortfolioChartApi;
  LineSeries: unknown;
};

export function PortfolioPerformanceChart({
  locale,
  portfolio,
  benchmark,
}: {
  locale: Locale;
  portfolio: PortfolioChartPoint[];
  benchmark: BenchmarkChartPoint[];
}) {
  const t = getUi(locale);
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<PortfolioChartApi | null>(null);
  const [scriptReady, setScriptReady] = useState(false);
  const [scriptFailed, setScriptFailed] = useState(false);

  const series = useMemo(() => {
    const portfolioSeries = portfolio
      .filter(
        (point) =>
          point.cumulativeReturn !== null && Number.isFinite(Number(point.cumulativeReturn)),
      )
      .map((point) => ({
        time: point.date,
        value: Number(point.cumulativeReturn) * 100,
      }));
    const benchmarkSeries = normalizeBenchmark(benchmark);
    return { portfolioSeries, benchmarkSeries };
  }, [benchmark, portfolio]);

  useEffect(() => {
    const library = getLightweightCharts();
    if (
      !scriptReady ||
      scriptFailed ||
      !containerRef.current ||
      !library ||
      series.portfolioSeries.length < 2
    )
      return;

    chartRef.current?.remove();
    const container = containerRef.current;
    const chart = library.createChart(container, {
      width: container.clientWidth,
      height: 420,
      layout: {
        background: { type: 'solid', color: '#071917' },
        textColor: '#8fa9a2',
        attributionLogo: true,
      },
      grid: {
        vertLines: { color: 'rgba(150, 188, 176, 0.08)' },
        horzLines: { color: 'rgba(150, 188, 176, 0.1)' },
      },
      rightPriceScale: { borderColor: 'rgba(150, 188, 176, 0.14)' },
      timeScale: { borderColor: 'rgba(150, 188, 176, 0.14)', rightOffset: 5 },
      localization: {
        locale: locale === 'ar' ? 'ar-MA' : locale === 'fr' ? 'fr-MA' : 'en-MA',
        priceFormatter: (value: number) => `${value.toFixed(2)}%`,
      },
    });

    const portfolioLine = chart.addSeries(library.LineSeries, {
      color: '#44d7be',
      lineWidth: 2,
      priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
    });
    portfolioLine.setData(series.portfolioSeries);

    if (series.benchmarkSeries.length >= 2) {
      const benchmarkLine = chart.addSeries(library.LineSeries, {
        color: '#c7a458',
        lineWidth: 2,
        priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
      });
      benchmarkLine.setData(series.benchmarkSeries);
    }

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
  }, [locale, scriptFailed, scriptReady, series]);

  return (
    <div className="portfolio-v2-chart-shell">
      <Script
        src="https://unpkg.com/lightweight-charts@5.2.0/dist/lightweight-charts.standalone.production.js"
        strategy="afterInteractive"
        onReady={() => {
          if (getLightweightCharts()) setScriptReady(true);
          else setScriptFailed(true);
        }}
        onError={() => setScriptFailed(true)}
      />
      <div className="portfolio-v2-chart-legend">
        <span>
          <i />
          {t.portfolioTitle}
        </span>
        <span>
          <i />
          MASI
        </span>
      </div>
      {!scriptFailed && series.portfolioSeries.length >= 2 ? (
        <div ref={containerRef} className="portfolio-v2-chart-canvas" />
      ) : null}
      {!scriptReady && !scriptFailed && series.portfolioSeries.length >= 2 ? (
        <p className="portfolio-v2-chart-state">{t.loading}</p>
      ) : null}
      {(scriptFailed || series.portfolioSeries.length < 2) && series.portfolioSeries.length >= 2 ? (
        <FallbackChart points={series.portfolioSeries} />
      ) : null}
      {series.portfolioSeries.length < 2 ? (
        <p className="portfolio-v2-chart-state">{t.insufficientHistory}</p>
      ) : null}
    </div>
  );
}

function normalizeBenchmark(points: BenchmarkChartPoint[]) {
  const ordered = points
    .filter((point) => Number.isFinite(Number(point.close_value)))
    .sort((left, right) => left.market_date.localeCompare(right.market_date));
  const first = ordered[0];
  if (!first) return [];
  const base = Number(first.close_value);
  if (!Number.isFinite(base) || base <= 0) return [];
  return ordered.map((point) => ({
    time: point.market_date,
    value: (Number(point.close_value) / base - 1) * 100,
  }));
}

function FallbackChart({ points }: { points: Array<{ time: string; value: number }> }) {
  const values = points.map((point) => point.value);
  const max = Math.max(...values, 1);
  const min = Math.min(...values, max);
  const spread = Math.max(max - min, 0.000001);
  return (
    <div className="portfolio-v2-fallback-chart" role="img">
      {points.map((point) => {
        const height = ((point.value - min) / spread) * 76 + 12;
        return <span key={point.time} style={{ height: `${height}%` }} />;
      })}
    </div>
  );
}

function getLightweightCharts() {
  return (window as unknown as Record<string, PortfolioLightweightCharts | undefined>)[
    'LightweightCharts'
  ];
}
