import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ASSUMED_NORM_NOTICE,
  BISECTION_LATERAL_INDEX,
  BISECTION_SIGNED_ERROR_PCT,
  CLOCK_LATERALITY,
  DEFAULT_NORMS,
  GAZE_LEFT_FRACTION,
  GREYSCALES_LTR,
  GREYSCALES_OTHER,
  GREYSCALES_RTL,
  HOLLOW_RINGS_LATERAL_INDEX,
  SCENE_LATERALITY,
  STARRY_LATERALITY,
  STAR_CANCELLATION_COC,
  compareToNorm,
  greyscalesNormFor,
  scoreClock,
  scoreSession,
  generateClockTrials,
  MODEL_TEST_IDS,
} from "../src/index.ts";
import { makeSession } from "./session-factory.ts";

describe("Table 2 placeholder norms", () => {
  it("sets Starry Night, Hollow Rings, and line bisection to assumed Table 2 values", () => {
    assert.equal(STARRY_LATERALITY.source, "assumed");
    assert.equal(STARRY_LATERALITY.mean, 0);
    assert.equal(STARRY_LATERALITY.sd, 0.15);
    assert.equal(HOLLOW_RINGS_LATERAL_INDEX.source, "assumed");
    assert.equal(HOLLOW_RINGS_LATERAL_INDEX.mean, 0);
    assert.equal(HOLLOW_RINGS_LATERAL_INDEX.sd, 0.06);
    assert.equal(BISECTION_LATERAL_INDEX.source, "assumed");
    assert.equal(BISECTION_LATERAL_INDEX.mean, 1);
    assert.equal(BISECTION_LATERAL_INDEX.sd, 3);
    assert.equal(BISECTION_SIGNED_ERROR_PCT.mean, -1);
    assert.equal(BISECTION_SIGNED_ERROR_PCT.sd, 3);
    assert.equal(DEFAULT_NORMS.detection.mean, 0);
    assert.equal(DEFAULT_NORMS.detection.healthySd, 0.15);
    assert.equal(DEFAULT_NORMS.cancellation.mean, 0);
    assert.equal(DEFAULT_NORMS.cancellation.healthySd, 0.06);
    assert.equal(DEFAULT_NORMS.bisection.mean, 1);
    assert.equal(DEFAULT_NORMS.bisection.healthySd, 3);
    assert.equal(DEFAULT_NORMS.detection.sensitivity, 1);
    assert.equal(DEFAULT_NORMS.cancellation.sensitivity, 1);
    assert.equal(DEFAULT_NORMS.bisection.sensitivity, 1);
    assert.deepEqual([...MODEL_TEST_IDS].sort(), ["bisection", "cancellation", "detection"].sort());
  });

  it("keeps clock, greyscales, scene, gaze, and screening CoC out of the model", () => {
    for (const metric of [
      CLOCK_LATERALITY,
      STAR_CANCELLATION_COC,
      SCENE_LATERALITY,
      GAZE_LEFT_FRACTION,
      GREYSCALES_LTR,
      GREYSCALES_RTL,
      GREYSCALES_OTHER,
    ]) {
      assert.equal(metric.calibrated, false);
      assert.equal(metric.source, "uncalibrated");
      assert.equal(metric.mean, null);
      assert.equal(metric.sd, null);
      assert.equal(metric.cutoff, null);
    }
    assert.equal(DEFAULT_NORMS.clock.source, "uncalibrated");
    assert.equal(DEFAULT_NORMS.scene.source, "uncalibrated");
    assert.equal(DEFAULT_NORMS.greyscales.source, "uncalibrated");
    assert.equal(greyscalesNormFor("left-to-right").source, "uncalibrated");
  });
});

describe("compareToNorm", () => {
  it("flags a signed bisection error more than 2 SD from the Table 2 placeholder", () => {
    const inside = compareToNorm(3, BISECTION_SIGNED_ERROR_PCT);
    const outside = compareToNorm(6, BISECTION_SIGNED_ERROR_PCT);
    assert.equal(inside.status, "within");
    assert.equal(inside.beyondCutoff, false);
    assert.equal(outside.status, "outside");
    assert.match(outside.text, /Outside the healthy range/);
    assert.match(outside.text, new RegExp(ASSUMED_NORM_NOTICE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(outside.text, /sever|diagnos|prototype/i);
  });

  it("does not invent a reading for uncalibrated metrics", () => {
    const reading = compareToNorm(0.4, CLOCK_LATERALITY);
    assert.equal(reading.status, "uncalibrated");
    assert.equal(reading.z, null);
    assert.equal(reading.beyondCutoff, false);
    assert.match(reading.text, /Uncalibrated/);
  });
});

describe("scoring uses the Table 2 placeholders", () => {
  it("compares Hollow Rings laterality with Eq. (1) right−left omission rates", () => {
    const left = scoreSession(makeSession({ id: "left-gap", alias: "left", leftHits: 6, rightHits: 12 }));
    assert.equal(left.targetSelection?.lateralIndex, 0 / 12 - 6 / 12);
    assert.equal(left.spatialPattern.kind, "left-omission");
    assert.equal(left.spatialPattern.laterality?.metricId, HOLLOW_RINGS_LATERAL_INDEX.id);
    assert.equal(left.spatialPattern.laterality?.status, "outside");
    assert.match(left.spatialPattern.description, /healthy range/);
    assert.equal(left.targetSelection?.observation?.test, "cancellation");
    assert.equal(left.targetSelection?.observation?.value, left.targetSelection?.lateralIndex);

    const balanced = scoreSession(makeSession({ id: "bal", alias: "bal", leftHits: 10, rightHits: 10 }));
    assert.equal(balanced.spatialPattern.kind, "balanced");
    assert.equal(balanced.spatialPattern.laterality?.status, "within");
    assert.ok(Math.abs(balanced.targetSelection?.lateralIndex ?? 1) < 1e-12);
  });

  it("compares line-bisection median error to the Table 2 signed-error placeholder", () => {
    const result = scoreSession(
      makeSession({
        id: "bisect",
        alias: "bisect",
        leftHits: 12,
        rightHits: 12,
        bisectionOffsets: [-0.02, 0.05, 0.06, 0, 0.03],
      }),
    );
    assert.equal(result.lineBisection.signedMedian, 3);
    assert.equal(result.lineBisection.healthyRange?.metricId, BISECTION_SIGNED_ERROR_PCT.id);
    assert.equal(result.lineBisection.healthyRange?.status, "within");
    assert.ok(result.lineBisection.healthyRange?.calibrated);
    assert.match(
      result.lineBisection.healthyRange?.text ?? "",
      new RegExp(ASSUMED_NORM_NOTICE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  });

  it("keeps the clock check uncalibrated", () => {
    const trials = generateClockTrials(8, 3);
    const responses = trials.map((trial) => ({ trialId: trial.id, choice: trial.correctPosition, rtMs: 500 }));
    const scored = scoreClock(trials, responses);
    assert.equal(scored.healthyRange.calibrated, false);
    assert.equal(scored.healthyRange.metricId, CLOCK_LATERALITY.id);
  });
});
