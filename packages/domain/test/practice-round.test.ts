import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  configurePracticeRound,
  createPracticeLayout,
  reflectPracticeRound,
  scoreSession,
  suggestPractice,
} from "../src/index.ts";
import { makeSession, makeTargetTrial } from "./session-factory.ts";

describe("practice round configuration", () => {
  it("builds a layout for the chosen cue, density, and optional row marker", () => {
    const suggested = suggestPractice({ valid: true, hitRate: 0.75, omissionAsymmetry: 40 });
    const setup = configurePracticeRound(
      { cue: "left", density: "low", scanGuide: true },
      suggested,
    );
    const expectedLayout = createPracticeLayout("low");
    assert.equal(setup.config.cue, "left");
    assert.equal(setup.config.density, "low");
    assert.equal(setup.config.scanGuide, true);
    assert.equal(setup.config.level, 2);
    assert.match(setup.config.override ?? "", /differs from the scored suggestion/);
    assert.match(setup.config.explanation, /self-paced row marker/);
    assert.equal(setup.layout.id, expectedLayout.id);
    assert.equal(setup.layout.stimuli.length, expectedLayout.stimuli.length);
  });

  it("keeps the scored suggestion when the operator accepts it", () => {
    const suggested = suggestPractice({ valid: true, hitRate: 0.8, omissionAsymmetry: 0 });
    const setup = configurePracticeRound(
      { cue: suggested.cue, density: suggested.density, scanGuide: suggested.scanGuide },
      suggested,
    );
    assert.equal(setup.config.explanation, suggested.explanation);
    assert.equal(setup.config.override, null);
    assert.equal(setup.config.level, 0);
    assert.equal(setup.layout.id, "practice-standard-v1");
  });
});

describe("practice round reflection", () => {
  it("summarizes hits, omissions, order, and change versus the assessment", () => {
    const assessmentSession = makeSession({
      id: "assess",
      alias: "Assess",
      leftHits: 6,
      rightHits: 12,
    });
    const assessment = scoreSession(assessmentSession).targetSelection;
    assert.ok(assessment);

    const practiceLayout = createPracticeLayout("standard");
    const trial = makeTargetTrial({
      sessionId: "practice-round",
      leftHits: 8,
      rightHits: 8,
      layout: practiceLayout,
    });
    const reflection = reflectPracticeRound(trial, assessment);

    assert.equal(reflection.hits.left, 8);
    assert.equal(reflection.hits.right, 8);
    assert.equal(reflection.omissions.left, 0);
    assert.equal(reflection.omissions.right, 0);
    assert.equal(reflection.orderedHits.length, 16);
    assert.equal(reflection.orderedHits[0]?.order, 1);
    assert.ok(reflection.versusAssessment);
    assert.equal(reflection.versusAssessment.hits.left, 2);
    assert.equal(reflection.versusAssessment.hits.right, -4);
    assert.equal(reflection.versusAssessment.omissions.left, -6);
    assert.equal(reflection.versusAssessment.omissions.right, 0);
    assert.equal(reflection.versusAssessment.assessmentPattern, "left-omission");
    assert.equal(reflection.versusAssessment.practicePattern, "balanced");
    assert.equal(reflection.versusAssessment.hitRateDelta, reflection.hitRate - assessment.hitRate);
  });
});
