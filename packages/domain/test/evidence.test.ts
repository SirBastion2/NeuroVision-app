import { test } from "node:test";
import assert from "node:assert/strict";
import { combineEvidence, fitNorms, type TestObservation } from "../src/evidence.js";

const obs = (test: TestObservation["test"], value: number, se = 0.08, n = 20, induced = false): TestObservation => ({
  test, label: test, value, se, n, induced,
});

test("balanced results favor 'none'", () => {
  const r = combineEvidence([obs("scene", 0), obs("clock", 0.02)]);
  assert.ok(r.posterior.none > r.posterior.left && r.posterior.none > r.posterior.right);
  const s = r.posterior.none + r.posterior.left + r.posterior.right;
  assert.ok(Math.abs(s - 1) < 1e-9);
});

test("strong left-weaker results on two tests give a left verdict", () => {
  const r = combineEvidence([obs("scene", -0.4, 0.1), obs("clock", -0.5, 0.15)]);
  assert.ok(r.posterior.left > 0.9, `left=${r.posterior.left}`);
  assert.ok(r.lean.mean < 0);
  assert.match(r.verdict.key, /left/);
});

test("sign convention: positive values point to the right side", () => {
  const r = combineEvidence([obs("scene", 0.4, 0.1), obs("clock", 0.5, 0.15)]);
  assert.ok(r.posterior.right > 0.9);
});

test("induced observations are excluded unless asked for", () => {
  const data = [obs("clock", 0, 0.15), obs("scene", -0.8, 0.05, 21, true)];
  const off = combineEvidence(data);
  const on = combineEvidence(data, {}, { includeInduced: true });
  assert.equal(off.tests.find((t) => t.induced)!.included, false);
  assert.ok(on.posterior.left > off.posterior.left + 0.3);
  assert.ok(off.notes.some((n) => n.includes("on purpose")));
});

test("tests pointing opposite ways are flagged as disagreeing", () => {
  const r = combineEvidence([obs("scene", -0.5, 0.05), obs("clock", 0.6, 0.08), obs("bisection", 0, 0.8)]);
  assert.ok(r.tests.some((t) => t.discordant));
});

test("greyscales at the healthy pseudoneglect mean is not called a lean", () => {
  const r = combineEvidence([obs("greyscales", 0.2, 0.15, 40)]);
  assert.ok(r.posterior.none > 0.5, `none=${r.posterior.none}`);
});

test("per-test factors point the right way and are at least 1", () => {
  const r = combineEvidence([obs("scene", -0.3, 0.08)]);
  const t = r.tests[0];
  assert.equal(t.favors, "left");
  assert.ok(t.factor >= 1);
});

test("fitted norms replace placeholders and are labeled", () => {
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
  assert.ok(shrunk.healthySd > raw.healthySd * 5);
  assert.ok(shrunk.healthySd < 0.06);
});
