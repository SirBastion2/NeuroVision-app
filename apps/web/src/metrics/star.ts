import { STAR_CANCELLATION_COC, compareToNorm } from "@neurovision/domain";
import type { StarLayout, StarMetrics, TapEvent } from "./types";
import { binOf, mean, normX } from "./math";

export const COC_FLAG_THRESHOLD = STAR_CANCELLATION_COC.cutoff;
export const BINS = 6;

interface Seg {
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

function orient(px: number, py: number, qx: number, qy: number, rx: number, ry: number): number {
  return Math.sign((qx - px) * (ry - py) - (qy - py) * (rx - px));
}

/** Proper intersection of two segments (shared endpoints and collinear touches don't count). */
export function segmentsCross(s: Seg, t: Seg): boolean {
  const o1 = orient(s.ax, s.ay, s.bx, s.by, t.ax, t.ay);
  const o2 = orient(s.ax, s.ay, s.bx, s.by, t.bx, t.by);
  const o3 = orient(t.ax, t.ay, t.bx, t.by, s.ax, s.ay);
  const o4 = orient(t.ax, t.ay, t.bx, t.by, s.bx, s.by);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

/** Number of times the search path (in tap order) crosses itself. */
export function countPathCrossings(points: ReadonlyArray<{ x: number; y: number }>): number {
  const segs: Seg[] = [];
  for (let i = 1; i < points.length; i++) {
    segs.push({ ax: points[i - 1]!.x, ay: points[i - 1]!.y, bx: points[i]!.x, by: points[i]!.y });
  }
  let n = 0;
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 2; j < segs.length; j++) if (segmentsCross(segs[i]!, segs[j]!)) n++;
  }
  return n;
}

export function computeStarMetrics(layout: StarLayout, taps: readonly TapEvent[], durationMs: number, timedOut: boolean): StarMetrics {
  const W = layout.area.width;
  const targets = layout.items.filter((i) => i.kind === "target");
  const found = new Set(taps.filter((t) => t.kind === "cancel" && t.targetId).map((t) => t.targetId!));
  const foundTargets = targets.filter((t) => found.has(t.id));

  const half = (side: "left" | "right") => {
    const pool = targets.filter((t) => (side === "left" ? normX(t.x, W) < 0 : normX(t.x, W) >= 0));
    return pool.length ? pool.filter((t) => found.has(t.id)).length / pool.length : 0;
  };

  const binTotals = Array<number>(BINS).fill(0);
  const binHits = Array<number>(BINS).fill(0);
  for (const t of targets) {
    const b = binOf(normX(t.x, W), BINS);
    binTotals[b]!++;
    if (found.has(t.id)) binHits[b]!++;
  }

  const meanAll = mean(targets.map((t) => normX(t.x, W)));
  const meanFound = mean(foundTargets.map((t) => normX(t.x, W)));
  const coc = meanAll === null || meanFound === null ? null : meanFound - meanAll;

  const ordered = [...taps].sort((a, b) => a.t - b.t);
  const cancels = ordered.filter((t) => t.kind === "cancel");
  const first = ordered[0];

  return {
    kind: "star-cancellation",
    targets: targets.length,
    hits: foundTargets.length,
    hitRate: targets.length ? foundTargets.length / targets.length : 0,
    hitRateLeft: half("left"),
    hitRateRight: half("right"),
    hitRateByBin: binTotals.map((n, i) => (n ? binHits[i]! / n : null)),
    centerOfCancellation: coc,
    cocFlag: compareToNorm(coc, STAR_CANCELLATION_COC).beyondCutoff,
    firstTap: first ? { x: normX(first.x, W), side: normX(first.x, W) < 0 ? "left" : "right" } : null,
    pathCrossings: countPathCrossings(cancels),
    revisits: taps.filter((t) => t.kind === "revisit").length,
    commissions: taps.filter((t) => t.kind === "commission").length,
    durationMs,
    timedOut,
  };
}
