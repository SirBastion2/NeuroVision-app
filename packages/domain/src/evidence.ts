/**
 * Combined lateral-evidence model.
 *
 * Every test reports one lateral index where NEGATIVE means the LEFT side is
 * weaker and POSITIVE means the RIGHT side is weaker. Each index is
 * standardized against healthy norms, and all tests are treated as noisy
 * views of one hidden lean (theta, in healthy-SD units).
 *
 * Three hypotheses: "none" (balanced), "left" (left weaker), "right" (right weaker).
 * Pure functions only: no DOM, no I/O. Healthy means/SDs live in norms.ts.
 */

import {
  ASSUMED_NORM_NOTICE,
  DEFAULT_NORMS,
  isCalibratedNorm,
  type NormCitation,
  type NormSample,
  type NormSource,
} from "./norms.js";

export type TestId = "scene" | "clock" | "greyscales" | "bisection" | "detection" | "cancellation";
export type Hypothesis = "none" | "left" | "right";

/** Only these three tests enter the shared-θ model (Section 4). */
export const MODEL_TEST_IDS = ["detection", "cancellation", "bisection"] as const satisfies readonly TestId[];
export type ModelTestId = (typeof MODEL_TEST_IDS)[number];

export function isModelTest(test: TestId): test is ModelTestId {
  return (MODEL_TEST_IDS as readonly TestId[]).includes(test);
}

export { ASSUMED_NORM_NOTICE };

export interface TestNorm {
  /** Healthy mean of the lateral index. Null when the metric is uncalibrated. */
  mean: number | null;
  /** Healthy between-person SD of the lateral index. Null when uncalibrated. */
  healthySd: number | null;
  /** How strongly a true lean shows up in this test relative to the others. 1 = average. */
  sensitivity: number;
  /** Where the numbers came from. "assumed" and "uncalibrated" must be shown to users. */
  source: NormSource;
  note?: string;
  calibrated?: boolean;
  cutoff?: number | null;
  sample?: NormSample | null;
  citation?: NormCitation | null;
}

export { DEFAULT_NORMS };

export interface TestObservation {
  test: TestId;
  label: string;
  /** Lateral index, negative = left weaker. */
  value: number;
  /** Sampling standard error of value for this person. */
  se: number;
  /** Trials or targets behind the value. */
  n: number;
  /** True when the result was caused on purpose (the hidden-scene trick). Excluded by default. */
  induced?: boolean;
}

export interface EvidenceOptions {
  priors?: Record<Hypothesis, number>;
  includeInduced?: boolean;
  /** A |standardized residual| above this flags a test as disagreeing with the rest. */
  discordanceZ?: number;
}

export interface TestEvidence {
  test: TestId;
  label: string;
  included: boolean;
  induced: boolean;
  z: number;
  /** log10 Bayes factor, left vs none, from this test alone. */
  log10BfLeft: number;
  /** log10 Bayes factor, right vs none, from this test alone. */
  log10BfRight: number;
  favors: Hypothesis;
  /** How many times more likely the favored hypothesis is than the next best, from this test alone (>= 1). */
  factor: number;
  normSource: TestNorm["source"];
  discordant: boolean;
  residualZ: number | null;
}

export type Verdict = "strong-left" | "left" | "balanced" | "right" | "strong-right" | "inconclusive" | "no-data";

export interface EvidenceResult {
  posterior: Record<Hypothesis, number>;
  priors: Record<Hypothesis, number>;
  /** Posterior mean lean and 90% interval, in healthy-SD units. Negative = left weaker. */
  lean: { mean: number; lo: number; hi: number };
  verdict: { key: Verdict; text: string };
  tests: TestEvidence[];
  notes: string[];
  usesAssumedNorms: boolean;
  usesUncalibratedNorms: boolean;
}

const THETA: number[] = [];
for (let i = 0; i <= 480; i++) THETA.push(-12 + i * 0.05);
const HYPS: Hypothesis[] = ["none", "left", "right"];

function normalPdf(x: number, mean: number, sd: number): number {
  const z = (x - mean) / sd;
  return Math.exp(-0.5 * z * z) / (sd * Math.sqrt(2 * Math.PI));
}

/** Prior density of theta under each hypothesis, normalized on the grid. */
function thetaPrior(h: Hypothesis): number[] {
  const raw = THETA.map((t) => {
    if (h === "none") return normalPdf(t, 0, 0.35);
    if (h === "left") return t < -0.75 ? normalPdf(t, -0.75, 3) : 0;
    return t > 0.75 ? normalPdf(t, 0.75, 3) : 0;
  });
  const sum = raw.reduce((a, b) => a + b, 0);
  return raw.map((v) => v / sum);
}

