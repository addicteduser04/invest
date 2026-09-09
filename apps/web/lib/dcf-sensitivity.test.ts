import { describe, expect, it } from 'vitest';
import { buildDefaultSensitivityAxes, buildSensitivityMatrix } from './dcf-sensitivity';
import { runDcf } from './dcf-model';
import type { DcfAssumptionsInput } from './dcf-validation';

const base = { baseRevenue: 1000, cash: 100, totalDebt: 200, sharesOutstanding: 100 };
const assumptions: DcfAssumptionsInput = {
  forecastYears: 5,
  revenueGrowth: 0.1,
  ebitMargin: 0.2,
  taxRate: 0.25,
  daPercentRevenue: 0.05,
  capexPercentRevenue: 0.06,
  changeNwcPercentRevenue: 0.01,
  wacc: 0.1,
  terminalGrowth: 0.02,
};

describe('buildDefaultSensitivityAxes', () => {
  it('centers a 5-value axis on the base-case wacc and terminal growth, in 1pp / 0.5pp steps', () => {
    const axes = buildDefaultSensitivityAxes(0.1, 0.02);
    expect(axes.waccAxis).toHaveLength(5);
    expect(axes.terminalGrowthAxis).toHaveLength(5);
    expect(axes.waccAxis[2]).toBeCloseTo(0.1, 10);
    expect(axes.waccAxis).toEqual([0.08, 0.09, 0.1, 0.11, 0.12].map((v) => expect.closeTo(v, 10)));
    expect(axes.terminalGrowthAxis[2]).toBeCloseTo(0.02, 10);
    expect(axes.terminalGrowthAxis).toEqual(
      [0.01, 0.015, 0.02, 0.025, 0.03].map((v) => expect.closeTo(v, 10)),
    );
  });
});

describe('buildSensitivityMatrix', () => {
  const axes = buildDefaultSensitivityAxes(assumptions.wacc!, assumptions.terminalGrowth!);
  const matrix = buildSensitivityMatrix(base, assumptions, axes.waccAxis, axes.terminalGrowthAxis);

  it('has matrix dimensions matching the two axes (5x5 by default)', () => {
    expect(matrix.cells).toHaveLength(5);
    for (const row of matrix.cells) expect(row).toHaveLength(5);
  });

  it('marks the base-case cell (center) and matches the direct runDcf value there', () => {
    const centerCell = matrix.cells[2]![2]!;
    expect(centerCell.isBaseCase).toBe(true);
    expect(centerCell.invalid).toBe(false);
    const direct = runDcf(base, assumptions);
    expect(centerCell.valuePerShare).toBeCloseTo(direct.result!.valuePerShare!, 6);
  });

  it('marks only the center cell as the base case', () => {
    const flagged = matrix.cells.flat().filter((c) => c.isBaseCase);
    expect(flagged).toHaveLength(1);
  });

  it('never computes an invalid cell where wacc <= terminal growth, returning null with invalid=true instead', () => {
    const wideAxes = { waccAxis: [0.01, 0.02, 0.03], terminalGrowthAxis: [0.02, 0.03, 0.04] };
    const wideMatrix = buildSensitivityMatrix(
      base,
      assumptions,
      wideAxes.waccAxis,
      wideAxes.terminalGrowthAxis,
    );
    for (let i = 0; i < wideAxes.waccAxis.length; i += 1) {
      for (let j = 0; j < wideAxes.terminalGrowthAxis.length; j += 1) {
        const wacc = wideAxes.waccAxis[i]!;
        const g = wideAxes.terminalGrowthAxis[j]!;
        const cell = wideMatrix.cells[i]![j]!;
        if (wacc <= g) {
          expect(cell.invalid).toBe(true);
          expect(cell.valuePerShare).toBeNull();
        } else {
          expect(cell.invalid).toBe(false);
        }
      }
    }
  });

  it('produces deterministic valuation values across repeated calls', () => {
    const again = buildSensitivityMatrix(base, assumptions, axes.waccAxis, axes.terminalGrowthAxis);
    expect(again.cells).toEqual(matrix.cells);
  });

  it('produces higher per-share values for lower wacc / higher terminal growth (monotonic sanity check)', () => {
    const lowWacc = matrix.cells[0]![2]!.valuePerShare!;
    const highWacc = matrix.cells[4]![2]!.valuePerShare!;
    expect(lowWacc).toBeGreaterThan(highWacc);
    const lowGrowth = matrix.cells[2]![0]!.valuePerShare!;
    const highGrowth = matrix.cells[2]![4]!.valuePerShare!;
    expect(highGrowth).toBeGreaterThan(lowGrowth);
  });
});
