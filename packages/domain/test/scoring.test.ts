import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BOARD_WIDTH,
  classifyResponse,
  createPracticeLayout,
  createTargetSelectionLayout,
  fadePracticeCue,
  median,
  regionOfStimulus,
  scoreLineBisection,
  scoreSession,
  scoreTargetSelection,
  suggestPractice,
} from "../src/index.ts";
import { makeLineTrial, makeSession, makeTargetTrial } from "./session-factory.ts";

describe("target-selection scoring", () => {
  it("counts first hits and ignores pointer, distractor, and repeat events", () => {
    const trial = makeTargetTrial({
      sessionId: "score-hits",
      leftHits: 3,
      rightHits: 2,
      distractorHits: 4,
      repeatHits: 2,
    });
    trial.events.unshift(
      classifyResponse({
        sessionId: "score-hits",
        trialId: trial.id,
        task: trial.task,
        layout: trial.layout,
        existing: [],
        point: { x: 10, y: 10 },
        elapsed: 10,
        pointer: true,
      }),
    );

    const score = scoreTargetSelection(trial);
    assert.equal(score.hits, 5);
    assert.equal(score.available, 24);
    assert.equal(score.left.hits, 3);
    assert.equal(score.right.hits, 2);
    assert.equal(score.left.omissions, 9);
    assert.equal(score.right.omissions, 10);
    assert.equal(score.distractors, 4);
    assert.equal(score.repeats, 2);
    assert.equal(score.orderedHits.length, 5);
    assert.equal(score.orderedHits[0]?.order, 1);
    assert.ok(score.valid);
  });

  it("orders hits by elapsed time, then sequence", () => {
    const trial = makeTargetTrial({ sessionId: "order", leftHits: 1, rightHits: 1 });
    trial.events[0].elapsed = 1000;
    trial.events[0].seq = 2;
    trial.events[1].elapsed = 1000;
    trial.events[1].seq = 1;

    const score = scoreTargetSelection(trial);
    assert.equal(score.orderedHits[0]?.seq, 1);
    assert.equal(score.orderedHits[1]?.seq, 2);
    assert.equal(score.orderedHits[0]?.stimulusId, trial.events[1].stimulusId);
  });

  it("breaks omissions down by side and vertical region", () => {
    const layout = createTargetSelectionLayout("fixed-a");
    const leftTop = layout.stimuli.find(
      (stimulus) => stimulus.kind === "target" && regionOfStimulus(stimulus) === "left-top",
    );
    assert.ok(leftTop);
    const trial = makeTargetTrial({ sessionId: "regions", leftHits: 0, rightHits: 0 });
    trial.events = [
      classifyResponse({
        sessionId: "regions",
        trialId: trial.id,
        task: trial.task,
        layout,
        existing: [],
        point: { x: leftTop.x, y: leftTop.y },
        elapsed: 400,
      }),
    ];

    const score = scoreTargetSelection(trial);
    assert.equal(score.regions["left-top"].hits, 1);
    assert.ok((score.regions["left-top"].available ?? 0) >= 1);
    assert.equal(score.regions["left-top"].omissions, score.regions["left-top"].available - 1);
    assert.equal(score.regions["right-bottom"].hits, 0);
    assert.equal(
      score.regions["left-top"].omissions +
        score.regions["left-middle"].omissions +
        score.regions["left-bottom"].omissions,
      score.left.omissions,
    );
  });

  it("marks incomplete ends as not valid for scoring summaries", () => {
    const trial = makeTargetTrial({ sessionId: "stop", leftHits: 12, rightHits: 12, end: "stop" });
    const score = scoreTargetSelection(trial);
    assert.equal(score.valid, false);
    assert.equal(score.hits, 24);
  });
});

describe("line-bisection scoring", () => {
  it("reports percent error with right of center as positive", () => {
    const trial = makeLineTrial("line", 0, 0.1);
    const score = scoreLineBisection(trial);
    assert.equal(score.error, 10);
    assert.equal(score.valid, true);
    assert.equal(score.outOfBand, 0);
  });

  it("ignores marks off the segment and skipped trials", () => {
    const skipped = makeLineTrial("skip", 1, 0.2, "skip");
    skipped.events = [];
    assert.equal(scoreLineBisection(skipped).error, null);

    const trial = makeLineTrial("oob", 2, null);
    trial.events.push(
      classifyResponse({
        sessionId: "oob",
        trialId: trial.id,
        task: trial.task,
        layout: trial.layout,
        line: trial.line,
        existing: [],
        point: { x: 20, y: trial.line?.y ?? 0 },
        elapsed: 400,
      }),
    );
    const score = scoreLineBisection(trial);
    assert.equal(score.error, null);
    assert.equal(score.outOfBand, 1);
  });
});

describe("practice suggestion", () => {
  it("cues the omitted side when the gap is at least 25 points", () => {
    const left = scoreSession(makeSession({ id: "left", alias: "left", leftHits: 6, rightHits: 12 }));
    assert.equal(left.practice.cue, "left");
    assert.equal(left.practice.density, "standard");
    assert.equal(left.practice.level, 2);

    const right = scoreSession(makeSession({ id: "right", alias: "right", leftHits: 12, rightHits: 6 }));
    assert.equal(right.practice.cue, "right");
  });

  it("lowers density before applying a side cue when few targets are selected", () => {
    const score = scoreSession(makeSession({ id: "sparse", alias: "sparse", leftHits: 2, rightHits: 9 }));
    assert.ok(score.targetSelection && score.targetSelection.hitRate < 0.5);
    assert.equal(score.practice.density, "low");
    assert.equal(score.practice.cue, "none");
  });

  it("keeps unguided standard practice when the side gap is small", () => {
    const suggestion = suggestPractice({ valid: true, hitRate: 0.8, omissionAsymmetry: 10 });
    assert.equal(suggestion.cue, "none");
    assert.equal(suggestion.density, "standard");
    assert.equal(suggestion.level, 0);
  });

  it("fades the cue after two strong rounds at the same configuration", () => {
    const current = suggestPractice({ valid: true, hitRate: 0.75, omissionAsymmetry: 40 });
    const strong = { valid: true, hitRate: 0.9, omissionAsymmetry: 4 };
    const faded = fadePracticeCue(
      [
        { score: strong, config: current },
        { score: strong, config: current },
      ],
      current,
    );
    assert.equal(faded.level, 1);
    assert.equal(faded.cue, "left");
  });
});

describe("helpers", () => {
  it("computes a median for odd and even lists", () => {
    assert.equal(median([3, 1, 2]), 2);
    assert.equal(median([4, 1, 2, 3]), 2.5);
    assert.equal(median([]), null);
  });

  it("builds mirrored assessment and lower-density practice layouts", () => {
    const assessment = createTargetSelectionLayout("fixed-a");
    assert.equal(assessment.stimuli.length, 48);
    assert.equal(assessment.stimuli.filter((item) => item.kind === "target").length, 24);
    const left = assessment.stimuli.find((item) => item.id === "left-t1");
    const right = assessment.stimuli.find((item) => item.id === "right-t1");
    assert.ok(left && right);
    assert.equal(left.x + right.x, BOARD_WIDTH);
    assert.equal(left.y, right.y);

    const practice = createPracticeLayout("low");
    assert.equal(practice.stimuli.filter((item) => item.kind === "target" && item.side === "left").length, 6);
    assert.equal(practice.stimuli.filter((item) => item.kind === "distractor" && item.side === "left").length, 3);
  });
});
