import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  configurePracticeRound,
  isTransferPracticeRound,
  mapRequestedMode,
  parseRequestedMode,
  parseSessionRecord,
  practiceRoundForRequestedMode,
} from "../src/index.ts";
import { makeSession, makeTargetTrial } from "./session-factory.ts";

describe("requested mode mapping", () => {
  it("keeps practice on SessionRecord.practice and maps transfer onto a flagged practice round", () => {
    assert.equal(parseRequestedMode("assessment"), "assessment");
    assert.deepEqual(mapRequestedMode("assessment"), {
      requested: "assessment",
      usesAssessmentTrials: true,
      usesPracticeRecord: false,
      transfer: false,
    });
    assert.deepEqual(mapRequestedMode("practice"), {
      requested: "practice",
      usesAssessmentTrials: false,
      usesPracticeRecord: true,
      transfer: false,
    });
    assert.deepEqual(mapRequestedMode("transfer"), {
      requested: "transfer",
      usesAssessmentTrials: false,
      usesPracticeRecord: true,
      transfer: true,
    });

    const session = makeSession({ id: "mode-session", alias: "Mode", leftHits: 10, rightHits: 10 });
    const trial = makeTargetTrial({ sessionId: "mode-practice", leftHits: 8, rightHits: 8 });
    const config = configurePracticeRound({ cue: "none", density: "standard" }).config;
    const practice = practiceRoundForRequestedMode("practice", trial, config);
    const transfer = practiceRoundForRequestedMode("transfer", trial, config);

    assert.equal(isTransferPracticeRound(practice), false);
    assert.equal(practice.transfer, false);
    assert.equal(isTransferPracticeRound(transfer), true);
    assert.equal(transfer.transfer, true);

    const withPractice = parseSessionRecord({ ...session, practice: [practice] });
    const withTransfer = parseSessionRecord({ ...session, practice: [transfer] });
    assert.equal(withPractice.practice[0]?.transfer, false);
    assert.equal(withTransfer.practice[0]?.transfer, true);
    assert.equal(withTransfer.trials.length > 0, true);
    assert.throws(
      () => practiceRoundForRequestedMode("assessment", trial, config),
      /Assessment is recorded on SessionRecord trials/,
    );
  });
});
