import type { AffineCorrection, ValidationReport } from "../metrics/types";
import { median } from "../metrics/math";
import { applyAffine, fitAffineIfBetter, type Pair } from "./affine";

/** Held-out validation targets as fractions of the viewport. Two sit on the left edge. */
export const VALIDATION_POINTS: ReadonlyArray<{ fx: number; fy: number }> = [
  { fx: 0.08, fy: 0.28 },
  { fx: 0.92, fy: 0.62 },
  { fx: 0.35, fy: 0.52 },
  { fx: 0.62, fy: 0.22 },
  { fx: 0.08, fy: 0.76 },
  { fx: 0.5, fy: 0.85 },
  { fx: 0.78, fy: 0.4 },
];

export interface ValidationInput {
  target: { x: number; y: number };
  /** Raw (uncorrected, unsmoothed) predictions collected while the user looked at the target, page px. */
  frames: Array<{ x: number; y: number }>;
}

const SIDE_DEADBAND = 0.1;
const LEFT_EDGE = 0.2;

function cellOf(p: { x: number; y: number }, w: number, h: number) {
  const c = Math.min(2, Math.max(0, Math.floor((3 * p.x) / w)));
  const r = Math.min(2, Math.max(0, Math.floor((3 * p.y) / h)));
  return r * 3 + c;
}

/**
 * Scores validation, fits the affine correction from per-point medians, and applies it
 * only if leave-one-out error improves. Accuracy is computed per frame on the final
 * (corrected if applied) predictions; points in the central 10% band are skipped for
 * left/right accuracy because their side is ambiguous.
 */
export function computeValidationReport(
  inputs: readonly ValidationInput[],
  viewport: { width: number; height: number },
): { report: ValidationReport; correction: AffineCorrection | null } {
  const { width: W, height: H } = viewport;
  const medians = inputs.map((p) => {
    const mx = median(p.frames.map((f) => f.x));
    const my = median(p.frames.map((f) => f.y));
    return mx === null || my === null ? null : { x: mx, y: my };
  });
  const pairs: Pair[] = inputs.flatMap((p, i) => (medians[i] ? [{ p: medians[i]!, t: p.target }] : []));
  const decision = fitAffineIfBetter(pairs, viewport);
  const correction = decision.correction;
  const fix = (q: { x: number; y: number }) => (correction ? applyAffine(correction, q) : q);

  let sideN = 0;
  let sideOk = 0;
  let cellN = 0;
  let cellOk = 0;
  const errors: number[] = [];
  const biases: number[] = [];
  const leftBiases: number[] = [];
  const points = inputs.map((p, i) => {
    const raw = medians[i] ?? null;
    const corrected = raw ? fix(raw) : null;
    const tSide = p.target.x / W - 0.5;
    for (const f of p.frames) {
      const q = fix(f);
      if (Math.abs(tSide) >= SIDE_DEADBAND / 2) {
        sideN++;
        if (q.x / W - 0.5 < 0 === tSide < 0) sideOk++;
      }
      cellN++;
      if (cellOf(q, W, H) === cellOf(p.target, W, H)) cellOk++;
    }
    if (corrected) {
      errors.push(Math.hypot(corrected.x - p.target.x, corrected.y - p.target.y));
      biases.push(corrected.x - p.target.x);
      if (p.target.x < LEFT_EDGE * W) leftBiases.push(corrected.x - p.target.x);
    }
    return { target: p.target, raw, corrected: correction ? corrected : null };
  });
  const avg = (v: number[]) => (v.length ? v.reduce((s, x) => s + x, 0) / v.length : null);
  return {
    report: {
      points,
      leftRightAccuracy: sideN ? sideOk / sideN : null,
      cellAccuracy: cellN ? cellOk / cellN : null,
      meanErrorPx: avg(errors),
      horizontalBiasPx: avg(biases),
      leftEdgeBiasPx: avg(leftBiases),
      correctionApplied: correction !== null,
      looErrorRawPx: decision.looErrorRawPx,
      looErrorCorrectedPx: decision.looErrorCorrectedPx,
    },
    correction,
  };
}
