import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ASSUMED_NORM_NOTICE,
  combineEvidence,
  DEFAULT_NORMS,
  fitNorms,
  MODEL_TEST_IDS,
  NORM_FIT_KAPPA,
  NORM_FIT_MIN_N,
  seProportionDiff,
  standardize,
  type TestId,
  type TestNorm,
  type TestObservation,
} from "../src/evidence.js";

const obs = (test: TestObservation["test"], value: number, se = 0.08, n = 20, induced = false): TestObservation => ({
  test,
  label: test,
  value,
  se,
  n,
  induced,
});

const toy: TestNorm = { mean: 0, healthySd: 0.1, sensitivity: 1, source: "hacker-norms", calibrated: true };
const unitNorm: TestNorm = { mean: 0, healthySd: 1, sensitivity: 1, source: "assumed", calibrated: true };

const zObs = (test: TestId, z: number, label?: string): TestObservation => ({
  test,
  label: label ?? test,
  value: z,
  se: 0,
  n: 20,
});

const zNorms = { detection: unitNorm, cancellation: unitNorm, bisection: unitNorm };

/** Table 3 reports rounded figures; accept two units in the last reported digit. */
function withinRounding(actual: number, expected: number, digits: number, label: string): void {
  const tol = 2 * 10 ** -digits;
  assert.ok(Math.abs(actual - expected) <= tol + 1e-12, `${label}: ${actual} vs ${expected} (tol ${tol})`);
}

test("balanced results favor 'none'", () => {
  const r = combineEvidence([obs("detection", 0), obs("cancellation", 0.02)], { detection: toy, cancellation: toy });
  assert.ok(r.posterior.none > r.posterior.left && r.posterior.none > r.posterior.right);
  const s = r.posterior.none + r.posterior.left + r.posterior.right;
  assert.ok(Math.abs(s - 1) < 1e-9);
});

test("strong left-weaker results on two tests give a left verdict", () => {
  const r = combineEvidence([obs("detection", -0.4, 0.1), obs("cancellation", -0.5, 0.15)], {
    detection: toy,
    cancellation: toy,
  });
  assert.ok(r.posterior.left > 0.9, `left=${r.posterior.left}`);
  assert.ok(r.lean.mean < 0);
  assert.match(r.verdict.key, /left/);
  assert.match(r.verdict.text, /lean/i);
  assert.doesNotMatch(r.verdict.text, /sever|diagnos/i);
});

test("sign convention: positive values point to the right side", () => {
  const r = combineEvidence([obs("detection", 0.4, 0.1), obs("cancellation", 0.5, 0.15)], {
    detection: toy,
    cancellation: toy,
  });
  assert.ok(r.posterior.right > 0.9);
});

test("induced observations are excluded unless asked for", () => {
  const data = [obs("cancellation", 0, 0.15), obs("detection", -0.8, 0.05, 21, true)];
  const off = combineEvidence(data, { cancellation: toy, detection: toy });
  const on = combineEvidence(data, { cancellation: toy, detection: toy }, { includeInduced: true });
  assert.equal(off.tests.find((t) => t.induced)!.included, false);
  assert.ok(on.posterior.left > off.posterior.left + 0.3);
  assert.ok(off.notes.some((n) => n.includes("on purpose")));
});

test("tests pointing opposite ways are flagged as disagreeing", () => {
  const r = combineEvidence(
    [obs("detection", -0.5, 0.05), obs("cancellation", 0.6, 0.08), obs("bisection", 0, 0.8)],
    {
      detection: toy,
      cancellation: toy,
      bisection: toy,
    },
  );
  assert.ok(r.tests.some((t) => t.discordant));
});

test("clock, greyscales, scene, and gaze never enter the posterior", () => {
  const r = combineEvidence(
    [obs("clock", -0.5), obs("scene", -0.4), obs("greyscales", -0.8)],
    {
      clock: toy,
      scene: toy,
      greyscales: toy,
    },
  );
  assert.equal(r.verdict.key, "no-data");
  assert.ok(r.tests.every((t) => !t.included));
  assert.deepEqual([...MODEL_TEST_IDS].sort(), ["bisection", "cancellation", "detection"].sort());
});

test("per-test factors point the right way and are at least 1", () => {
  const r = combineEvidence([obs("detection", -0.3, 0.08)], { detection: toy });
  const t = r.tests[0];
  assert.equal(t.favors, "left");
  assert.ok(t.factor >= 1);
});

test("fitted norms replace assumed values and are labeled", () => {
  const n = fitNorms([0.01, -0.02, 0.03, 0, -0.01, 0.02]);
  assert.ok(n && n.source === "hacker-norms");
  const r = combineEvidence([obs("cancellation", 0)], { cancellation: n! });
  assert.equal(r.usesAssumedNorms, false);
  assert.equal(fitNorms([1, 2]), null);
  assert.equal(NORM_FIT_MIN_N, 5);
  assert.equal(NORM_FIT_KAPPA, 8);
});

test("small-sample norms are shrunk toward the prior so they can't get overconfident", () => {
  const tight = [0, 0, 0.01, 0, 0, 0];
  const raw = fitNorms(tight)!;
  const shrunk = fitNorms(tight, 1, { mean: 0, healthySd: 0.06, sensitivity: 1, source: "assumed" })!;
  assert.ok(shrunk.healthySd != null && raw.healthySd != null);
  assert.ok(shrunk.healthySd > raw.healthySd * 5);
  assert.ok(shrunk.healthySd < 0.06);
});

