import { test } from "node:test";
import assert from "node:assert/strict";
import { generateGreyscalesTrials, scoreGreyscales, chosenDarkSide } from "../src/greyscales.js";

test("half the trials put the darker-left bar on top", () => {
  const t = generateGreyscalesTrials(40, 2);
  assert.equal(t.filter((x) => x.topDarkSide === "left").length, 20);
});

test("choosing the bottom bar picks the mirror image", () => {
  assert.equal(chosenDarkSide({ id: "a", topDarkSide: "left" }, "bottom"), "right");
});

test("always picking darker-left gives bias +1, darker-right gives -1", () => {
  const t = generateGreyscalesTrials(10, 4);
  const pickLeft = t.map((x) => ({ trialId: x.id, choice: x.topDarkSide === "left" ? "top" : "bottom", rtMs: 800 })) as any;
  const pickRight = t.map((x) => ({ trialId: x.id, choice: x.topDarkSide === "left" ? "bottom" : "top", rtMs: 800 })) as any;
  assert.equal(scoreGreyscales(t, pickLeft).bias, 1);
  assert.equal(scoreGreyscales(t, pickRight).observation.value, -1);
});
