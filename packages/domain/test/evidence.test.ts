import { test } from "node:test";
import assert from "node:assert/strict";
import { combineEvidence, DEFAULT_NORMS, fitNorms, type TestNorm, type TestObservation } from "../src/evidence.js";

const obs = (test: TestObservation["test"], value: number, se = 0.08, n = 20, induced = false): TestObservation => ({
  test, label: test, value, se, n, induced,
});

const toy: TestNorm = { mean: 0, healthySd: 0.1, sensitivity: 1, source: "hacker-norms", calibrated: true };

test("balanced results favor 'none'", () => {
  const r = combineEvidence([obs("scene", 0), obs("clock", 0.02)], { scene: toy, clock: toy });
  assert.ok(r.posterior.none > r.posterior.left && r.posterior.none > r.posterior.right);
  const s = r.posterior.none + r.posterior.left + r.posterior.right;
  assert.ok(Math.abs(s - 1) < 1e-9);
});

test("strong left-weaker results on two tests give a left verdict", () => {
  const r = combineEvidence([obs("scene", -0.4, 0.1), obs("clock", -0.5, 0.15)], { scene: toy, clock: toy });
  assert.ok(r.posterior.left > 0.9, `left=${r.posterior.left}`);
  assert.ok(r.lean.mean < 0);
  assert.match(r.verdict.key, /left/);
});

test("sign convention: positive values point to the right side", () => {
  const r = combineEvidence([obs("scene", 0.4, 0.1), obs("clock", 0.5, 0.15)], { scene: toy, clock: toy });
  assert.ok(r.posterior.right > 0.9);
});

test("induced observations are excluded unless asked for", () => {
  const data = [obs("clock", 0, 0.15), obs("scene", -0.8, 0.05, 21, true)];
  const off = combineEvidence(data, { clock: toy, scene: toy });
  const on = combineEvidence(data, { clock: toy, scene: toy }, { includeInduced: true });
  assert.equal(off.tests.find((t) => t.induced)!.included, false);
  assert.ok(on.posterior.left > off.posterior.left + 0.3);
  assert.ok(off.notes.some((n) => n.includes("on purpose")));
});

test("tests pointing opposite ways are flagged as disagreeing", () => {
  const r = combineEvidence([obs("scene", -0.5, 0.05), obs("clock", 0.6, 0.08), obs("bisection", 0, 0.8)], {
    scene: toy,
    clock: toy,
    bisection: toy,
  });
  assert.ok(r.tests.some((t) => t.discordant));
});

test("greyscales at the published healthy mean is not called a lean", () => {
  const mean = DEFAULT_NORMS.greyscales.mean;
  assert.ok(mean != null);
  const r = combineEvidence([obs("greyscales", mean, 0.15, 40)]);
  assert.ok(r.posterior.none > 0.5, `none=${r.posterior.none}`);
  assert.equal(DEFAULT_NORMS.greyscales.source, "literature");
});

test("per-test factors point the right way and are at least 1", () => {
  const r = combineEvidence([obs("scene", -0.3, 0.08)], { scene: toy });
  const t = r.tests[0];
  assert.equal(t.favors, "left");
  assert.ok(t.factor >= 1);
});

test("fitted norms replace assumed values and are labeled", () => {
  const n = fitNorms([0.01, -0.02, 0.03, 0, -0.01, 0.02]);
  assert.ok(n && n.source === "hacker-norms");
  const r = combineEvidence([obs("scene", 0)], { scene: n! });
  assert.equal(r.usesAssumedNorms, false);
  assert.equal(fitNorms([1, 2]), null);
});

test("small-sample norms are shrunk toward the prior so they can't get overconfident", () => {
  const tight = [0, 0, 0.01, 0, 0, 0];
  const raw = fitNorms(tight)!;
  const shrunk = fitNorms(tight, 1, { mean: 0, healthySd: 0.06, sensitivity: 1, source: "assumed" })!;
  assert.ok(shrunk.healthySd != null && raw.healthySd != null);
  assert.ok(shrunk.healthySd > raw.healthySd * 5);
  assert.ok(shrunk.healthySd < 0.06);
});

test("uncalibrated default clock and scene are excluded from the posterior", () => {
  const r = combineEvidence([obs("clock", -0.5), obs("scene", -0.4)]);
  assert.equal(r.verdict.key, "no-data");
  assert.equal(r.usesUncalibratedNorms, true);
  assert.ok(r.tests.every((t) => !t.included));
  assert.ok(r.notes.some((n) => n.includes("no published healthy range")));
});
