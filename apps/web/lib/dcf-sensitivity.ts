/**
 * WACC x terminal-growth sensitivity grid. Pure -- reuses dcf-model.ts's runDcf for every cell so
 * there is exactly one place valuation math lives; this module only builds the axes and grid.
 */
import { runDcf, type DcfBaseInputs } from '@/lib/dcf-model';
import type { DcfAssumptionsInput } from '@/lib/dcf-validation';

export interface SensitivityCell {
  wacc: number;
  terminalGrowth: number;
  valuePerShare: number | null;
  /** true when wacc <= terminalGrowth -- an inherently invalid combination, shown as "--". */
  invalid: boolean;
  /** true for the cell matching the current (base-case) wacc/terminalGrowth assumptions. */
  isBaseCase: boolean;
}

export interface SensitivityMatrix {
  waccAxis: number[];
  terminalGrowthAxis: number[];
  cells: SensitivityCell[][];
}

const WACC_STEP = 0.01;
const TERMINAL_GROWTH_STEP = 0.005;
const AXIS_SIZE = 5;
const AXIS_OFFSETS = [-2, -1, 0, 1, 2];

/** Builds a 5x5 axis centered on the current base-case WACC/terminal-growth so the base
 * assumption always lands in the middle cell (row/col index 2). */
export function buildDefaultSensitivityAxes(
  centerWacc: number,
  centerTerminalGrowth: number,
): { waccAxis: number[]; terminalGrowthAxis: number[] } {
  return {
    waccAxis: AXIS_OFFSETS.map((offset) => centerWacc + offset * WACC_STEP),
    terminalGrowthAxis: AXIS_OFFSETS.map(
      (offset) => centerTerminalGrowth + offset * TERMINAL_GROWTH_STEP,
    ),
  };
}

export function buildSensitivityMatrix(
  base: DcfBaseInputs,
  assumptions: DcfAssumptionsInput,
  waccAxis: number[],
  terminalGrowthAxis: number[],
): SensitivityMatrix {
  const cells = waccAxis.map((wacc) =>
    terminalGrowthAxis.map((terminalGrowth): SensitivityCell => {
      const invalid = wacc <= terminalGrowth;
      const run = invalid ? null : runDcf(base, { ...assumptions, wacc, terminalGrowth });
      return {
        wacc,
        terminalGrowth,
        valuePerShare: run?.result?.valuePerShare ?? null,
        invalid,
        isBaseCase: wacc === assumptions.wacc && terminalGrowth === assumptions.terminalGrowth,
      };
    }),
  );
  return { waccAxis, terminalGrowthAxis, cells };
}

export { AXIS_SIZE as SENSITIVITY_AXIS_SIZE };
