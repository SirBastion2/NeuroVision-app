import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BOARD_WIDTH,
  DEMO_LINE_BISECTION_LINES,
  DEMO_LINE_BISECTION_TRIAL_COUNT,
  LINE_BISECTION_LINES,
  LINE_BISECTION_TRIAL_COUNT,
  createLineBisectionLayout,
  createTargetSelectionLayout,
  lineBisectionTrialCount,
  lineLength,
  mirrorX,
} from "../src/index.ts";

describe("demo hollow rings", () => {
  it("keeps the 48-item board and leaves only two mirrored hollow rings per side", () => {
    const full = createTargetSelectionLayout("fixed-a");
    const demo = createTargetSelectionLayout("fixed-a", "standard", { demo: true });

    assert.equal(full.stimuli.length, 48);
    assert.equal(full.stimuli.filter((item) => item.kind === "target").length, 24);
    assert.equal(demo.stimuli.length, 48);
    assert.deepEqual(
      demo.stimuli.map(({ id, x, y, side }) => ({ id, x, y, side })),
      full.stimuli.map(({ id, x, y, side }) => ({ id, x, y, side })),
    );

    const targets = demo.stimuli.filter((item) => item.kind === "target");
    const left = targets.filter((item) => item.side === "left");
    const right = targets.filter((item) => item.side === "right");
    assert.equal(targets.length, 4);
    assert.equal(left.length, 2);
    assert.equal(right.length, 2);
    assert.equal(demo.stimuli.filter((item) => item.kind === "distractor").length, 44);

    for (const item of left) {
      const pair = right.find((other) => other.y === item.y && other.x === mirrorX(item.x));
      assert.ok(pair);
      assert.equal(item.x + pair.x, BOARD_WIDTH);
    }
  });
});

describe("demo line bisection", () => {
  it("uses two existing lengths, one short and one long, with those lines' offsets", () => {
    assert.equal(LINE_BISECTION_TRIAL_COUNT, 5);
    assert.equal(lineBisectionTrialCount(false), 5);
    assert.equal(DEMO_LINE_BISECTION_TRIAL_COUNT, 2);
    assert.equal(lineBisectionTrialCount(true), 2);
    assert.deepEqual(DEMO_LINE_BISECTION_LINES, [LINE_BISECTION_LINES[1], LINE_BISECTION_LINES[2]]);
    assert.deepEqual(
      DEMO_LINE_BISECTION_LINES.map(lineLength),
      [400, 700],
    );

    const first = createLineBisectionLayout(0, true);
    const second = createLineBisectionLayout(1, true);
    assert.deepEqual(first.line, LINE_BISECTION_LINES[1]);
    assert.deepEqual(second.line, LINE_BISECTION_LINES[2]);
    assert.throws(() => createLineBisectionLayout(2, true), /out of range/);
    assert.deepEqual(createLineBisectionLayout(0).line, LINE_BISECTION_LINES[0]);
  });
});
