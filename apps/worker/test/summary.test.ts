import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GAZE_STUB_REASON, buildDerivedSummary } from "@neurovision/api/worker";
import { sampleSession } from "../../api/test/fixture-session.js";

describe("analysis stub", () => {
  it("scores clicks with the domain package and leaves gaze unimplemented", () => {
    const live = buildDerivedSummary({
      record: sampleSession("sum-live"),
      completion: "complete",
      inputHash: "abc",
      sessionRevision: 1,
    });
    assert.equal(live.stub, true);
    assert.match(live.stubReason, /Agent 3/);
    assert.equal(live.stubReason, GAZE_STUB_REASON);
    assert.equal(live.gazeAnalysis.metrics, null);
    assert.equal(live.eligibility.gaze, false);
    assert.equal(live.eligibility.click, true);
    assert.equal(live.eligibility.reasons.includes("gaze_analysis_stub"), true);
    assert.ok(live.scoring.targetSelection);

    const simulated = buildDerivedSummary({
      record: sampleSession("sum-demo", "demonstration"),
      completion: "complete",
      inputHash: "abc",
      sessionRevision: 1,
    });
    assert.equal(simulated.eligibility.click, false);
    assert.equal(simulated.eligibility.reasons.includes("source_not_live"), true);
  });
});
