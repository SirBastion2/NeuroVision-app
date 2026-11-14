import type { GazeQuality, SessionMetrics, SessionResult } from "./types";
import { computeBisectionMetrics } from "./bisection";
import { computeGazeMetrics } from "./gaze";
import { computeSeverity } from "./severity";
import { computeStarMetrics } from "./star";

export * from "./types";
export * from "./math";
export * from "./star";
export * from "./bisection";
export * from "./gaze";
export * from "./severity";

/** Computes every metric for a session from its layout, taps and gaze. Pure. */
export function computeSessionMetrics(
  s: Pick<SessionResult, "layout" | "taps" | "gaze"> & { durationMs: number; timedOut: boolean; quality: Pick<GazeQuality, "calibrationHeadYawDeg" | "validation"> },
): SessionMetrics {
  const test =
    s.layout.kind === "star-cancellation"
      ? computeStarMetrics(s.layout, s.taps, s.durationMs, s.timedOut)
      : computeBisectionMetrics(s.layout, s.taps, s.durationMs);
  const gaze = s.gaze.length
    ? computeGazeMetrics(s.layout, s.gaze, s.taps, {
        calibrationHeadYawDeg: s.quality.calibrationHeadYawDeg,
        gazeErrorPx: s.quality.validation?.meanErrorPx ?? null,
      })
    : null;
  return { test, gaze, severity: computeSeverity(test, gaze) };
}
