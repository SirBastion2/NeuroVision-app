import type { GazeMetrics, GazeSample, TapEvent, TestLayout } from "./types";
import { binOf, clamp, mean, normX, quantile } from "./math";
import { BINS } from "./star";

/** Ignore gaps between samples longer than this when integrating dwell time. */
const MAX_GAP_MS = 120;
/** Normalized half-width of the central band used for "first look direction". */
const CENTER_BAND = 0.15;
export const LOOKED_AT_MIN_MS = 250;

export const isTracked = (s: GazeSample) => s.x !== null && s.y !== null && !s.blink;

/** Duration each sample stands for: time to the next sample, capped so gaps aren't counted as dwell. */
function sampleWeights(samples: readonly GazeSample[]): number[] {
  return samples.map((s, i) => {
    const next = samples[i + 1];
    if (!next) return 0;
    return clamp(next.t - s.t, 0, MAX_GAP_MS);
  });
}

/** Positions of everything the participant was supposed to scan (targets or line centres). */
export function layoutReferenceXs(layout: TestLayout): number[] {
  if (layout.kind === "star-cancellation") return layout.items.filter((i) => i.kind === "target").map((i) => i.x);
  return layout.lines.map((l) => (l.x1 + l.x2) / 2);
}

/**
 * Adaptive "looked at" radius: at least half the grid spacing, and never smaller than
 * the validated gaze error. Vertical radius is wider because vertical gaze is weak.
 */
export function lookedAtRadius(layout: TestLayout, gazeErrorPx: number | null): { rx: number; ry: number } {
  const spacing = layout.kind === "star-cancellation" ? layout.spacing : { x: 60, y: 40 };
  const rx = Math.max(0.55 * spacing.x, gazeErrorPx ?? 0, 35);
  return { rx, ry: Math.max(rx * 1.6, 0.75 * spacing.y) };
}

export function computeGazeMetrics(
  layout: TestLayout,
  gaze: readonly GazeSample[],
  taps: readonly TapEvent[],
  opts: { calibrationHeadYawDeg?: number | null; gazeErrorPx?: number | null } = {},
): GazeMetrics {
  const W = layout.area.width;
  const samples = [...gaze].sort((a, b) => a.t - b.t);
  const weights = sampleWeights(samples);
  const trackedIdx = samples.map((s, i) => (isTracked(s) ? i : -1)).filter((i) => i >= 0);

  let total = 0;
  let left = 0;
  const gazeMsByBin = Array<number>(BINS).fill(0);
  for (const i of trackedIdx) {
    const s = samples[i]!;
    const w = weights[i]!;
    const nx = normX(s.x!, W);
    total += w;
    if (nx < 0) left += w;
    gazeMsByBin[binOf(nx, BINS)]! += w;
  }

  const xs = trackedIdx.map((i) => normX(samples[i]!.x!, W));
  const refMean = mean(layoutReferenceXs(layout).map((x) => normX(x, W)));
  const gazeMean = mean(xs);

  let firstLook: "left" | "right" | null = null;
  for (const nx of xs) {
    if (Math.abs(nx) > CENTER_BAND) {
      firstLook = nx < 0 ? "left" : "right";
      break;
    }
  }

  const yaws = samples.filter((s) => isTracked(s) && s.headYawDeg !== null).map((s) => s.headYawDeg!);
  const meanYaw = mean(yaws);
  const baseline = opts.calibrationHeadYawDeg ?? 0;

  // Missed targets the gaze dwelt on (cumulative, within an elliptical radius).
  const missedLookedAt: string[] = [];
  if (layout.kind === "star-cancellation") {
    const found = new Set(taps.filter((t) => t.kind === "cancel" && t.targetId).map((t) => t.targetId));
    const { rx, ry } = lookedAtRadius(layout, opts.gazeErrorPx ?? null);
    for (const target of layout.items) {
      if (target.kind !== "target" || found.has(target.id)) continue;
      let dwell = 0;
      for (const i of trackedIdx) {
        const s = samples[i]!;
        const dx = (s.x! - target.x) / rx;
        const dy = (s.y! - target.y) / ry;
        if (dx * dx + dy * dy <= 1) dwell += weights[i]!;
      }
      if (dwell >= LOOKED_AT_MIN_MS) missedLookedAt.push(target.id);
    }
  }

  return {
    trackedFraction: samples.length ? trackedIdx.length / samples.length : 0,
    leftGazeFraction: total > 0 ? left / total : null,
    gazeCenterOfCancellation: gazeMean === null || refMean === null ? null : gazeMean - refMean,
    firstLookDirection: firstLook,
    leftmostReach: quantile(xs, 0.05),
    meanHeadYawDeg: meanYaw === null ? null : meanYaw - baseline,
    missedLookedAt,
    gazeMsByBin,
  };
}
