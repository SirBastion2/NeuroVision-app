import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  calibrationReportFromErrors,
  labTraceToDomainStream,
  simulatedTrace,
} from "../src/index.ts";

describe("domain bridge", () => {
  it("maps lab traces into domain GazeStream shapes", () => {
    const stream = labTraceToDomainStream(
      "lab-a",
      "SIMULATED LAB · left-biased",
      simulatedTrace(false, 2000),
    );
    assert.equal(stream.id, "lab-a");
    assert.ok(stream.samples.length > 0);
    assert.equal(typeof stream.samples[0]!.elapsed, "number");
    assert.ok(stream.gaps.length >= 0);
  });

  it("builds CalibrationQualityReport from validation errors", () => {
    const report = calibrationReportFromErrors([10, 12, 8]);
    assert.equal(report.pointCount, 3);
    assert.ok(report.averageErrorPx > 0);
    assert.ok(report.gridAgreement > 0);
  });
});
