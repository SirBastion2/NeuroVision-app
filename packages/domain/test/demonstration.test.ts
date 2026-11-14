import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  EXAMPLE_CALIBRATION_REPORT,
  GAZE_LAB_CLICK_SEQUENCE,
  GAZE_LAB_FIXTURE,
  GAZE_LAB_STREAMS,
  GAZE_LAB_TRACKING_GAPS,
} from "../src/index.ts";

describe("gaze-lab fixtures", () => {
  it("exports a shared click sequence, two gaze streams with gaps, and a calibration report", () => {
    assert.ok(GAZE_LAB_CLICK_SEQUENCE.length >= 16);
    assert.equal(
      GAZE_LAB_CLICK_SEQUENCE.every((event) => event.trialId === "demo-balanced-target"),
      true,
    );
    assert.equal(GAZE_LAB_STREAMS.length, 2);
    for (const stream of GAZE_LAB_STREAMS) {
      assert.ok(stream.samples.length > 0);
      assert.deepEqual(stream.gaps, [...GAZE_LAB_TRACKING_GAPS]);
      assert.equal(
        stream.samples.some((sample) =>
          GAZE_LAB_TRACKING_GAPS.some((gap) => sample.elapsed >= gap.start && sample.elapsed < gap.end),
        ),
        false,
      );
    }
    assert.notEqual(GAZE_LAB_STREAMS[0].id, GAZE_LAB_STREAMS[1].id);
    assert.equal(EXAMPLE_CALIBRATION_REPORT.pointCount, 9);
    assert.equal(GAZE_LAB_FIXTURE.clicks, GAZE_LAB_CLICK_SEQUENCE);
    assert.equal(GAZE_LAB_FIXTURE.streams, GAZE_LAB_STREAMS);
    assert.equal(GAZE_LAB_FIXTURE.calibration, EXAMPLE_CALIBRATION_REPORT);
  });
});
