/**
 * Greyscales task (after Mattingley et al., 1994). Two horizontal bars are
 * stacked vertically. Each fades from black to white; one is darker on the
 * left end, the other is its mirror image, so both are exactly as dark
 * overall. The person picks which bar looks darker. There is no right answer.
 *
 * Healthy left-to-right readers tend to pick the darker-LEFT bar
 * (pseudoneglect). Left neglect predicts the opposite. Native reading
 * direction shifts the healthy baseline, so record it at consent.
 *
 * Pure functions only. Self-contained except for type-only imports.
 */
import type { TestNorm, TestObservation } from "./evidence.js";

export type DarkSide = "left" | "right";
export type BarPosition = "top" | "bottom";
export type ReadingDirection = "left-to-right" | "right-to-left" | "both-or-other";

export interface GreyscalesTrial {
  id: string;
  /** Which end of the TOP bar is dark. The bottom bar is always the mirror image. */
  topDarkSide: DarkSide;
}

export interface GreyscalesResponse {
  trialId: string;
  choice: BarPosition | null;
  rtMs: number | null;
}

export interface GreyscalesScore {
  darkerLeftChoices: number;
  darkerRightChoices: number;
  skipped: number;
  /** (darker-left - darker-right) / answered, from -1 to 1. */
  bias: number;
  firstHalfBias: number | null;
  secondHalfBias: number | null;
  observation: TestObservation;
}

export const GREYSCALES_DEFAULTS = {
  trials: 40,
  /** Free viewing, with a cap so the station keeps moving. */
  responseTimeoutMs: 6000,
  barWidthPx: 640,
  barHeightPx: 56,
  gapPx: 44,
};

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

/** Counterbalanced: half the trials have the darker-left bar on top. */
export function generateGreyscalesTrials(n: number = GREYSCALES_DEFAULTS.trials, seed = 1): GreyscalesTrial[] {
  const r = rng(seed);
  const count = Math.max(2, n - (n % 2));
  const sides: DarkSide[] = [];
  for (let i = 0; i < count; i++) sides.push(i % 2 === 0 ? "left" : "right");
  for (let i = sides.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [sides[i], sides[j]] = [sides[j], sides[i]];
  }
  return sides.map((s, i) => ({ id: `grey-${seed}-${i + 1}`, topDarkSide: s }));
}

export function chosenDarkSide(trial: GreyscalesTrial, choice: BarPosition): DarkSide {
  if (choice === "top") return trial.topDarkSide;
  return trial.topDarkSide === "left" ? "right" : "left";
}

function biasOf(sides: DarkSide[]): number | null {
  if (!sides.length) return null;
  const l = sides.filter((s) => s === "left").length;
  return (l - (sides.length - l)) / sides.length;
}

/** Lateral index = bias. Positive = favors left (healthy pseudoneglect); negative = left weaker. */
export function scoreGreyscales(trials: GreyscalesTrial[], responses: GreyscalesResponse[]): GreyscalesScore {
  const byId = new Map(responses.map((x) => [x.trialId, x]));
  const ordered: DarkSide[] = [];
  let skipped = 0;
  for (const t of trials) {
    const resp = byId.get(t.id);
    if (!resp || resp.choice === null) {
      skipped++;
      continue;
    }
    ordered.push(chosenDarkSide(t, resp.choice));
  }
  const l = ordered.filter((s) => s === "left").length;
  const rCount = ordered.length - l;
  const bias = ordered.length ? (l - rCount) / ordered.length : 0;
  const half = Math.floor(ordered.length / 2);
  return {
    darkerLeftChoices: l,
    darkerRightChoices: rCount,
    skipped,
    bias,
    firstHalfBias: biasOf(ordered.slice(0, half)),
    secondHalfBias: biasOf(ordered.slice(half)),
    observation: {
      test: "greyscales",
      label: "Greyscales",
      value: bias,
      se: Math.sqrt(Math.max(0.01, 1 - bias * bias) / Math.max(1, ordered.length)),
      n: ordered.length,
    },
  };
}

/** Healthy baseline depends on reading direction. Values are placeholders until event norms exist. */
export function greyscalesNormFor(direction: ReadingDirection): TestNorm {
  if (direction === "left-to-right") {
    return { mean: 0.2, healthySd: 0.35, sensitivity: 1, source: "assumed", note: "Left-to-right readers: leftward bias expected." };
  }
  return { mean: 0, healthySd: 0.35, sensitivity: 1, source: "assumed", note: "Right-to-left or mixed readers: little or no bias expected." };
}
