import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GAZE_ANALYSIS_VERSION } from "@neurovision/gaze";
import { ANALYSIS_VERSION, buildDerivedSummary } from "@neurovision/api/worker";
import { sampleSession } from "../../api/test/fixture-session.js";

function traceBytes(input: {
  trialId: string;
  durationMs: number;
  stepMs: number;
  validationErrorPx: number[];
  streamKind?: string;
}): Uint8Array {
  const samples = [];
  for (let elapsed = 0; elapsed < input.durationMs; elapsed += input.stepMs) {
    samples.push({ elapsed, x: 200, y: 270 });
  }
  return new TextEncoder().encode(
    JSON.stringify({
      version: 1,
      trialId: input.trialId,
      streamKind: input.streamKind ?? "webcam",
      samples,
      validationErrorPx: input.validationErrorPx,
    }),
  );
}

describe("gaze analysis", () => {
  it("fills gaze metrics for a covered webcam trace", () => {
    const record = sampleSession("gaze-live");
    const summary = buildDerivedSummary({
      record,
      completion: "complete",
      inputHash: "abc",
      sessionRevision: 1,
      traces: [
        traceBytes({
          trialId: record.trials[0].id,
          durationMs: record.trials[0].duration,
          stepMs: 100,
          validationErrorPx: [10, 12, 8],
        }),
      ],
    });
    assert.equal(summary.stub, false);
    assert.equal(summary.analysisVersion, ANALYSIS_VERSION);
    assert.equal(summary.analysisVersion.includes("gaze-stub-0"), false);
    assert.equal(summary.gazeAnalysis.version, GAZE_ANALYSIS_VERSION);
    assert.equal(summary.eligibility.click, true);
    assert.equal(summary.eligibility.gaze, true);
    const trial = summary.gazeAnalysis.trials[0];
    assert.ok(trial);
    assert.equal("ineligible" in trial, false);
    if ("ineligible" in trial) return;
    assert.equal(typeof trial.metrics.coverageRatio, "number");
    assert.ok((trial.metrics.coverageRatio ?? 0) >= 0.35);
    assert.ok((trial.metrics.validObservedMs ?? 0) > 0);
    assert.equal(trial.eligibility.gaze, true);
    assert.ok(summary.scoring.targetSelection);
  });

  it("marks a poor-quality trace ineligible without throwing", () => {
    const record = sampleSession("gaze-poor");
    const summary = buildDerivedSummary({
      record,
      completion: "complete",
      inputHash: "abc",
      sessionRevision: 1,
      traces: [
        traceBytes({
          trialId: record.trials[0].id,
          durationMs: record.trials[0].duration,
          stepMs: 100,
          validationErrorPx: [200, 220, 240],
        }),
        new Uint8Array([0xff, 0xfe, 0x00]),
      ],
    });
    assert.equal(summary.eligibility.click, true);
    assert.equal(summary.eligibility.gaze, false);
    const poor = summary.gazeAnalysis.trials[0];
    assert.ok(poor);
    assert.equal(poor.eligibility.gaze, false);
    assert.equal(poor.eligibility.reasons.includes("gaze_resolution_none"), true);
    assert.equal("ineligible" in poor, false);
    if (!("ineligible" in poor)) {
      assert.equal(typeof poor.metrics.coverageRatio, "number");
    }
    const broken = summary.gazeAnalysis.trials[1];
    assert.ok(broken);
    assert.equal("ineligible" in broken && broken.ineligible, true);
    assert.equal(broken.metrics, null);
    assert.equal(broken.eligibility.reasons.includes("trace_unreadable"), true);
  });

  it("keeps click eligibility independent of a missing trace", () => {
    const summary = buildDerivedSummary({
      record: sampleSession("gaze-none"),
      completion: "complete",
      inputHash: "abc",
      sessionRevision: 1,
    });
    assert.equal(summary.eligibility.click, true);
    assert.equal(summary.eligibility.gaze, false);
    assert.equal(summary.eligibility.reasons.includes("no_gaze_trace"), true);
  });
});
