import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEMONSTRATION_SESSIONS,
  EXAMPLE_CALIBRATION_REPORT,
  GAZE_LAB_CLICK_SEQUENCE,
  GAZE_LAB_FIXTURE,
  GAZE_LAB_STREAMS,
  GAZE_LAB_TRACKING_GAPS,
  isSessionRecord,
  parseSessionRecord,
  scoreSession,
} from "../src/index.ts";

describe("demonstration records", () => {
  it("exports validated demonstration sessions for the three spatial patterns", () => {
    assert.equal(DEMONSTRATION_SESSIONS.length, 3);
    const kinds = DEMONSTRATION_SESSIONS.map((session) => {
      assert.equal(session.source, "demonstration");
      assert.equal(isSessionRecord(session), true);
      assert.equal(parseSessionRecord(session).id, session.id);
      assert.deepEqual(session.calibration, EXAMPLE_CALIBRATION_REPORT);
      return scoreSession(session).spatialPattern.kind;
    });
    assert.deepEqual(kinds, ["balanced", "left-omission", "right-omission"]);
  });

  it("exports a shared click sequence, two gaze streams with gaps, and a calibration report", () => {
    assert.ok(GAZE_LAB_CLICK_SEQUENCE.length >= 16);
    assert.equal(
      GAZE_LAB_CLICK_SEQUENCE.every((event) => event.trialId === DEMONSTRATION_SESSIONS[0]?.trials[0]?.id),
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
