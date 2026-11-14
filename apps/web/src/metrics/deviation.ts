import {
  BISECTION_SIGNED_ERROR_PCT,
  GAZE_LEFT_FRACTION,
  STAR_CANCELLATION_COC,
  STAR_CANCELLATION_HIT_ASYMMETRY,
  deviationUnit,
} from "@neurovision/domain";
import type { BisectionMetrics, DeviationScore, GazeMetrics, StarMetrics } from "./types";

/**
 * Transparent left/right deviation from the healthy range, in [0, 1].
 * Each component is mapped with published mean/SD or cutoff from the norms
 * module. Uncalibrated parts (including webcam gaze laterality) are dropped
 * and the remaining weights renormalised. This is not a diagnosis.
 */
export const DEVIATION_WEIGHTS = {
  centerOfCancellation: 0.35,
  hitAsymmetry: 0.3,
  gazeLeftDeficit: 0.2,
  bisectionShift: 0.15,
} as const;

export function computeDeviation(test: StarMetrics | BisectionMetrics, gaze: GazeMetrics | null): DeviationScore {
  const parts: Array<{ name: keyof typeof DEVIATION_WEIGHTS; value: number }> = [];
  if (test.kind === "star-cancellation") {
    const coc = deviationUnit(test.centerOfCancellation, STAR_CANCELLATION_COC);
    if (coc != null) parts.push({ name: "centerOfCancellation", value: coc });
    const hits = deviationUnit(test.hitRateRight - test.hitRateLeft, STAR_CANCELLATION_HIT_ASYMMETRY);
    if (hits != null) parts.push({ name: "hitAsymmetry", value: hits });
  } else if (test.meanDeviation !== null) {
    const shift = deviationUnit(test.meanDeviation, BISECTION_SIGNED_ERROR_PCT);
    if (shift != null) parts.push({ name: "bisectionShift", value: shift });
  }
  if (gaze && gaze.leftGazeFraction !== null && gaze.trackedFraction >= 0.3) {
    const gazeUnit = deviationUnit(gaze.leftGazeFraction, GAZE_LEFT_FRACTION);
    if (gazeUnit != null) parts.push({ name: "gazeLeftDeficit", value: gazeUnit });
  }
  const totalWeight = parts.reduce((s, p) => s + DEVIATION_WEIGHTS[p.name], 0);
  const components = parts.map((p) => ({ name: p.name, value: p.value, weight: totalWeight ? DEVIATION_WEIGHTS[p.name] / totalWeight : 0 }));
  return { score: components.reduce((s, c) => s + c.value * c.weight, 0), components };
}
