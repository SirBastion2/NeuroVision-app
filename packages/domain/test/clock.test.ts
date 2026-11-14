import { test } from "node:test";
import assert from "node:assert/strict";
import { generateClockTrials, scoreClock, type ClockFace } from "../src/clock.js";

const isLeftHalf = (deg: number) => Math.cos((deg * Math.PI) / 180) < -0.01;
function changedNumerals(a: ClockFace, b: ClockFace) {
  const changed: number[] = [];
  for (const n of a.numerals) {
    const m = b.numerals.find((x) => x.angleDeg === n.angleDeg);
    if (!m || m.label !== n.label || m.radius !== n.radius) changed.push(n.angleDeg);
  }
  return changed;
}

test("trials are balanced by side and counterbalanced by position", () => {
  const t = generateClockTrials(30, 3);
  assert.equal(t.length, 30);
  assert.equal(t.filter((x) => x.errorSide === "left").length, 15);
  const top = t.filter((x) => x.correctPosition === "top").length;
  assert.ok(top >= 13 && top <= 17);
});

test("every error sits in the half it claims, never on 12 or 6", () => {
  for (const trial of generateClockTrials(60, 11)) {
    const changed = changedNumerals(trial.correct, trial.faulty);
    assert.ok(changed.length >= 1, trial.errorDetail);
    for (const deg of changed) assert.equal(isLeftHalf(deg), trial.errorSide === "left", trial.errorDetail);
  }
});

test("missing left-half errors produce a negative lateral index", () => {
  const trials = generateClockTrials(20, 5);
  const responses = trials.map((t) => ({
    trialId: t.id,
    choice: t.errorSide === "left" ? (t.correctPosition === "top" ? "bottom" : "top") : t.correctPosition,
    rtMs: 900,
  })) as Parameters<typeof scoreClock>[1];
  const s = scoreClock(trials, responses);
  assert.equal(s.left.correct, 0);
  assert.equal(s.right.correct, s.right.n);
  assert.ok(s.observation.value < -0.9);
});
