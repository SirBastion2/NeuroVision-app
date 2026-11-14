import { test } from "node:test";
import assert from "node:assert/strict";
import { generateScene, scoreScene, SCENE_DEFAULTS } from "../src/scene.js";
import { bisectionObservation, generateBisectionLines } from "../src/bisection.js";

for (const hide of ["left", "right"] as const) {
  test(`hide=${hide}: same seed gives the same scene`, () => {
    assert.deepEqual(generateScene({ seed: 9, hide }), generateScene({ seed: 9, hide }));
  });

  test(`hide=${hide}: 7 lit lanterns per panel, none near the hidden edge`, () => {
    const s = generateScene({ seed: 9, hide });
    for (const p of [0, 1, 2]) assert.equal(s.lanterns.filter((l) => l.lit && l.panel === p).length, 7, `panel ${p}`);
    const edge = hide === "left" ? s.visible.x0 : s.visible.x1;
    for (const l of s.lanterns) assert.ok(Math.abs(l.x - edge) >= SCENE_DEFAULTS.edgeMargin);
  });

  test(`hide=${hide}: a tower sits exactly on the visible edge and nothing else crosses it`, () => {
    const s = generateScene({ seed: 9, hide });
    const edge = hide === "left" ? s.visible.x0 : s.visible.x1;
    const tower = s.buildings.find((b) => b.kind === "tower")!;
    assert.equal(hide === "left" ? tower.x : tower.x + tower.w, edge);
    for (const b of s.buildings) {
      if (b.kind === "tower") continue;
      assert.ok(b.x + b.w <= edge || b.x >= edge, `building at ${b.x} crosses the edge`);
    }
  });

  test(`hide=${hide}: finding every visible lantern looks balanced, but the induced view points to the hidden side`, () => {
    const s = generateScene({ seed: 9, hide });
    const taps = s.lanterns
      .filter((l) => l.lit && l.x >= s.visible.x0 && l.x < s.visible.x1)
      .map((l, i) => ({ t: i * 500, x: l.x + 3, y: l.y - 2 }));
    const r = scoreScene(s, taps);
    assert.equal(r.foundVisible, r.visibleTargets);
    assert.ok(Math.abs(r.observationVisible.value) < 1e-9);
    const v = r.observationInduced!.value;
    assert.ok(hide === "left" ? v < -0.4 : v > 0.4, `induced value ${v}`);
    assert.ok(hide === "left" ? r.coc.full! > 0.2 : r.coc.full! < -0.2);
  });
}

test("taps on unlit lanterns and repeats are classified", () => {
  const s = generateScene({ seed: 9, hide: "none" });
  const lit = s.lanterns.find((l) => l.lit)!;
  const unlit = s.lanterns.find((l) => !l.lit)!;
  const r = scoreScene(s, [
    { t: 1, x: lit.x, y: lit.y },
    { t: 2, x: lit.x, y: lit.y },
    { t: 3, x: unlit.x, y: unlit.y },
    { t: 4, x: 5, y: 5 },
  ]);
  assert.deepEqual(r.taps.map((t) => t.kind), ["target", "repeat", "distractor", "empty"]);
  assert.equal(r.observationInduced, null);
});

test("bisection marks drifting right give a negative lateral index", () => {
  const lines = generateBisectionLines(6, 1);
  const right = lines.map((l) => ({ lineId: l.id, x: (l.x1 + l.x2) / 2 + 0.1 * (l.x2 - l.x1) }));
  const scored = bisectionObservation(lines, right);
  assert.ok(scored.observation.value < -9);
  const mean = scored.errors.reduce((a, b) => a + b, 0) / scored.errors.length;
  const sd = Math.sqrt(scored.errors.reduce((a, b) => a + (b - mean) ** 2, 0) / (scored.errors.length - 1));
  assert.ok(Math.abs(scored.observation.value - -mean) < 1e-12);
  assert.ok(Math.abs(scored.observation.se - sd / Math.sqrt(5)) < 1e-12);
});