const PRIOR_THETA: Record<Hypothesis, number[]> = {
  none: thetaPrior("none"),
  left: thetaPrior("left"),
  right: thetaPrior("right"),
};

/** Standardize a lateral index against healthy norms, folding in the person's own sampling error. */
export function standardize(obs: TestObservation, norm: TestNorm): number {
  if (!isCalibratedNorm(norm) || norm.mean == null || norm.healthySd == null) return Number.NaN;
  const denom = Math.sqrt(norm.healthySd ** 2 + Math.max(0, obs.se) ** 2);
  return (obs.value - norm.mean) / denom;
}

interface Score {
  z: number;
  k: number;
}

function likelihoodOnGrid(scores: Score[]): number[] {
  return THETA.map((t) => {
    let l = 1;
    for (const { z, k } of scores) l *= normalPdf(z, k * t, 1);
    return l;
  });
}

function marginal(h: Hypothesis, lik: number[]): number {
  const p = PRIOR_THETA[h];
  let s = 0;
  for (let i = 0; i < THETA.length; i++) s += p[i] * lik[i];
  return s;
}

function posteriorOver(scores: Score[], priors: Record<Hypothesis, number>) {
  const lik = likelihoodOnGrid(scores);
  const m: Record<Hypothesis, number> = { none: marginal("none", lik), left: marginal("left", lik), right: marginal("right", lik) };
  const total = HYPS.reduce((a, h) => a + priors[h] * m[h], 0);
  const post: Record<Hypothesis, number> = {
    none: (priors.none * m.none) / total,
    left: (priors.left * m.left) / total,
    right: (priors.right * m.right) / total,
  };
  const thetaPost = THETA.map((_, i) => HYPS.reduce((a, h) => a + priors[h] * PRIOR_THETA[h][i] * lik[i], 0) / total);
  return { post, m, thetaPost };
}

function quantile(weights: number[], q: number): number {
  let acc = 0;
  for (let i = 0; i < THETA.length; i++) {
    acc += weights[i];
    if (acc >= q) return THETA[i];
  }
  return THETA[THETA.length - 1];
}

export function verdictFor(post: Record<Hypothesis, number>, hasData: boolean): { key: Verdict; text: string } {
  if (!hasData) return { key: "no-data", text: "Not enough data yet." };
  if (post.left >= 0.95) return { key: "strong-left", text: "Strong evidence of a left-side lean, outside the healthy range." };
  if (post.right >= 0.95) return { key: "strong-right", text: "Strong evidence of a right-side lean, outside the healthy range." };
  if (post.left >= 0.8) return { key: "left", text: "Leans toward the left, outside the healthy range." };
  if (post.right >= 0.8) return { key: "right", text: "Leans toward the right, outside the healthy range." };
  if (post.none >= 0.8) return { key: "balanced", text: "Balanced — within the healthy range on both sides." };
  return { key: "inconclusive", text: "Inconclusive; more trials would settle it." };
}

/**
 * Combine every test into one posterior over {none, left, right}.
 * The joint result is computed with one shared theta, so it is NOT the product
 * of the single-test factors shown per row (those are for explanation only).
 */
