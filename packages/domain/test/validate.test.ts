import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isSessionRecord, parseSessionRecord, sessionSourceLabel } from "../src/index.ts";
import { makeSession } from "./session-factory.ts";

describe("session validation", () => {
  it("accepts a complete live record and a demonstration record", () => {
    const live = makeSession({ id: "valid-live", alias: "Live", leftHits: 10, rightHits: 10 });
    const demo = makeSession({
      id: "valid-demo",
      alias: "Demo",
      source: "demonstration",
      leftHits: 8,
      rightHits: 8,
    });
    assert.equal(isSessionRecord(live), true);
    assert.equal(isSessionRecord(demo), true);
    assert.equal(parseSessionRecord(live).source, "live");
    assert.equal(sessionSourceLabel("demonstration"), "Demonstration");
  });

  it("rejects unknown sources, bad timestamps, and mismatched event trial ids", () => {
    const session = makeSession({ id: "invalid", alias: "Invalid", leftHits: 10, rightHits: 10 });
    assert.equal(isSessionRecord({ ...session, source: "simulated" }), false);
    assert.equal(isSessionRecord({ ...session, completedAt: "" }), false);
    const broken = structuredClone(session);
    broken.trials[0].events[0].trialId = "other-trial";
    assert.equal(isSessionRecord(broken), false);
    assert.throws(() => parseSessionRecord({}), /invalid session record/);
  });
});
