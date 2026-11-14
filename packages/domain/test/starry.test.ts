import { test } from "node:test";
import assert from "node:assert/strict";
import { STARRY_DEFAULTS as D, generateStarryTrials, scoreStarry } from "../src/starry.js";

test("targets are balanced left/right with short same-side runs", () => {
  for (const seed of [1, 2, 3, 99]) {
    const t = generateStarryTrials(40, seed);
    assert.equal(t.length, 40);
    assert.equal(t.filter((x) => x.side === "left").length, 20);
    let run = 1;
    for (let i = 1; i < t.length; i++) {
      run = t[i]!.side === t[i - 1]!.side ? run + 1 : 1;
      assert.ok(run <= 3, `seed ${seed}: run of ${run}`);
    }
  }
});

test("every target sits on its own side, inside the field, and covers every cell", () => {
  const t = generateStarryTrials(40, 7);
  for (const x of t) {
    assert.equal(x.x < D.width / 2, x.side === "left");
    assert.ok(x.x > D.margin && x.x < D.width - D.margin && x.y > D.margin && x.y < D.height - D.margin);
    assert.equal(x.col < D.columns / 2, x.side === "left");
  }
  const cells = new Set(t.map((x) => `${x.col},${x.row}`));
  assert.equal(cells.size, D.columns * D.rows);
});

test("gaps are jittered within range and the first target waits for the lead-in", () => {
  const t = generateStarryTrials(40, 5);
  assert.equal(t[0]!.gapMs, D.leadInMs);
  for (const x of t.slice(1)) assert.ok(x.gapMs >= D.gapMinMs && x.gapMs <= D.gapMaxMs);
  assert.ok(new Set(t.map((x) => x.gapMs)).size > 10);
});

test("15 targets split 7/8 with the extra side random, and every run differs", () => {
  const extras = new Set<string>();
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
    const t = generateStarryTrials(15, seed);
    assert.equal(t.length, 15);
    const left = t.filter((x) => x.side === "left").length;
    assert.ok(left === 7 || left === 8);
    extras.add(left === 8 ? "left" : "right");
  }
  assert.equal(extras.size, 2);
  assert.notDeepEqual(generateStarryTrials(15, 1), generateStarryTrials(15, 2));
});

test("seeded generation is repeatable", () => {
  assert.deepEqual(generateStarryTrials(16, 42), generateStarryTrials(16, 42));
});

test("missing left targets gives a negative lateral index and a column gradient", () => {
  const t = generateStarryTrials(40, 3);
  const responses = t.map((x) => ({ trialId: x.id, rtMs: x.side === "right" ? 420 : x.col >= 2 ? 650 : null }));
  const s = scoreStarry(t, responses, [{ atMs: 10, trialId: null, sinceOnsetMs: null }]);
  assert.equal(s.right.hits, 20);
  assert.equal(s.left.hits, t.filter((x) => x.side === "left" && x.col >= 2).length);
  assert.ok(s.observation.value < -0.3);
  assert.equal(s.observation.test, "detection");
  assert.equal(s.columns[0]!.rate, 0);
  assert.equal(s.columns[7]!.rate, 1);
  assert.equal(s.rtGapMs, 230);
  assert.equal(s.falseAlarms, 1);
});

test("a perfect run is balanced", () => {
  const t = generateStarryTrials(16, 9);
  const s = scoreStarry(t, t.map((x) => ({ trialId: x.id, rtMs: 400 })));
  assert.equal(s.observation.value, 0);
  assert.equal(s.rtGapMs, 0);
});
