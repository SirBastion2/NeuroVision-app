import { signedErrorPct } from "@neurovision/domain";
import type { BisectionLayout, BisectionMetrics, TapEvent } from "./types";
import { mean, normX, sd } from "./math";

/** Signed deviation of a tap from a line's midpoint, % of line length (positive = rightward). */
export function signedDeviationPct(line: { x1: number; x2: number }, tapX: number): number {
  return signedErrorPct({ id: "line", x1: line.x1, x2: line.x2, y: 0 }, tapX);
}

export function computeBisectionMetrics(layout: BisectionLayout, taps: readonly TapEvent[], durationMs: number): BisectionMetrics {
  const firstByLine = new Map<string, TapEvent>();
  for (const t of [...taps].sort((a, b) => a.t - b.t)) {
    if (t.kind === "cancel" && t.targetId && !firstByLine.has(t.targetId)) firstByLine.set(t.targetId, t);
  }
  const deviations = layout.lines.map((l) => {
    const tap = firstByLine.get(l.id);
    return tap ? signedDeviationPct(l, tap.x) : null;
  });
  const valid = deviations.filter((d): d is number => d !== null);
  const bySide = (left: boolean) =>
    mean(
      layout.lines
        .map((l, i) => ({ c: normX((l.x1 + l.x2) / 2, layout.area.width), d: deviations[i] }))
        .filter((r) => r.d !== null && (left ? r.c < 0 : r.c >= 0))
        .map((r) => r.d as number),
    );
  return {
    kind: "line-bisection",
    lines: layout.lines.length,
    answered: valid.length,
    deviations,
    meanDeviation: mean(valid),
    sdDeviation: sd(valid),
    meanDeviationLeftLines: bySide(true),
    meanDeviationRightLines: bySide(false),
    durationMs,
  };
}
