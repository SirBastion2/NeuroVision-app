import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  beginTraining,
  beginValidation,
  completeValidation,
  createCalibrationState,
  createGazeProvider,
  initializeWithCameraFallback,
  mapProviderTiming,
  MonotonicTrialClock,
  partitionCalibrationPoints,
  provenanceFor,
  skipToClickOnly,
  type CalibrationTarget,
} from "../src/index.ts";

const POINTS: CalibrationTarget[] = [
  { id: "t1", x: 100, y: 100, role: "train" },
  { id: "t2", x: 860, y: 100, role: "train" },
  { id: "t3", x: 480, y: 440, role: "train" },
  { id: "v1", x: 200, y: 270, role: "validate" },
  { id: "v2", x: 760, y: 270, role: "validate" },
  { id: "v3", x: 480, y: 100, role: "validate" },
];

describe("provider fallback and labeling", () => {
  it("marks simulated lab and mock as surrogates", () => {
    assert.equal(provenanceFor("simulated-lab").isSurrogate, true);
    assert.ok(provenanceFor("mock").badge.includes("MOCK"));
    assert.ok(provenanceFor("simulated-lab").badge.includes("SIMULATED LAB"));
    assert.equal(provenanceFor("webcam").isSurrogate, false);
  });

  it("release guard refuses mock claimed as observed", () => {
    assert.throws(
      () =>
        createGazeProvider({
          mode: "mock",
          releaseGuard: true,
          claimedSource: "observed",
        }),
      /Refuse silent surrogate/,
    );
  });

  it("camera initialize failure falls back to click-only", async () => {
    const result = await initializeWithCameraFallback({ mode: "webcam" });
    assert.equal(result.fellBackToClickOnly, true);
    assert.equal(result.provider.provenance.streamKind, "click-only");
    const samples: unknown[] = [];
    result.provider.start(new MonotonicTrialClock(() => 0), (s) =>
      samples.push(s),
    );
    assert.equal(samples.length, 0);
    await result.provider.stop();
  });

  it("does not fabricate capture precision from assumed delay", () => {
    const clock = new MonotonicTrialClock(() => 50);
    assert.equal(
      mapProviderTiming({ clock, callbackMs: 50 }).timestampBasis,
      "estimated",
    );
    assert.equal(
      mapProviderTiming({ clock, frameCaptureMs: 10 }).timestampBasis,
      "frame",
    );
  });
});

describe("calibration plumbing", () => {
  it("rejects validation points that also appear as training", () => {
    assert.throws(
      () =>
        partitionCalibrationPoints([
          { id: "same", x: 1, y: 1, role: "train" },
          { id: "same", x: 1, y: 1, role: "validate" },
        ]),
      /must not also be a training point/,
    );
  });

  it("completes with region resolution on good estimates", () => {
    let state = createCalibrationState();
    state = beginTraining(state, POINTS);
    state = beginValidation(state);
    state = completeValidation(
      state,
      [
        { pointId: "v1", estimatedX: 205, estimatedY: 272 },
        { pointId: "v2", estimatedX: 755, estimatedY: 268 },
        { pointId: "v3", estimatedX: 482, estimatedY: 105 },
      ],
      { id: "cal-1", providerVersion: "mock@0.1.0" },
    );
    assert.equal(state.phase, "complete");
    assert.equal(state.result?.resolution, "region");
  });

  it("fails open to click-only when validation is poor", () => {
    let state = createCalibrationState();
    state = beginTraining(state, POINTS);
    state = beginValidation(state);
    state = completeValidation(
      state,
      [
        { pointId: "v1", estimatedX: 900, estimatedY: 500 },
        { pointId: "v2", estimatedX: 10, estimatedY: 10 },
        { pointId: "v3", estimatedX: 0, estimatedY: 0 },
      ],
      { id: "cal-bad", providerVersion: "mock@0.1.0" },
    );
    assert.equal(state.phase, "failed");
    assert.equal(state.clickOnly, true);
  });

  it("skipToClickOnly preserves usable click path", () => {
    const state = skipToClickOnly(
      createCalibrationState(),
      "permission_denied",
    );
    assert.equal(state.phase, "skipped");
    assert.equal(state.clickOnly, true);
  });
});
