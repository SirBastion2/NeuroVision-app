/**
 * Starry Night: a dynamic detection test after Deouell, Sacher & Soroker (2005).
 *
 * A dark field is full of small green dots that keep appearing and vanishing.
 * Now and then a slightly larger red dot flashes somewhere on the field, and
 * the person presses one button (Space, or a tap anywhere) as soon as they see
 * it. Viewing is free: there is no fixation point, so a person who habitually
 * looks to the right is not helped by the layout.
 *
 * Targets are split as evenly as possible left/right (with an odd count, the
 * side that gets the extra one is random) and placed in random cells of an
 * 8 × 4 grid (4 columns per side), in a shuffled order with no more than three
 * in a row on one side. Every run gets new positions and a new order. The
 * gap before each target is jittered so the rhythm can't be predicted.
 *
 * Neglect predicts more misses and slower hits on the left, often getting worse
 * the further left the target sits. Pure functions only.
 */
import { seProportionDiff, type TestObservation } from "./evidence.js";
import { STARRY_LATERALITY, compareToNorm, type HealthyRangeReading } from "./norms.js";

export type StarrySide = "left" | "right";

export const STARRY_DEFAULTS = {
  /** The red target stays on screen this long. */
  targetMs: 1000,
  /** A press up to this long after onset counts as a hit (allows slow responders after the dot has gone). */
  responseWindowMs: 1500,
  /** Presses faster than this after onset are anticipations, counted as false alarms. */
  minRtMs: 150,
  /** Quiet gap (only distractors) from the end of one response window to the next onset: uniform in this range. */
  gapMinMs: 800,
  gapMaxMs: 2500,
  /** Lead-in before the first target, so the eyes settle into the moving field. */
  leadInMs: 2000,
  fullTargets: 15,
  demoTargets: 15,
  columns: 8,
  rows: 4,
  /** Field size in board units (16:10). */
  width: 1000,
  height: 625,
  /** Distractors alive at once, how long each lives, and dot sizes in board units. */
  distractorCount: 60,
  distractorLifeMinMs: 250,
  distractorLifeMaxMs: 750,
  distractorRadius: 4.5,
  targetRadius: 7.5,
  /** Margin kept free at the edges of the field. */
  margin: 40,
} as const;

export interface StarryTrial {
  id: string;
  side: StarrySide;
  /** Grid column 0..columns-1, left to right. */
  col: number;
  /** Grid row 0..rows-1, top to bottom. */
  row: number;
  /** Target centre in board units. */
  x: number;
  y: number;
  /** Quiet gap before this target's onset. */
  gapMs: number;
}

export interface StarryResponse {
  trialId: string;
  /** Reaction time of the first valid press in the window, or null for a miss. */
  rtMs: number | null;
}

/** Every press, kept raw so a run can be re-scored. `trialId` is set when the press fell in a target's window. */
export interface StarryPress {
  /** ms since the run started (excluding pauses). */
  atMs: number;
  trialId: string | null;
  /** ms after that target's onset, when trialId is set. */
  sinceOnsetMs: number | null;
}

export interface StarrySideSummary {
  hits: number;
  n: number;
  medianRtMs: number | null;
}

export interface StarryScore {
  left: StarrySideSummary;
  right: StarrySideSummary;
  /** Hit rate per grid column, left to right (null if a column had no targets). */
  columns: Array<{ col: number; hits: number; n: number; rate: number | null; medianRtMs: number | null }>;
  falseAlarms: number;
  /** Median RT left minus right (positive = left slower). Null when either side has no hits. */
  rtGapMs: number | null;
  observation: TestObservation;
  healthyRange: HealthyRangeReading;
}

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(r: () => number, items: T[]): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const longestRun = (sides: StarrySide[]) => {
  let best = 0;
  let run = 0;
  sides.forEach((s, i) => {
    run = i > 0 && sides[i - 1] === s ? run + 1 : 1;
    best = Math.max(best, run);
  });
  return best;
};

