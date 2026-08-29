import { describe, expect, it } from 'vitest';
import { calculateRiskSummary, riskBand } from './risk';

describe('MVP portfolio risk indicator', () => {
  it('uses the documented five score bands', () => {
    expect(riskBand(20)).toBe('very_low');
    expect(riskBand(21)).toBe('low');
    expect(riskBand(60)).toBe('moderate');
    expect(riskBand(80)).toBe('high');
    expect(riskBand(81)).toBe('very_high');
  });

  it('stays unavailable when history is insufficient', () => {
    const result = calculateRiskSummary({
      positions: [{ weightPercent: '70' }, { weightPercent: '30' }],
      cashValue: '0',
      totalValue: '1000',
      annualizedVolatility: 0.2,
      maxDrawdown: -0.15,
      observationCount: 59,
    });
    expect(result.score).toBeNull();
    expect(result.largestPositionPercent).toBe(70);
  });

  it('reduces an otherwise identical risk score when cash is higher', () => {
    const common = {
      positions: [{ weightPercent: '60' }, { weightPercent: '30' }],
      totalValue: '1000',
      annualizedVolatility: 0.24,
      maxDrawdown: -0.2,
      observationCount: 100,
    } as const;
    const lowCash = calculateRiskSummary({ ...common, cashValue: '50' });
    const highCash = calculateRiskSummary({ ...common, cashValue: '500' });
    expect(lowCash.score).not.toBeNull();
    expect(highCash.score).not.toBeNull();
    expect(highCash.score!).toBeLessThan(lowCash.score!);
  });
});
