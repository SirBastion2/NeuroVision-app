import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { CONTRACTS_VERSION, isSessionRecord, scoreSession } from "../src/index.ts";
import { makeSession } from "./session-factory.ts";

interface GoldenCase {
  id: string;
  alias: string;
  source: "live" | "demonstration";
  status: "complete" | "incomplete";
  leftHits: number;
  rightHits: number;
  distractorHits: number;
  repeatHits: number;
  targetEnd: "done" | "timeout" | "stop" | "resize" | "hidden" | "skip";
  bisectionOffsets: Array<number | null>;
  expected: {
    hits: number;
    available: number;
    omissionsLeft: number;
    omissionsRight: number;
    omissionRateLeft: number;
    omissionRateRight: number;
    omissionAsymmetry: number;
    hitRate: number;
    distractors: number;
    repeats: number;
    orderedHitCount: number;
    practiceCue: "left" | "right" | "none";
    practiceDensity: "standard" | "low";
    practiceLevel: 0 | 1 | 2;
    patternKind: "balanced" | "left-omission" | "right-omission" | "low-selection" | "insufficient";
    bisectionSignedMedian: number | null;
    bisectionAbsoluteMedian: number | null;
    bisectionValidCount: number;
  };
}

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "golden-sessions.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as {
  contractsVersion: string;
  cases: GoldenCase[];
};

describe("golden sessions", () => {
  it("pins CONTRACTS_VERSION to the fixture file", () => {
    assert.equal(CONTRACTS_VERSION, "1.0.0");
    assert.equal(fixture.contractsVersion, CONTRACTS_VERSION);
    assert.ok(fixture.cases.length >= 5);
  });

  for (const golden of fixture.cases) {
    it(`scores ${golden.id}`, () => {
      const session = makeSession({
        id: golden.id,
        alias: golden.alias,
        source: golden.source,
        status: golden.status,
        leftHits: golden.leftHits,
        rightHits: golden.rightHits,
        distractorHits: golden.distractorHits,
        repeatHits: golden.repeatHits,
        targetEnd: golden.targetEnd,
        bisectionOffsets: golden.bisectionOffsets,
      });

      assert.equal(isSessionRecord(session), true);
      const result = scoreSession(session);
      const target = result.targetSelection;
      assert.ok(target);
      assert.equal(target.hits, golden.expected.hits);
      assert.equal(target.available, golden.expected.available);
      assert.equal(target.left.omissions, golden.expected.omissionsLeft);
      assert.equal(target.right.omissions, golden.expected.omissionsRight);
      assert.equal(target.left.omissionRate, golden.expected.omissionRateLeft);
      assert.equal(target.right.omissionRate, golden.expected.omissionRateRight);
      assert.equal(target.omissionAsymmetry, golden.expected.omissionAsymmetry);
      assert.equal(target.hitRate, golden.expected.hitRate);
      assert.equal(target.distractors, golden.expected.distractors);
      assert.equal(target.repeats, golden.expected.repeats);
      assert.equal(result.responseOrder.length, golden.expected.orderedHitCount);
      assert.equal(result.practice.cue, golden.expected.practiceCue);
      assert.equal(result.practice.density, golden.expected.practiceDensity);
      assert.equal(result.practice.level, golden.expected.practiceLevel);
      assert.equal(result.spatialPattern.kind, golden.expected.patternKind);
      assert.equal(result.lineBisection.validCount, golden.expected.bisectionValidCount);
      assert.equal(result.lineBisection.signedMedian, golden.expected.bisectionSignedMedian);
      assert.equal(result.lineBisection.absoluteMedian, golden.expected.bisectionAbsoluteMedian);
    });
  }
});
