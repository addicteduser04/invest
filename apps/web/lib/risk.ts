export type RiskBand = 'very_low' | 'low' | 'moderate' | 'high' | 'very_high';

export interface RiskPositionInput {
  weightPercent: string | null;
}

export interface RiskSummary {
  score: number | null;
  band: RiskBand | null;
  concentrationScore: number;
  volatilityScore: number | null;
  drawdownScore: number | null;
  largestPositionPercent: number;
  topFivePercent: number;
  cashPercent: number | null;
  observationCount: number;
}

const clamp = (value: number, minimum = 0, maximum = 100) =>
  Math.min(maximum, Math.max(minimum, value));

export function riskBand(score: number): RiskBand {
  if (score <= 20) return 'very_low';
  if (score <= 40) return 'low';
  if (score <= 60) return 'moderate';
  if (score <= 80) return 'high';
  return 'very_high';
}

/**
 * Transparent MVP risk indicator. It is descriptive, not investment advice.
 *
 * The score is available only when at least 60 complete portfolio-return
 * observations exist and both volatility and drawdown are calculable.
 * Concentration carries 40% of the raw score, annualized volatility 35%, and
 * drawdown 25%. A higher cash share reduces the final score continuously.
 */
export function calculateRiskSummary({
  positions,
  cashValue,
  totalValue,
  annualizedVolatility,
  maxDrawdown,
  observationCount,
}: {
  positions: readonly RiskPositionInput[];
  cashValue: string | null | undefined;
  totalValue: string | null | undefined;
  annualizedVolatility: number | null;
  maxDrawdown: number | null;
  observationCount: number;
}): RiskSummary {
  const weights = positions
    .map((position) => Number(position.weightPercent ?? '0'))
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((a, b) => b - a);
  const largestPositionPercent = weights[0] ?? 0;
  const topFivePercent = weights.slice(0, 5).reduce((sum, value) => sum + value, 0);
  const concentrationScore = Math.round(
    clamp(0.7 * (largestPositionPercent / 40) * 100 + 0.3 * (topFivePercent / 85) * 100),
  );

  const total = Number(totalValue ?? '');
  const cash = Number(cashValue ?? '');
  const cashPercent =
    Number.isFinite(total) && total > 0 && Number.isFinite(cash)
      ? clamp((cash / total) * 100)
      : null;

  const volatilityScore =
    annualizedVolatility === null ? null : Math.round(clamp((annualizedVolatility / 0.4) * 100));
  const drawdownScore =
    maxDrawdown === null ? null : Math.round(clamp((Math.abs(maxDrawdown) / 0.4) * 100));

  if (observationCount < 60 || volatilityScore === null || drawdownScore === null) {
    return {
      score: null,
      band: null,
      concentrationScore,
      volatilityScore,
      drawdownScore,
      largestPositionPercent,
      topFivePercent,
      cashPercent,
      observationCount,
    };
  }

  const raw = 0.4 * concentrationScore + 0.35 * volatilityScore + 0.25 * drawdownScore;
  const investedShare = cashPercent === null ? 1 : clamp(1 - cashPercent / 100, 0, 1);
  const cashAdjustment = 0.55 + 0.45 * investedShare;
  const score = Math.round(clamp(raw * cashAdjustment));

  return {
    score,
    band: riskBand(score),
    concentrationScore,
    volatilityScore,
    drawdownScore,
    largestPositionPercent,
    topFivePercent,
    cashPercent,
    observationCount,
  };
}
