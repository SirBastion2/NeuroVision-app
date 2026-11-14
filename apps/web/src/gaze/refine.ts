import type { ClickRefinement, GazeSample, SessionResult } from "../metrics/types";
import { clamp, median } from "../metrics/math";
import { applyAffine, fitAffineIfBetter, type Pair } from "./affine";

export const REFINE_WINDOW_MS = 450;

/**
 * Each correct target click is a labelled calibration point: the participant was almost
 * certainly looking at the star they crossed out. Pair the median gaze over the 450 ms
 * before the click with the target's position. Star test only; bisection taps are the
 * participant's own judgement, not a known location.
 */
export function clickRefinementPairs(session: Pick<SessionResult, "layout" | "taps">, gaze: readonly GazeSample[]): Pair[] {
  if (session.layout.kind !== "star-cancellation") return [];
  const items = new Map(session.layout.items.map((i) => [i.id, i]));
  const tracked = gaze.filter((g) => g.x !== null && g.y !== null && !g.blink);
  const pairs: Pair[] = [];
  for (const tap of session.taps) {
    if (tap.kind !== "cancel" || !tap.targetId) continue;
    const target = items.get(tap.targetId);
    if (!target) continue;
    const win = tracked.filter((g) => g.t <= tap.t && g.t >= tap.t - REFINE_WINDOW_MS);
    if (win.length < 3) continue;
    pairs.push({ p: { x: median(win.map((g) => g.x!))!, y: median(win.map((g) => g.y!))! }, t: { x: target.x, y: target.y } });
  }
  return pairs;
}

/** Fits a refinement for a recorded session; returns refined gaze when it helps. */
export function refineSessionGaze(session: Pick<SessionResult, "layout" | "taps">, gaze: readonly GazeSample[]): { refinement: ClickRefinement; refined: GazeSample[] | null } {
  const pairs = clickRefinementPairs(session, gaze);
  const area = session.layout.area;
  const d = fitAffineIfBetter(pairs, area);
  const refinement: ClickRefinement = {
    pairs: pairs.length,
    correction: d.correction,
    looErrorRawPx: d.looErrorRawPx,
    looErrorCorrectedPx: d.looErrorCorrectedPx,
    applied: false,
  };
  if (!d.correction) return { refinement, refined: null };
  const c = d.correction;
  const refined = gaze.map((g) => {
    if (g.x === null || g.y === null) return g;
    const q = applyAffine(c, { x: g.x, y: g.y });
    return { ...g, x: clamp(q.x, 0, area.width), y: clamp(q.y, 0, area.height) };
  });
  return { refinement, refined };
}
