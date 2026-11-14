import type { BisectionMetrics, DeviationScore, GazeMetrics, StarMetrics } from "./types";
import { clamp } from "./math";

/**
 * Transparent left/right deviation from the healthy range, in [0, 1].
 * Each component is mapped to [0, 1] with a fixed scale, then combined with
 * fixed weights. Missing parts (no gaze, other test) are dropped and the
 * remaining weights renormalised. This is not a diagnosis.
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
    // CoC of 0.5 (found targets centred halfway to the right edge) maps to 1.
    if (test.centerOfCancellation !== null) parts.push({ name: "centerOfCancellation", value: clamp(test.centerOfCancellation / 0.5, 0, 1) });
    parts.push({ name: "hitAsymmetry", value: clamp(test.hitRateRight - test.hitRateLeft, 0, 1) });
  } else if (test.meanDeviation !== null) {
    // A 20% rightward mean bisection error maps to 1.
    parts.push({ name: "bisectionShift", value: clamp(test.meanDeviation / 20, 0, 1) });
  }
  if (gaze && gaze.leftGazeFraction !== null && gaze.trackedFraction >= 0.3) {
    // 50% gaze on the left = 0; 0% on the left = 1.
    parts.push({ name: "gazeLeftDeficit", value: clamp((0.5 - gaze.leftGazeFraction) / 0.5, 0, 1) });
  }
  const totalWeight = parts.reduce((s, p) => s + DEVIATION_WEIGHTS[p.name], 0);
  const components = parts.map((p) => ({ name: p.name, value: p.value, weight: totalWeight ? DEVIATION_WEIGHTS[p.name] / totalWeight : 0 }));
  return { score: components.reduce((s, c) => s + c.value * c.weight, 0), components };
}
