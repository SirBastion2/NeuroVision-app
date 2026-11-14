import type { Area, GazeQuality, GazeSample, SessionResult, StarItem, StarLayout, TapEvent } from "../metrics/types";
import { clamp, gauss, normX, rng } from "../metrics/math";
import { signedDeviationPct } from "../metrics/bisection";
import { generateBisectionLayout } from "./bisection";
import { difficultyForLevel } from "./difficulty";
import { buildSession } from "./session";
import { generateStarLayout } from "./star";

export const SYNTHETIC_AREA: Area = { width: 1440, height: 860 };
const SAMPLE_MS = 33;

function syntheticQuality(): GazeQuality {
  return {
    source: "synthetic",
    calibrated: true,
    smoothing: "medium",
    validation: null,
    calibrationHeadYawDeg: 0,
    trackedFraction: null,
    fps: 30,
    clickRefinement: null,
  };
}

/**
 * Probability of detecting a target at normalized x for a given severity.
 * Severity 0: ~97% everywhere. Rising severity moves a logistic cut-off rightwards,
 * so detection falls off towards the left of the page.
 */
export function detectionProbability(nx: number, severity: number): number {
  const s = clamp(severity, 0, 1);
  const cutoff = -1.25 + 1.6 * s;
  return 0.97 / (1 + Math.exp(-(nx - cutoff) / 0.13));
}

interface Fixation {
  x: number;
  y: number;
  ms: number;
}

/** Turns a fixation sequence into ~30 Hz gaze samples with noise, saccades and blinks. */
function samplesFromFixations(fixations: Fixation[], rand: () => number, area: Area, yawBiasDeg: number): GazeSample[] {
  const out: GazeSample[] = [];
  let t = 0;
  for (const f of fixations) {
    const end = t + f.ms;
    while (t < end) {
      const blink = rand() < 0.012;
      const lost = rand() < 0.008;
      const usable = !blink && !lost;
      out.push({
        t: Math.round(t),
        x: usable ? clamp(f.x + gauss(rand) * 14, 0, area.width) : null,
        y: usable ? clamp(f.y + gauss(rand) * 22, 0, area.height) : null,
        confidence: usable ? 0.9 : 0,
        blink,
        isFixation: false,
        headYawDeg: yawBiasDeg + gauss(rand) * 1.5,
        headPitchDeg: gauss(rand) * 1.5,
      });
      t += SAMPLE_MS;
    }
  }
  return out;
}

/** A synthetic star-cancellation session for a participant with the given severity (0 to 1). */
export function generateSyntheticStarSession(severity: number, seed: number, opts: { createdAt?: Date; label?: string; area?: Area } = {}): SessionResult {
  const s = clamp(severity, 0, 1);
  const rand = rng(seed * 7919 + 13);
  const area = opts.area ?? SYNTHETIC_AREA;
  const difficulty = difficultyForLevel(2);
  const layout: StarLayout = generateStarLayout(area, difficulty, seed);
  const targets = layout.items.filter((i) => i.kind === "target");
  const distractors = layout.items.filter((i) => i.kind !== "target");

  // Search order: column sweeps that start at the right with probability rising with severity.
  const startRight = rand() < 0.35 + 0.6 * s;
  const sorted = [...targets].sort((a, b) => {
    const ca = Math.round(a.x / layout.spacing.x);
    const cb = Math.round(b.x / layout.spacing.x);
    if (ca !== cb) return startRight ? cb - ca : ca - cb;
    return (ca % 2 === 0 ? 1 : -1) * (a.y - b.y);
  });
  // Disorganised search: random swaps produce path crossings.
  for (let i = 0; i < sorted.length; i++) {
    if (rand() < 0.04 + 0.3 * s) {
      const j = Math.min(sorted.length - 1, i + 1 + Math.floor(rand() * 6));
      [sorted[i], sorted[j]] = [sorted[j]!, sorted[i]!];
    }
  }

  const taps: TapEvent[] = [];
  const fixations: Fixation[] = [{ x: area.width * (0.5 + 0.25 * s), y: area.height * 0.45, ms: 500 }];
  let t = 500;
  const look = (item: { x: number; y: number }, ms: number) => {
    fixations.push({ x: item.x, y: item.y, ms });
    t += ms;
  };
  const cancelled: StarItem[] = [];

  for (const target of sorted) {
    const nx = normX(target.x, area.width);
    const detected = rand() < detectionProbability(nx, s);
    if (detected) {
      look(target, 280 + rand() * 320);
      taps.push({ t: Math.round(t), x: target.x + gauss(rand) * 3, y: target.y + gauss(rand) * 3, targetId: target.id, kind: "cancel" });
      cancelled.push(target);
      look(target, 120);
    } else if (rand() < 0.25 * (1 - s) + 0.08) {
      // Looked at but not crossed out.
      look(target, 260 + rand() * 240);
    }
    // Right-biased exploratory fixations.
    if (rand() < 0.3) {
      const fx = area.width * clamp(0.55 + 0.3 * s + gauss(rand) * 0.22, 0.03, 0.97);
      look({ x: fx, y: area.height * (0.1 + 0.75 * rand()) }, 200 + rand() * 250);
    }
    // Revisits: go back to a target already crossed out.
    if (cancelled.length > 2 && rand() < 0.02 + 0.16 * s) {
      const back = cancelled[Math.floor(rand() * cancelled.length)]!;
      look(back, 260);
      taps.push({ t: Math.round(t), x: back.x, y: back.y, targetId: back.id, kind: "revisit" });
    }
    if (distractors.length && rand() < 0.008 + 0.05 * s) {
      const d = distractors[Math.floor(rand() * distractors.length)]!;
      look(d, 250);
      taps.push({ t: Math.round(t), x: d.x, y: d.y, targetId: d.id, kind: "commission" });
    }
  }
  look({ x: area.width / 2, y: area.height - 50 }, 400);
  const gaze = samplesFromFixations(fixations, rand, area, -14 * s);

  return buildSession({
    layout,
    difficulty,
    cued: false,
    source: "synthetic",
    label: opts.label ?? `Synthetic patient · severity ${s.toFixed(2)}`,
    taps,
    gaze,
    quality: syntheticQuality(),
    durationMs: Math.round(t),
    timedOut: false,
    createdAt: opts.createdAt,
    screen: { width: area.width, height: area.height, dpr: 1, screenWidth: area.width, screenHeight: area.height },
  });
}

