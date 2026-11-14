import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BISECTION_LATERAL_INDEX,
  BISECTION_SIGNED_ERROR_PCT,
  CLOCK_LATERALITY,
  DEFAULT_NORMS,
  GAZE_LEFT_FRACTION,
  GREYSCALES_LTR,
  GREYSCALES_OTHER,
  GREYSCALES_RTL,
  HOLLOW_RINGS_OMISSION_ASYMMETRY,
  SCENE_LATERALITY,
  STARRY_LATERALITY,
  STAR_CANCELLATION_COC,
  compareToNorm,
  greyscalesNormFor,
  scoreClock,
  scoreSession,
  generateClockTrials,
} from "../src/index.ts";
import { makeSession } from "./session-factory.ts";

describe("published norms", () => {
  it("converts Azouvi 20 cm millimetres into percent of line length", () => {
    assert.equal(BISECTION_SIGNED_ERROR_PCT.calibrated, true);
    assert.equal(BISECTION_SIGNED_ERROR_PCT.source, "literature");
    assert.ok(BISECTION_SIGNED_ERROR_PCT.citation?.doi);
    assert.equal(BISECTION_SIGNED_ERROR_PCT.sample?.n, 457);
    assert.ok(Math.abs((BISECTION_SIGNED_ERROR_PCT.mean ?? 0) - -0.475) < 1e-12);
    assert.ok(Math.abs((BISECTION_SIGNED_ERROR_PCT.sd ?? 0) - 2.075) < 1e-12);
    assert.ok(Math.abs((BISECTION_SIGNED_ERROR_PCT.cutoff ?? 0) - 3.25) < 1e-12);
    assert.equal(BISECTION_LATERAL_INDEX.mean, -(BISECTION_SIGNED_ERROR_PCT.mean ?? 0));
    assert.equal(DEFAULT_NORMS.bisection.mean, BISECTION_LATERAL_INDEX.mean);
    assert.equal(DEFAULT_NORMS.bisection.source, "literature");
  });

  it("converts Friedrich & Elias greyscales scores into the app bias units", () => {
    assert.ok(Math.abs((GREYSCALES_LTR.mean ?? 0) - 34.6 / 96) < 1e-12);
    assert.ok(Math.abs((GREYSCALES_LTR.sd ?? 0) - 37.67 / 96) < 1e-12);
    assert.ok(Math.abs((GREYSCALES_RTL.mean ?? 0) - 0.99 / 96) < 1e-12);
    assert.equal(GREYSCALES_LTR.sample?.n, 54);
    assert.equal(GREYSCALES_RTL.sample?.n, 43);
    assert.equal(greyscalesNormFor("left-to-right").mean, GREYSCALES_LTR.mean);
    assert.equal(greyscalesNormFor("right-to-left").mean, GREYSCALES_RTL.mean);
    assert.equal(greyscalesNormFor("both-or-other").source, "uncalibrated");
    assert.equal(GREYSCALES_OTHER.calibrated, false);
  });

  it("maps Azouvi bells laterality onto hollow-ring percentage points", () => {
    assert.ok(Math.abs((HOLLOW_RINGS_OMISSION_ASYMMETRY.mean ?? 0) - 0.05 * (100 / 15)) < 1e-12);
    assert.ok(Math.abs((HOLLOW_RINGS_OMISSION_ASYMMETRY.cutoff ?? 0) - 2 * (100 / 15)) < 1e-12);
    assert.equal(HOLLOW_RINGS_OMISSION_ASYMMETRY.sample?.n, 576);
    assert.equal(STAR_CANCELLATION_COC.cutoff, 0.081);
    assert.equal(STAR_CANCELLATION_COC.mean, null);
    assert.equal(STAR_CANCELLATION_COC.calibrated, true);
  });

  it("marks clock, Starry Night, scene, and gaze as uncalibrated", () => {
    for (const metric of [CLOCK_LATERALITY, STARRY_LATERALITY, SCENE_LATERALITY, GAZE_LEFT_FRACTION]) {
      assert.equal(metric.calibrated, false);
      assert.equal(metric.source, "uncalibrated");
      assert.equal(metric.mean, null);
      assert.equal(metric.sd, null);
      assert.equal(metric.cutoff, null);
    }
    assert.equal(DEFAULT_NORMS.clock.source, "uncalibrated");
    assert.equal(DEFAULT_NORMS.scene.source, "uncalibrated");
    assert.equal(DEFAULT_NORMS.detection.source, "uncalibrated");
  });
});

describe("compareToNorm", () => {
  it("flags rightward bisection beyond the published cutoff", () => {
    const inside = compareToNorm(3, BISECTION_SIGNED_ERROR_PCT);
    const outside = compareToNorm(4, BISECTION_SIGNED_ERROR_PCT);
    assert.equal(inside.status, "within");
    assert.equal(inside.beyondCutoff, false);
    assert.equal(outside.status, "outside");
    assert.match(outside.text, /Outside the healthy range/);
    assert.doesNotMatch(outside.text, /sever|diagnos/i);
  });

  it("does not invent a reading for uncalibrated metrics", () => {
    const reading = compareToNorm(0.4, CLOCK_LATERALITY);
    assert.equal(reading.status, "uncalibrated");
    assert.equal(reading.z, null);
    assert.equal(reading.beyondCutoff, false);
    assert.match(reading.text, /Uncalibrated/);
  });
});

describe("scoring uses the norms module", () => {
  it("compares hollow-ring omission laterality to the published cancellation cutoff", () => {
    const left = scoreSession(makeSession({ id: "left-gap", alias: "left", leftHits: 6, rightHits: 12 }));
    assert.equal(left.spatialPattern.kind, "left-omission");
    assert.equal(left.spatialPattern.laterality?.metricId, HOLLOW_RINGS_OMISSION_ASYMMETRY.id);
    assert.equal(left.spatialPattern.laterality?.status, "outside");
    assert.match(left.spatialPattern.description, /healthy range/);

    const balanced = scoreSession(makeSession({ id: "bal", alias: "bal", leftHits: 10, rightHits: 10 }));
    assert.equal(balanced.spatialPattern.kind, "balanced");
    assert.equal(balanced.spatialPattern.laterality?.status, "within");
  });

  it("compares line-bisection median error to the Azouvi 20 cm norm", () => {
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
  });

  it("keeps the clock check uncalibrated", () => {
    const trials = generateClockTrials(8, 3);
    const responses = trials.map((trial) => ({ trialId: trial.id, choice: trial.correctPosition, rtMs: 500 }));
    const scored = scoreClock(trials, responses);
    assert.equal(scored.healthyRange.calibrated, false);
    assert.equal(scored.healthyRange.metricId, CLOCK_LATERALITY.id);
  });
});
