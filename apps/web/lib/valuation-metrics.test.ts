import { describe, expect, it } from 'vitest';
import {
  dividendYield,
  earningsYield,
  enterpriseValue,
  evEbitda,
  fcfYield,
  marketCap,
  pb,
  pe,
} from './valuation-metrics';

describe('marketCap', () => {
  it('computes price * shares outstanding', () => {
    expect(marketCap('100', '1000000')).toBe(100_000_000);
  });
  it('is null when price or shares are missing, or shares are non-positive', () => {
    expect(marketCap(null, '1000000')).toBeNull();
    expect(marketCap('100', null)).toBeNull();
    expect(marketCap('100', '0')).toBeNull();
    expect(marketCap('100', '-5')).toBeNull();
  });
});

describe('enterpriseValue', () => {
  it('computes market_cap + debt - cash', () => {
    expect(enterpriseValue(1000, '400', '150')).toBe(1250);
  });
  it('allows a negative EV for a net-cash company', () => {
    expect(enterpriseValue(100, '10', '500')).toBe(-390);
  });
  it('is null when market cap, debt, or cash is missing (blank is not zero)', () => {
    expect(enterpriseValue(null, '400', '150')).toBeNull();
    expect(enterpriseValue(1000, null, '150')).toBeNull();
    expect(enterpriseValue(1000, '400', null)).toBeNull();
  });
});

describe('pe', () => {
  it('computes market_cap / net_income for a profitable company', () => {
    expect(pe(1000, '100')).toBe(10);
  });
  it('is null for zero net income', () => {
    expect(pe(1000, '0')).toBeNull();
  });
  it('is null for negative net income (not a meaningful multiple)', () => {
    expect(pe(1000, '-50')).toBeNull();
  });
  it('is null when net income is missing', () => {
    expect(pe(1000, null)).toBeNull();
  });
  it('is null when market cap is missing (missing price or missing shares)', () => {
    expect(pe(null, '100')).toBeNull();
  });
  it('is mathematically equivalent to price / EPS when EPS derives from the same net income and share count', () => {
    const price = 120;
    const shares = 50;
    const netIncome = 300;
    const marketCapValue = price * shares;
    const eps = netIncome / shares;
    expect(pe(marketCapValue, String(netIncome))).toBeCloseTo(price / eps, 10);
  });
});

describe('pb', () => {
  it('computes market_cap / total_equity for positive equity', () => {
    expect(pb(1000, '500')).toBe(2);
  });
  it('is null for zero equity', () => {
    expect(pb(1000, '0')).toBeNull();
  });
  it('is null for negative equity', () => {
    expect(pb(1000, '-200')).toBeNull();
  });
});

describe('evEbitda', () => {
  it('computes EV / EBITDA for positive EBITDA', () => {
    expect(evEbitda(1000, '200')).toBe(5);
  });
  it('is null for zero EBITDA', () => {
    expect(evEbitda(1000, '0')).toBeNull();
  });
  it('is null for negative EBITDA', () => {
    expect(evEbitda(1000, '-50')).toBeNull();
  });
  it('is computed even when EV itself is negative, as long as EBITDA is positive', () => {
    expect(evEbitda(-100, '50')).toBe(-2);
  });
});

describe('dividendYield', () => {
  it('computes dividend_per_share / price when a dividend exists', () => {
    expect(dividendYield('4', '100')).toBe(0.04);
  });
  it('is a real zero when the dividend is known to be exactly zero', () => {
    expect(dividendYield('0', '100')).toBe(0);
  });
  it('is null when the dividend is missing (blank, not zero)', () => {
    expect(dividendYield(null, '100')).toBeNull();
  });
  it('is null when price is missing or zero', () => {
    expect(dividendYield('4', null)).toBeNull();
    expect(dividendYield('4', '0')).toBeNull();
  });
});

describe('earningsYield', () => {
  it('computes net_income / market_cap for a profitable company', () => {
    expect(earningsYield('100', 1000)).toBe(0.1);
  });
  it('stays meaningful (negative, not null) for a loss-making company', () => {
    expect(earningsYield('-50', 1000)).toBe(-0.05);
  });
  it('is null when net income or market cap is missing', () => {
    expect(earningsYield(null, 1000)).toBeNull();
    expect(earningsYield('100', null)).toBeNull();
  });
});

describe('fcfYield', () => {
  it('computes free_cash_flow / market_cap', () => {
    expect(fcfYield(80, 1000)).toBe(0.08);
  });
  it('stays meaningful (negative, not null) for negative free cash flow', () => {
    expect(fcfYield(-40, 1000)).toBe(-0.04);
  });
  it('is null when free cash flow or market cap is missing', () => {
    expect(fcfYield(null, 1000)).toBeNull();
    expect(fcfYield(80, null)).toBeNull();
  });
});
