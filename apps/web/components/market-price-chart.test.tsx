import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MarketPriceChart } from './market-price-chart';

const history = [
  {
    market_date: '2026-08-27',
    open_price: '103',
    high_price: '103.2',
    low_price: '102.6',
    close_price: '103.2',
    volume: '257235',
  },
  {
    market_date: '2026-08-28',
    open_price: '103.2',
    high_price: '103.55',
    low_price: '102.75',
    close_price: '102.75',
    volume: '384665',
  },
];

describe('TradingView Lightweight Charts market surface', () => {
  it('renders period controls and explicit chart/data attribution in English', () => {
    const html = renderToStaticMarkup(
      createElement(MarketPriceChart, { locale: 'en', ticker: 'IAM', history }),
    );
    expect(html).toContain('1M');
    expect(html).toContain('3Y');
    expect(html).toContain('TradingView Lightweight Charts');
    expect(html).toContain('price data comes from SaifInvest');
  });

  it('keeps Arabic chart copy while technical chart direction remains isolated', () => {
    const html = renderToStaticMarkup(
      createElement(MarketPriceChart, { locale: 'ar', ticker: 'IAM', history }),
    );
    expect(html).toContain('بيانات الأسعار');
    expect(html).toContain('dir="ltr"');
  });
});
