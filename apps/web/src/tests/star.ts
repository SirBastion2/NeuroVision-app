import type { Area, Difficulty, StarItem, StarItemKind, StarLayout, TapEvent } from "../metrics/types";
import { rng } from "../metrics/math";

export const STAR_TARGETS = 36;
const COLS = 12;
const ROWS = 8;
/** Space kept clear at the bottom for the Done button. */
export const STAR_BOTTOM_BAND = 96;
const TOP_MARGIN = 28;
const SIDE_MARGIN = 28;
const LETTERS = "AEHKMNRTVWXZ";

/**
 * Star cancellation layout on a jittered 12×8 grid. Targets (small stars) are spread
 * evenly across columns (3 per column) so every horizontal region has the same number
 * of opportunities; the remaining cells hold distractors in proportion to density.
 */
export function generateStarLayout(area: Area, difficulty: Difficulty, seed: number): StarLayout {
  const rand = rng(seed);
  const usableW = area.width - 2 * SIDE_MARGIN;
  const usableH = area.height - TOP_MARGIN - STAR_BOTTOM_BAND;
  const cw = usableW / COLS;
  const ch = usableH / ROWS;
  const targetsPerCol = STAR_TARGETS / COLS;
  const smallR = Math.max(6, Math.min(cw, ch) * 0.17 * difficulty.targetScale);
  const bigR = Math.max(smallR * 1.9, Math.min(cw, ch) * 0.3);
  const jitter = (span: number) => (rand() - 0.5) * span * 0.42;

  const items: StarItem[] = [];
  const distractorShare = Math.min(1, 0.62 * difficulty.distractorDensity);
  const kinds: StarItemKind[] = ["big-star", "letter", "triangle"];

  for (let c = 0; c < COLS; c++) {
    const rows = Array.from({ length: ROWS }, (_, r) => r);
    for (let i = rows.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [rows[i], rows[j]] = [rows[j]!, rows[i]!];
    }
    rows.forEach((r, k) => {
      const x = SIDE_MARGIN + cw * (c + 0.5) + jitter(cw);
      const y = TOP_MARGIN + ch * (r + 0.5) + jitter(ch);
      if (k < targetsPerCol) {
        items.push({ id: `t-${c}-${r}`, kind: "target", x, y, size: smallR, rotation: rand() * 72 });
      } else if (rand() < distractorShare) {
        const kind = kinds[Math.floor(rand() * kinds.length)]!;
        items.push({
          id: `d-${c}-${r}`,
          kind,
          x,
          y,
          size: kind === "big-star" ? bigR : smallR * 1.35,
          rotation: kind === "letter" ? 0 : rand() * 360,
          ...(kind === "letter" ? { letter: LETTERS[Math.floor(rand() * LETTERS.length)] } : {}),
        });
      }
    });
  }
  return {
    kind: "star-cancellation",
    seed,
    area,
    items,
    hitRadius: Math.max(14, 0.42 * Math.min(cw, ch)),
    spacing: { x: cw, y: ch },
  };
}

/** Resolves a tap to an item: nearest item within the hit radius. */
export function resolveStarTap(layout: StarLayout, x: number, y: number, t: number, previous: readonly TapEvent[]): TapEvent {
  let best: StarItem | null = null;
  let bestD = Infinity;
  for (const item of layout.items) {
    const d = Math.hypot(item.x - x, item.y - y);
    const reach = item.kind === "big-star" ? Math.max(layout.hitRadius, item.size) : layout.hitRadius;
    if (d <= reach && d < bestD) {
      best = item;
      bestD = d;
    }
  }
  if (!best || best.kind !== "target") return { t, x, y, targetId: best?.id ?? null, kind: "commission" };
  const already = previous.some((p) => p.targetId === best!.id && p.kind === "cancel");
  return { t, x, y, targetId: best.id, kind: already ? "revisit" : "cancel" };
}
