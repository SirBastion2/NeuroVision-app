/**
 * Clock check: two clocks stacked vertically, one correct and one with an
 * error placed in its LEFT half (7-11) or RIGHT half (1-5). The person picks
 * the correctly drawn clock with Up/Down (or a tap), so the response itself
 * is never lateral.
 *
 * Neglect predicts more misses (or slower answers) for left-half errors.
 * Pure functions only. Self-contained except for a type-only import.
 */
import type { TestObservation } from "./evidence.js";
import { CLOCK_LATERALITY, compareToNorm, type HealthyRangeReading } from "./norms.js";

export type ClockSide = "left" | "right";
export type ClockErrorType = "swap" | "missing" | "shift";
export type StackPosition = "top" | "bottom";

export interface ClockNumeral {
  label: string;
  /** Degrees, 0 = 3 o'clock, -90 = 12 o'clock (SVG convention). */
  angleDeg: number;
  /** Fraction of the face radius. */
  radius: number;
}

export interface ClockFace {
  numerals: ClockNumeral[];
  hourAngle: number;
  minuteAngle: number;
}

export interface ClockTrial {
  id: string;
  errorSide: ClockSide;
  errorType: ClockErrorType;
  errorDetail: string;
  correctPosition: StackPosition;
  correct: ClockFace;
  faulty: ClockFace;
  time: { h: number; m: number };
}

export interface ClockResponse {
  trialId: string;
  choice: StackPosition | null;
  rtMs: number | null;
}

export interface ClockSideSummary {
  correct: number;
  n: number;
  medianCorrectRtMs: number | null;
}

export interface ClockScore {
  left: ClockSideSummary;
  right: ClockSideSummary;
  timeouts: number;
  observation: TestObservation;
  healthyRange: HealthyRangeReading;
}

export const CLOCK_DEFAULTS = {
  /** Clocks are visible this long, then masked. Pilot so healthy accuracy lands near 80-90%. */
  exposureMs: 1500,
  responseTimeoutMs: 4000,
  numeralRadius: 0.78,
  shiftedRadius: 0.5,
  demoTrials: 10,
  fullTrials: 30,
};

const LEFT_SWAPS: Array<[number, number]> = [
  [7, 9],
  [8, 10],
  [9, 11],
];
const RIGHT_SWAPS: Array<[number, number]> = [
  [1, 3],
  [2, 4],
  [3, 5],
];
const LEFT_SINGLE = [8, 9, 10];
const RIGHT_SINGLE = [2, 3, 4];
const ERROR_TYPES: ClockErrorType[] = ["swap", "missing", "shift"];

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

function pick<T>(r: () => number, items: T[]): T {
  return items[Math.floor(r() * items.length)];
}

function shuffle<T>(r: () => number, items: T[]): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function numeralAngle(n: number): number {
  return (n % 12) * 30 - 90;
}

function baseFace(h: number, m: number): ClockFace {
  const numerals: ClockNumeral[] = [];
  for (let n = 1; n <= 12; n++) numerals.push({ label: String(n), angleDeg: numeralAngle(n), radius: CLOCK_DEFAULTS.numeralRadius });
  return { numerals, hourAngle: ((h % 12) + m / 60) * 30 - 90, minuteAngle: m * 6 - 90 };
}

function applyError(face: ClockFace, side: ClockSide, type: ClockErrorType, r: () => number): { face: ClockFace; detail: string } {
  const out: ClockFace = { ...face, numerals: face.numerals.map((n) => ({ ...n })) };
  const byLabel = (v: number) => out.numerals.find((n) => n.label === String(v))!;
  if (type === "swap") {
    const [a, b] = pick(r, side === "left" ? LEFT_SWAPS : RIGHT_SWAPS);
    byLabel(a).label = String(b);
    out.numerals.filter((n) => n.angleDeg === numeralAngle(b))[0].label = String(a);
    return { face: out, detail: `${a} and ${b} swapped` };
  }
  const v = pick(r, side === "left" ? LEFT_SINGLE : RIGHT_SINGLE);
  if (type === "missing") {
    out.numerals = out.numerals.filter((n) => n.label !== String(v));
    return { face: out, detail: `${v} missing` };
  }
  byLabel(v).radius = CLOCK_DEFAULTS.shiftedRadius;
  return { face: out, detail: `${v} pulled inward` };
}

/** Balanced trials: equal left/right errors, error types cycled, correct clock top/bottom counterbalanced. */
export function generateClockTrials(n: number, seed = 1): ClockTrial[] {
  const r = rng(seed);
  const count = Math.max(2, n - (n % 2));
  const plan: Array<{ side: ClockSide; type: ClockErrorType; pos: StackPosition }> = [];
  for (let i = 0; i < count; i++) {
    plan.push({
      side: i % 2 === 0 ? "left" : "right",
      type: ERROR_TYPES[Math.floor(i / 2) % ERROR_TYPES.length],
      pos: Math.floor(i / 2) % 2 === 0 ? "top" : "bottom",
    });
  }
  return shuffle(r, plan).map((p, i) => {
    const h = 1 + Math.floor(r() * 12);
    const m = 5 * Math.floor(r() * 12);
    const correct = baseFace(h, m);
    const { face, detail } = applyError(correct, p.side, p.type, r);
    return {
      id: `clock-${seed}-${i + 1}`,
      errorSide: p.side,
      errorType: p.type,
      errorDetail: detail,
      correctPosition: p.pos,
      correct,
      faulty: face,
      time: { h, m },
    };
  });
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function seDiff(x1: number, n1: number, x2: number, n2: number): number {
  const p1 = (x1 + 0.5) / (n1 + 1);
  const p2 = (x2 + 0.5) / (n2 + 1);
  return Math.sqrt((p1 * (1 - p1)) / Math.max(1, n1) + (p2 * (1 - p2)) / Math.max(1, n2));
}

/** Lateral index = accuracy on left-half errors minus right-half errors (negative = left weaker). */
export function scoreClock(trials: ClockTrial[], responses: ClockResponse[]): ClockScore {
  const byId = new Map(responses.map((x) => [x.trialId, x]));
  const side = (s: ClockSide): ClockSideSummary => {
    const ts = trials.filter((t) => t.errorSide === s);
    const rts: number[] = [];
    let correct = 0;
    for (const t of ts) {
      const resp = byId.get(t.id);
      if (resp && resp.choice === t.correctPosition) {
        correct++;
        if (resp.rtMs !== null) rts.push(resp.rtMs);
      }
    }
    return { correct, n: ts.length, medianCorrectRtMs: median(rts) };
  };
  const left = side("left");
  const right = side("right");
  const timeouts = trials.filter((t) => !byId.get(t.id) || byId.get(t.id)!.choice === null).length;
  const accL = left.n ? left.correct / left.n : 0;
  const accR = right.n ? right.correct / right.n : 0;
  const value = accL - accR;
  return {
    left,
    right,
    timeouts,
    observation: {
      test: "clock",
      label: "Clock check",
      value,
      se: seDiff(left.correct, left.n, right.correct, right.n),
      n: left.n + right.n,
    },
    healthyRange: compareToNorm(value, CLOCK_LATERALITY),
  };
}