test("Eq. (9) shrinks the sample mean and variance toward the placeholder with κ = 8", () => {
  const values = [0.1, 0.12, 0.08, 0.11, 0.09];
  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1));
  const prior: TestNorm = { mean: 0, healthySd: 0.06, sensitivity: 1, source: "assumed", calibrated: true };
  const fitted = fitNorms(values, 1, prior, 8)!;
  const expectedMean = (n * mean + 8 * 0) / (n + 8);
  const expectedVar = ((n - 1) * sd * sd + 8 * 0.06 ** 2) / (n - 1 + 8);
  assert.ok(Math.abs(fitted.mean! - expectedMean) < 1e-12);
  assert.ok(Math.abs(fitted.healthySd! ** 2 - expectedVar) < 1e-12);
});

test("uncalibrated default clock and scene are excluded from the posterior", () => {
  const r = combineEvidence([obs("clock", -0.5), obs("scene", -0.4)]);
  assert.equal(r.verdict.key, "no-data");
  assert.equal(r.usesUncalibratedNorms, true);
  assert.ok(r.tests.every((t) => !t.included));
});

test("assumed Table 2 placeholders attach a notice when used", () => {
  const r = combineEvidence([obs("detection", 0, 0.1), obs("cancellation", 0, 0.05), obs("bisection", 1, 1.3)]);
  assert.equal(DEFAULT_NORMS.detection.source, "assumed");
  assert.equal(DEFAULT_NORMS.cancellation.source, "assumed");
  assert.equal(DEFAULT_NORMS.bisection.source, "assumed");
  assert.equal(r.usesAssumedNorms, true);
  assert.ok(r.notes.includes(ASSUMED_NORM_NOTICE));
  assert.doesNotMatch(r.notes.join(" "), /prototype/i);
});

test("Eq. (2) uses adjusted proportions (x + 1/2) / (n + 1)", () => {
  const p1 = (8 + 0.5) / (8 + 1);
  const p2 = (8 + 0.5) / (8 + 1);
  const expected = Math.sqrt((p1 * (1 - p1)) / 8 + (p2 * (1 - p2)) / 8);
  assert.ok(Math.abs(seProportionDiff(8, 8, 8, 8) - expected) < 1e-12);
  const perfect = seProportionDiff(7, 7, 8, 8);
  assert.ok(perfect > 0);
});

test("Eq. (3) folds sampling error into the healthy SD", () => {
  const z = standardize(obs("detection", 0.3, 0.08), { mean: 0, healthySd: 0.15, sensitivity: 1, source: "assumed", calibrated: true });
  assert.ok(Math.abs(z - 0.3 / Math.sqrt(0.15 ** 2 + 0.08 ** 2)) < 1e-12);
});

test("Table 3 profile A: all tests symmetric → balanced", () => {
  const r = combineEvidence(
    [zObs("detection", 0, "Starry Night"), zObs("cancellation", 0, "Hollow Rings"), zObs("bisection", -0.07, "Line bisection")],
    zNorms,
  );
  withinRounding(r.posterior.none, 0.925, 3, "P(H0)");
  withinRounding(r.posterior.left, 0.04, 3, "P(HL)");
  withinRounding(r.lean.mean, -0.01, 2, "θ");
  withinRounding(r.lean.lo, -0.7, 2, "θ lo");
  withinRounding(r.lean.hi, 0.65, 2, "θ hi");
  assert.equal(r.verdict.key, "balanced");
});

test("Table 3 profile B: left misses on all three → strong left", () => {
  const r = combineEvidence(
    [zObs("detection", -1.69, "Starry Night"), zObs("cancellation", -2.53, "Hollow Rings"), zObs("bisection", -2.24, "Line bisection")],
    zNorms,
  );
  withinRounding(r.posterior.none, 0.015, 3, "P(H0)");
  withinRounding(r.posterior.left, 0.985, 3, "P(HL)");
  withinRounding(r.lean.mean, -2.1, 2, "θ");
  withinRounding(r.lean.lo, -3.05, 2, "θ lo");
  withinRounding(r.lean.hi, -1.15, 2, "θ hi");
  assert.equal(r.verdict.key, "strong-left");
});

test("Table 3 profile C: slight left weakness → inconclusive", () => {
  const r = combineEvidence(
    [zObs("detection", -0.63, "Starry Night"), zObs("cancellation", -0.68, "Hollow Rings"), zObs("bisection", -0.91, "Line bisection")],
    zNorms,
  );
  withinRounding(r.posterior.none, 0.719, 3, "P(H0)");
  withinRounding(r.posterior.left, 0.279, 3, "P(HL)");
  withinRounding(r.lean.mean, -0.48, 2, "θ");
  withinRounding(r.lean.lo, -1.5, 2, "θ lo");
  withinRounding(r.lean.hi, 0.25, 2, "θ hi");
  assert.equal(r.verdict.key, "inconclusive");
  assert.match(r.verdict.text, /more trials would settle it/i);
});

test("Table 3 profile D: bisection shifted only → inconclusive and flagged", () => {
  const r = combineEvidence(
    [zObs("detection", 0, "Starry Night"), zObs("cancellation", 0, "Hollow Rings"), zObs("bisection", -3.66, "Line bisection")],
    zNorms,
  );
  withinRounding(r.posterior.none, 0.365, 3, "P(H0)");
  withinRounding(r.posterior.left, 0.635, 3, "P(HL)");
  withinRounding(r.lean.mean, -1.02, 2, "θ");
  withinRounding(r.lean.lo, -2.1, 2, "θ lo");
  withinRounding(r.lean.hi, 0, 2, "θ hi");
  assert.equal(r.verdict.key, "inconclusive");
  const bis = r.tests.find((t) => t.test === "bisection");
  assert.ok(bis?.discordant);
  assert.ok(Math.abs(bis!.residualZ!) > 2.5);
});
