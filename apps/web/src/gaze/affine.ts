import type { AffineCorrection } from "../metrics/types";

/**
 * Regularized per-axis affine correction (scale + shift), pulled toward identity and
 * clamped near it. Used after validation (to remove e.g. a rightward bias that would
 * fake neglect in healthy people) and for click-based refinement. Pure.
 */

export interface Pair {
  /** Predicted gaze. */
  p: { x: number; y: number };
  /** True location. */
  t: { x: number; y: number };
}

export const IDENTITY: AffineCorrection = { ax: 1, bx: 0, ay: 1, by: 0 };
const SCALE_LIMIT = 0.15;
const SHIFT_LIMIT = 0.1;
const LAMBDA_SCALE = 0.5;
const LAMBDA_SHIFT = 0.05;

function fitAxis(p: number[], t: number[]): { a: number; b: number } {
  const n = p.length;
  let sp = 0;
  let spp = 0;
  let st = 0;
  let spt = 0;
  for (let i = 0; i < n; i++) {
    sp += p[i]!;
    spp += p[i]! * p[i]!;
    st += t[i]!;
    spt += p[i]! * t[i]!;
  }
  // Minimize Σ(a p + b − t)² + λa (a − 1)² + λb b²  (in units normalized by screen size).
  const a11 = spp + LAMBDA_SCALE;
  const a12 = sp;
  const a22 = n + LAMBDA_SHIFT;
  const r1 = spt + LAMBDA_SCALE;
  const r2 = st;
  const det = a11 * a22 - a12 * a12;
  if (Math.abs(det) < 1e-12) return { a: 1, b: 0 };
  const a = (r1 * a22 - a12 * r2) / det;
  const b = (a11 * r2 - a12 * r1) / det;
  return {
    a: Math.max(1 - SCALE_LIMIT, Math.min(1 + SCALE_LIMIT, a)),
    b: Math.max(-SHIFT_LIMIT, Math.min(SHIFT_LIMIT, b)),
  };
}

export function fitAffine(pairs: readonly Pair[], size: { width: number; height: number }): AffineCorrection {
  const W = size.width || 1;
  const H = size.height || 1;
  const x = fitAxis(
    pairs.map((q) => q.p.x / W),
    pairs.map((q) => q.t.x / W),
  );
  const y = fitAxis(
    pairs.map((q) => q.p.y / H),
    pairs.map((q) => q.t.y / H),
  );
  return { ax: x.a, bx: x.b * W, ay: y.a, by: y.b * H };
}

export function applyAffine(c: AffineCorrection, p: { x: number; y: number }): { x: number; y: number } {
  return { x: c.ax * p.x + c.bx, y: c.ay * p.y + c.by };
}

/** Composes two corrections: second ∘ first. */
export function composeAffine(first: AffineCorrection, second: AffineCorrection): AffineCorrection {
  return { ax: second.ax * first.ax, bx: second.ax * first.bx + second.bx, ay: second.ay * first.ay, by: second.ay * first.by + second.by };
}

/** Re-expresses a correction fitted in page coordinates for screen coordinates (page = screen − offset). */
export function pageToScreenAffine(c: AffineCorrection, offset: { x: number; y: number }): AffineCorrection {
  return { ax: c.ax, bx: c.bx + offset.x * (1 - c.ax), ay: c.ay, by: c.by + offset.y * (1 - c.ay) };
}

export interface AffineDecision {
  correction: AffineCorrection | null;
  looErrorRawPx: number | null;
  looErrorCorrectedPx: number | null;
}

/**
 * Fits the correction and keeps it only if leave-one-out error improves on the raw
 * error. Needs at least 4 pairs.
 */
export function fitAffineIfBetter(pairs: readonly Pair[], size: { width: number; height: number }): AffineDecision {
  if (pairs.length < 4) return { correction: null, looErrorRawPx: null, looErrorCorrectedPx: null };
  let raw = 0;
  let corrected = 0;
  pairs.forEach((q, i) => {
    raw += Math.hypot(q.p.x - q.t.x, q.p.y - q.t.y);
    const c = fitAffine(
      pairs.filter((_, j) => j !== i),
      size,
    );
    const pp = applyAffine(c, q.p);
    corrected += Math.hypot(pp.x - q.t.x, pp.y - q.t.y);
  });
  const looErrorRawPx = raw / pairs.length;
  const looErrorCorrectedPx = corrected / pairs.length;
  return {
    correction: looErrorCorrectedPx < looErrorRawPx ? fitAffine(pairs, size) : null,
    looErrorRawPx,
    looErrorCorrectedPx,
  };
}