/** Cells for one side, every cell once before any repeats, in random order. */
function cellsFor(r: () => number, side: StarrySide, count: number): Array<{ col: number; row: number }> {
  const { columns, rows } = STARRY_DEFAULTS;
  const half = columns / 2;
  const all: Array<{ col: number; row: number }> = [];
  for (let c = 0; c < half; c++) for (let row = 0; row < rows; row++) all.push({ col: side === "left" ? c : half + c, row });
  const out: Array<{ col: number; row: number }> = [];
  while (out.length < count) out.push(...shuffle(r, all));
  return out.slice(0, count);
}

/** Shuffled targets split as evenly as possible between the sides (minimum 2). */
export function generateStarryTrials(n: number, seed = 1): StarryTrial[] {
  const r = rng(seed);
  const D = STARRY_DEFAULTS;
  const count = Math.max(2, Math.round(n));
  const half = Math.floor(count / 2);
  const extraLeft = count % 2 === 1 && r() < 0.5;
  const nLeft = half + (extraLeft ? 1 : 0);
  const nRight = count - nLeft;

  let order: StarrySide[] = [];
  for (let attempt = 0; attempt < 200; attempt++) {
    order = shuffle(r, [...Array<StarrySide>(nLeft).fill("left"), ...Array<StarrySide>(nRight).fill("right")]);
    if (longestRun(order) <= 3) break;
  }

  const cells = { left: cellsFor(r, "left", nLeft), right: cellsFor(r, "right", nRight) };
  const used = { left: 0, right: 0 };
  const cellW = (D.width - 2 * D.margin) / D.columns;
  const cellH = (D.height - 2 * D.margin) / D.rows;
  const pad = D.targetRadius * 2;

  return order.map((side, i) => {
    const { col, row } = cells[side][used[side]++]!;
    // Jitter inside the cell, but never closer than `pad` to the cell edge (keeps the midline clean).
    const x = D.margin + col * cellW + pad + r() * (cellW - 2 * pad);
    const y = D.margin + row * cellH + pad + r() * (cellH - 2 * pad);
    const gapMs = Math.round(D.gapMinMs + r() * (D.gapMaxMs - D.gapMinMs));
    return { id: `starry-${seed}-${i + 1}`, side, col, row, x: Math.round(x), y: Math.round(y), gapMs: i === 0 ? D.leadInMs : gapMs };
  });
}

/** Rough run length in seconds, for the intro. */
export function starryDurationS(trials: StarryTrial[]): number {
  const ms = trials.reduce((s, t) => s + t.gapMs + STARRY_DEFAULTS.responseWindowMs, 0);
  return Math.round(ms / 1000);
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Lateral index = left hit rate minus right hit rate (negative = left weaker), Eq. (1). */
export function scoreStarry(trials: StarryTrial[], responses: StarryResponse[], presses: StarryPress[] = []): StarryScore {
  const byId = new Map(responses.map((x) => [x.trialId, x]));
  const summarize = (ts: StarryTrial[]) => {
    const rts: number[] = [];
    for (const t of ts) {
      const rt = byId.get(t.id)?.rtMs;
      if (rt !== null && rt !== undefined) rts.push(rt);
    }
    return { hits: rts.length, n: ts.length, medianRtMs: median(rts) };
  };
  const left = summarize(trials.filter((t) => t.side === "left"));
  const right = summarize(trials.filter((t) => t.side === "right"));
  const columns = Array.from({ length: STARRY_DEFAULTS.columns }, (_, col) => {
    const s = summarize(trials.filter((t) => t.col === col));
    return { col, ...s, rate: s.n ? s.hits / s.n : null };
  });
  const falseAlarms = presses.filter((p) => p.trialId === null).length;
  const rateL = left.n ? left.hits / left.n : 0;
  const rateR = right.n ? right.hits / right.n : 0;
  const value = rateL - rateR;
  return {
    left,
    right,
    columns,
    falseAlarms,
    rtGapMs: left.medianRtMs !== null && right.medianRtMs !== null ? left.medianRtMs - right.medianRtMs : null,
    observation: {
      test: "detection",
      label: "Starry Night",
      value,
      se: seProportionDiff(left.hits, left.n, right.hits, right.n),
      n: left.n + right.n,
    },
    healthyRange: compareToNorm(value, STARRY_LATERALITY),
  };
}