/** A synthetic line-bisection session: mean rightward deviation grows with severity. */
export function generateSyntheticBisectionSession(severity: number, seed: number, opts: { createdAt?: Date; label?: string; area?: Area } = {}): SessionResult {
  const s = clamp(severity, 0, 1);
  const rand = rng(seed * 104729 + 7);
  const area = opts.area ?? SYNTHETIC_AREA;
  const layout = generateBisectionLayout(area, seed);
  const taps: TapEvent[] = [];
  const fixations: Fixation[] = [];
  let t = 400;
  for (const line of layout.lines) {
    const nx = normX((line.x1 + line.x2) / 2, area.width);
    if (rand() > detectionProbability(nx, s) + 0.02) continue;
    const dev = 18 * s + (nx < 0 ? 4 * s : 0) + gauss(rand) * (2.5 + 3 * s);
    const x = (line.x1 + line.x2) / 2 + (dev / 100) * (line.x2 - line.x1);
    fixations.push({ x: line.x2 - (line.x2 - line.x1) * 0.2, y: line.y, ms: 300 });
    fixations.push({ x, y: line.y, ms: 450 + rand() * 300 });
    t += 750 + rand() * 300;
    taps.push({ t: Math.round(t), x, y: line.y + gauss(rand) * 2, targetId: line.id, kind: "cancel" });
  }
  const gaze = samplesFromFixations(fixations, rand, area, -14 * s);
  const session = buildSession({
    layout,
    difficulty: difficultyForLevel(2),
    cued: false,
    source: "synthetic",
    label: opts.label ?? `Synthetic patient · severity ${s.toFixed(2)}`,
    taps,
    gaze,
    quality: syntheticQuality(),
    durationMs: Math.round(t + 500),
    timedOut: false,
    createdAt: opts.createdAt,
    screen: { width: area.width, height: area.height, dpr: 1, screenWidth: area.width, screenHeight: area.height },
  });
  return session;
}

/**
 * N visits with severity falling linearly from 0.8 to 0.2, one star and one bisection
 * session per visit, spaced a week apart. For the demo and the dashboard team.
 */
export function generateRecoverySeries(n: number, seed = 42, start = new Date("2026-09-01T15:00:00Z")): SessionResult[] {
  const out: SessionResult[] = [];
  for (let i = 0; i < n; i++) {
    const severity = n === 1 ? 0.8 : 0.8 - (0.6 * i) / (n - 1);
    const createdAt = new Date(start.getTime() + i * 7 * 86_400_000);
    const label = `Synthetic recovery · visit ${i + 1} of ${n}`;
    out.push(generateSyntheticStarSession(severity, seed + i, { createdAt, label }));
    out.push(generateSyntheticBisectionSession(severity, seed + 100 + i, { createdAt: new Date(createdAt.getTime() + 300_000), label }));
  }
  return out;
}

export { signedDeviationPct };
