import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CONTRACTS_VERSION,
  PROTOCOL_ID,
  SCORER_ID,
  areSessionsComparable,
  comparabilityKey,
  configurePracticeRound,
  createPracticeLayout,
  summarizeAssessmentTrend,
} from "../src/index.ts";
import { makeSession } from "./session-factory.ts";

describe("session comparability", () => {
  it("treats same protocol, scorer, contracts version, and fixed layout family as comparable", () => {
    const a = makeSession({ id: "a", alias: "A", leftHits: 10, rightHits: 10, variant: "fixed-a" });
    const b = makeSession({ id: "b", alias: "B", leftHits: 6, rightHits: 12, variant: "fixed-b" });
    const key = comparabilityKey(a);
    assert.deepEqual(key, {
      protocol: PROTOCOL_ID,
      scorer: SCORER_ID,
      contractsVersion: CONTRACTS_VERSION,
      layoutFamily: "assessment-fixed",
    });
    assert.equal(areSessionsComparable(a, b), true);
  });

  it("rejects a different protocol, scorer, or practice layout family", () => {
    const live = makeSession({ id: "live", alias: "Live", leftHits: 10, rightHits: 10 });
    const otherProtocol = makeSession({
      id: "proto",
      alias: "Other protocol",
      leftHits: 10,
      rightHits: 10,
      protocol: "other-protocol",
    });
    const otherScorer = makeSession({
      id: "scorer",
      alias: "Other scorer",
      leftHits: 10,
      rightHits: 10,
      scorer: "other-scorer",
    });
    const practice = makeSession({
      id: "practice",
      alias: "Practice board",
      leftHits: 8,
      rightHits: 8,
      layout: createPracticeLayout("standard"),
    });
    assert.equal(areSessionsComparable(live, otherProtocol), false);
    assert.equal(areSessionsComparable(live, otherScorer), false);
    assert.equal(areSessionsComparable(live, practice), false);
    assert.equal(comparabilityKey(practice), null);
  });
});

describe("assessment trend", () => {
  it("keeps comparable live sessions and drops demonstration, practice, and unscored records", () => {
    const early = makeSession({
      id: "live-early",
      alias: "Early",
      leftHits: 10,
      rightHits: 10,
      completedAt: "2026-11-14T14:00:00.000Z",
    });
    const nestedPractice = makeSession({
      id: "nested-practice",
      alias: "Nested",
      leftHits: 6,
      rightHits: 6,
      layout: createPracticeLayout("low"),
    }).trials[0];
    if (!nestedPractice) throw new Error("expected nested practice trial");
    early.practice.push({
      trial: nestedPractice,
      config: configurePracticeRound({ cue: "none", density: "low" }).config,
    });
    const later = makeSession({
      id: "live-later",
      alias: "Later",
      leftHits: 6,
      rightHits: 12,
      completedAt: "2026-11-14T15:00:00.000Z",
    });
    const demo = makeSession({
      id: "demo",
      alias: "Demo",
      source: "demonstration",
      leftHits: 12,
      rightHits: 6,
    });
    const practice = makeSession({
      id: "practice-only",
      alias: "Practice",
      leftHits: 8,
      rightHits: 8,
      layout: createPracticeLayout("standard"),
    });
    const stopped = makeSession({
      id: "stopped",
      alias: "Stopped",
      leftHits: 10,
      rightHits: 10,
      targetEnd: "stop",
      status: "incomplete",
    });
    const otherProtocol = makeSession({
      id: "other-protocol",
      alias: "Other",
      leftHits: 10,
      rightHits: 10,
      protocol: "other-protocol",
      completedAt: "2026-11-14T16:00:00.000Z",
    });

    const trend = summarizeAssessmentTrend([later, demo, practice, stopped, otherProtocol, early]);
    assert.deepEqual(
      trend.points.map((point) => point.sessionId),
      ["live-early", "live-later"],
    );
    assert.equal(trend.points[0]?.hitRate, 20 / 24);
    assert.equal(trend.points[1]?.patternKind, "left-omission");
    assert.equal(trend.key?.layoutFamily, "assessment-fixed");
    assert.equal(trend.key?.contractsVersion, CONTRACTS_VERSION);
    assert.deepEqual(
      new Set(trend.excluded.map((item) => `${item.sessionId}:${item.reason}`)),
      new Set([
        "demo:demonstration",
        "practice-only:practice",
        "stopped:unscored",
        "other-protocol:incomparable",
      ]),
    );
  });
});
