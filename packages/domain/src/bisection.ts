/**
 * Quick line bisection for the battery. The repo already scores bisection in
 * packages/domain/src/scoring.ts; this module only turns signed errors into a
 * lateral observation for the evidence model, plus a small generator for the
 * reference demo. Prefer the repo's trials and scorer when wiring for real.
 *
 * Signed error is percent of line length, right of center positive.
 * Left neglect pushes marks RIGHT, so the lateral index is the NEGATED mean.
 */
import type { TestObservation } from "./evidence.js";

export interface BisectionLine {
  id: string;
  x1: number;
  x2: number;
  y: number;
}

export interface BisectionResponse {
  lineId: string;
  x: number | null;
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

/** Lines centered alternately left and right of the board middle, varied length. */
export function generateBisectionLines(n = 6, seed = 1, boardWidth = 960, boardHeight = 540): BisectionLine[] {
  const r = rng(seed);
  const lines: BisectionLine[] = [];
  for (let i = 0; i < n; i++) {
    const len = 300 + Math.round(r() * 360);
    const offset = (i % 2 === 0 ? -1 : 1) * (40 + Math.round(r() * 110));
    const cx = boardWidth / 2 + offset;
    lines.push({
      id: `line-${seed}-${i + 1}`,
      x1: Math.round(cx - len / 2),
      x2: Math.round(cx + len / 2),
      y: Math.round(boardHeight * (0.35 + r() * 0.3)),
    });
  }
  return lines;
}

export function signedErrorPct(line: BisectionLine, x: number): number {
  const mid = (line.x1 + line.x2) / 2;
  return (100 * (x - mid)) / (line.x2 - line.x1);
}

export function bisectionObservation(lines: BisectionLine[], responses: BisectionResponse[]): { errors: number[]; observation: TestObservation } {
  const byId = new Map(responses.map((x) => [x.lineId, x]));
  const errors: number[] = [];
  for (const l of lines) {
    const resp = byId.get(l.id);
    if (resp && resp.x !== null) errors.push(signedErrorPct(l, resp.x));
  }
  const mean = errors.length ? errors.reduce((a, b) => a + b, 0) / errors.length : 0;
  const sd =
    errors.length > 1 ? Math.sqrt(errors.reduce((a, b) => a + (b - mean) ** 2, 0) / (errors.length - 1)) : 3;
  return {
    errors,
    observation: {
      test: "bisection",
      label: "Line bisection",
      value: -mean,
      se: Math.max(0.5, sd / Math.sqrt(Math.max(1, errors.length))),
      n: errors.length,
    },
  };
}