export function combineEvidence(
  observations: TestObservation[],
  norms: Partial<Record<TestId, TestNorm>> = {},
  options: EvidenceOptions = {},
): EvidenceResult {
  const raw = options.priors ?? { none: 1 / 3, left: 1 / 3, right: 1 / 3 };
  const pSum = raw.none + raw.left + raw.right;
  const priors: Record<Hypothesis, number> = { none: raw.none / pSum, left: raw.left / pSum, right: raw.right / pSum };
  const cut = options.discordanceZ ?? 2.5;
  const normFor = (t: TestId): TestNorm => norms[t] ?? DEFAULT_NORMS[t];

  const rows = observations.map((o) => {
    const norm = normFor(o.test);
    const z = standardize(o, norm);
    const included =
      isModelTest(o.test) &&
      isCalibratedNorm(norm) &&
      Number.isFinite(z) &&
      o.n > 0 &&
      (!o.induced || !!options.includeInduced);
    return { o, norm, z, k: Number.isFinite(norm.sensitivity) ? norm.sensitivity : 1, included };
  });
  const used = rows.filter((r) => r.included);
  const { post, thetaPost } = posteriorOver(
    used.map((r) => ({ z: r.z, k: r.k })),
    priors,
  );

  let mean = 0;
  for (let i = 0; i < THETA.length; i++) mean += THETA[i] * thetaPost[i];

  const tests: TestEvidence[] = rows.map((r) => {
    const single = Number.isFinite(r.z) ? posteriorOver([{ z: r.z, k: r.k }], priors).m : { none: 1, left: 1, right: 1 };
    const log10BfLeft = Math.log10(single.left / single.none);
    const log10BfRight = Math.log10(single.right / single.none);
    let favors: Hypothesis = "none";
    let factor: number;
    if (log10BfLeft > 0 && log10BfLeft >= log10BfRight) {
      favors = "left";
      factor = 10 ** (log10BfLeft - Math.max(0, log10BfRight));
    } else if (log10BfRight > 0) {
      favors = "right";
      factor = 10 ** (log10BfRight - Math.max(0, log10BfLeft));
    } else {
      factor = 10 ** -Math.max(log10BfLeft, log10BfRight);
    }

    let residualZ: number | null = null;
    let discordant = false;
    const others = used.filter((u) => u !== r);
    if (r.included && others.length >= 1) {
      const rest = posteriorOver(
        others.map((u) => ({ z: u.z, k: u.k })),
        priors,
      ).thetaPost;
      let m1 = 0;
      let m2 = 0;
      for (let i = 0; i < THETA.length; i++) {
        const mu = r.k * THETA[i];
        m1 += rest[i] * mu;
        m2 += rest[i] * (1 + mu * mu);
      }
      const sd = Math.sqrt(Math.max(1e-9, m2 - m1 * m1));
      residualZ = (r.z - m1) / sd;
      discordant = Math.abs(residualZ) > cut;
    }

    return {
      test: r.o.test,
      label: r.o.label,
      included: r.included,
      induced: !!r.o.induced,
      z: r.z,
      log10BfLeft,
      log10BfRight,
      favors,
      factor,
      normSource: r.norm.source,
      discordant,
      residualZ,
    };
  });

  const notes: string[] = [];
  for (const t of tests) {
    if (t.induced && !t.included) notes.push(`${t.label} was produced on purpose for the demonstration, so it isn't counted.`);
    if ((t.normSource === "uncalibrated" || !isModelTest(t.test)) && !t.induced) {
      notes.push(`${t.label} does not enter the evidence model.`);
    }
    if (t.discordant) {
      notes.push(`${t.label} disagrees with the other tests (|r| > 2.5). That disagreement is reported, not averaged away.`);
    }
  }
  const usesAssumedNorms = used.some((r) => r.norm.source === "assumed");
  const usesUncalibratedNorms = rows.some((r) => r.norm.source === "uncalibrated" || r.norm.calibrated === false);
  if (usesAssumedNorms) notes.push(ASSUMED_NORM_NOTICE);
  if (usesUncalibratedNorms) notes.push("Clock, greyscales, gaze, and Hidden scene do not enter the evidence model.");

  return {
    posterior: post,
    priors,
    lean: { mean, lo: quantile(thetaPost, 0.05), hi: quantile(thetaPost, 0.95) },
    verdict: verdictFor(post, used.length > 0),
    tests,
    notes,
    usesAssumedNorms,
    usesUncalibratedNorms,
  };
}

/** SE of a difference of two proportions, with a small-sample correction. */
export function seProportionDiff(x1: number, n1: number, x2: number, n2: number): number {
  const p1 = (x1 + 0.5) / (n1 + 1);
  const p2 = (x2 + 0.5) / (n2 + 1);
  return Math.sqrt((p1 * (1 - p1)) / Math.max(1, n1) + (p2 * (1 - p2)) / Math.max(1, n2));
}

/**
 * Fit healthy norms from event participants. Use only non-induced, consented runs.
 * Small samples underestimate spread, which would make the model overconfident,
 * so the fit is shrunk toward a prior norm worth `pseudoN` participants.
 */
export const NORM_FIT_MIN_N = 5;
export const NORM_FIT_KAPPA = 8;

export function fitNorms(values: number[], sensitivity = 1, prior?: TestNorm, pseudoN = NORM_FIT_KAPPA): TestNorm | null {
  if (values.length < NORM_FIT_MIN_N) return null;
  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1));
  const usablePrior = prior && prior.mean != null && prior.healthySd != null;
  const k = usablePrior ? pseudoN : 0;
  const m = usablePrior ? (n * mean + k * prior.mean!) / (n + k) : mean;
  const s = usablePrior ? Math.sqrt(((n - 1) * sd * sd + k * prior.healthySd! ** 2) / (n - 1 + k)) : sd;
  return {
    mean: m,
    healthySd: Math.max(s, 1e-3),
    sensitivity,
    source: "hacker-norms",
    calibrated: true,
    cutoff: prior?.cutoff ?? null,
    note: usablePrior ? `Fitted from ${n} event participants, shrunk toward the prior norm.` : `Fitted from ${n} event participants.`,
  };
}
