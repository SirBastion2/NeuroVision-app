import type { Area, BisectionLayout, BisectionLine, TapEvent } from "../metrics/types";
import { rng } from "../metrics/math";

export const BISECTION_LINES = 18;
export const BISECTION_BOTTOM_BAND = 96;

/**
 * 18 horizontal lines, one per row, lengths 18–45% of the width. Line centres are
 * balanced: six each in the left, middle and right thirds, in shuffled order.
 */
export function generateBisectionLayout(area: Area, seed: number): BisectionLayout {
  const rand = rng(seed);
  const top = 36;
  const rowH = (area.height - top - BISECTION_BOTTOM_BAND) / BISECTION_LINES;
  const thirds = Array.from({ length: BISECTION_LINES }, (_, i) => i % 3);
  for (let i = thirds.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [thirds[i], thirds[j]] = [thirds[j]!, thirds[i]!];
  }
  const lines: BisectionLine[] = thirds.map((third, i) => {
    const len = area.width * (0.18 + 0.27 * rand());
    const centreLo = Math.max(len / 2 + 24, (area.width * third) / 3 + len * 0.15);
    const centreHi = Math.min(area.width - len / 2 - 24, (area.width * (third + 1)) / 3 - len * 0.15);
    const cx = centreLo <= centreHi ? centreLo + rand() * (centreHi - centreLo) : (centreLo + centreHi) / 2;
    return { id: `line-${i}`, x1: cx - len / 2, x2: cx + len / 2, y: top + rowH * (i + 0.5) };
  });
  return { kind: "line-bisection", seed, area, lines, tolerance: Math.max(10, Math.min(28, rowH * 0.45)) };
}

/** First tap on a line = cancel; another tap on an answered line = revisit; elsewhere = commission. */
export function resolveBisectionTap(layout: BisectionLayout, x: number, y: number, t: number, previous: readonly TapEvent[]): TapEvent {
  let best: BisectionLine | null = null;
  for (const l of layout.lines) {
    const dy = Math.abs(l.y - y);
    if (dy <= layout.tolerance && x >= l.x1 - 12 && x <= l.x2 + 12 && (!best || dy < Math.abs(best.y - y))) best = l;
  }
  if (!best) return { t, x, y, targetId: null, kind: "commission" };
  const answered = previous.some((p) => p.targetId === best!.id && p.kind === "cancel");
  return { t, x, y, targetId: best.id, kind: answered ? "revisit" : "cancel" };
}
