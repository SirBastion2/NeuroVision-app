import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BOARD_HALF_REGIONS,
  DEFAULT_QUALITY_POLICY,
  analyzeSimulatedLabSlice,
  detectGaps,
  evaluateQualityGates,
  gazeSummary,
  integrateGazeRegions,
  simulatedTrace,
  summarizeGaze,
  withQualityOverrides,
  type GazeSample,
} from "../src/index.ts";

const TRIAL_ID = "trial-fixture-1";
const TRIAL_DURATION_MS = 1000;

function gappyVariableTrace(): GazeSample[] {
  return [
    {
      trialId: TRIAL_ID,
      seq: 0,
      captureMs: 0,
      inferenceDoneMs: 5,
      timestampBasis: "frame",
      x: 200,
      y: 270,
      providerQuality: 0.9,
      valid: true,
    },
    {
      trialId: TRIAL_ID,
      seq: 1,
      captureMs: 80,
      inferenceDoneMs: 90,
      timestampBasis: "frame",
      x: 210,
      y: 275,
      providerQuality: 0.9,
      valid: true,
    },
    {
      trialId: TRIAL_ID,
      seq: 2,
      captureMs: 160,
      inferenceDoneMs: 200,
      timestampBasis: "estimated",
      x: null,
      y: null,
      providerQuality: 0.1,
      valid: false,
    },
    {
      trialId: TRIAL_ID,
      seq: 3,
      captureMs: 220,
      inferenceDoneMs: 260,
      timestampBasis: "estimated",
      x: null,
      y: null,
      providerQuality: 0.05,
      valid: false,
    },
    {
      trialId: TRIAL_ID,
      seq: 4,
      captureMs: 600,
      inferenceDoneMs: 620,
      timestampBasis: "frame",
      x: 700,
      y: 270,
      providerQuality: 0.85,
      valid: true,
    },
    {
      trialId: TRIAL_ID,
      seq: 5,
      captureMs: 680,
      inferenceDoneMs: 690,
      timestampBasis: "frame",
      x: 710,
      y: 280,
      providerQuality: 0.85,
      valid: true,
    },
  ];
}

describe("quality gates", () => {
  it("defaults target interpretation to disabled (region only)", () => {
    const decision = evaluateQualityGates({
      validationErrorPx: [10, 12, 8],
    });
    assert.equal(decision.resolution, "region");
    assert.ok(
      decision.reasons.includes(
        "target_interpretation_disabled_pending_feasibility",
      ),
    );
  });

  it("allows target when feasibility enabled", () => {
    const decision = evaluateQualityGates({
      validationErrorPx: [10, 12, 8],
      policy: withQualityOverrides(undefined, {
        targetInterpretationEnabled: true,
      }),
    });
    assert.equal(decision.resolution, "target");
  });

  it("returns none when validation exceeds region limit", () => {
    const decision = evaluateQualityGates({
      validationErrorPx: [120, 130, 140],
    });
    assert.equal(decision.resolution, "none");
  });
});

describe("irregular gaze integration", () => {
  it("never turns gaps or invalid samples into dwell", () => {
    const result = integrateGazeRegions({
      samples: gappyVariableTrace(),
      regions: BOARD_HALF_REGIONS,
      trialDurationMs: TRIAL_DURATION_MS,
      maxIntegrationGapMs: DEFAULT_QUALITY_POLICY.maxIntegrationGapMs,
    });
    assert.equal(result.regionMs.left, 80);
    assert.equal(result.regionMs.right, 80);
    assert.equal(result.validObservedMs, 160);
    assert.ok(result.gaps.some((g) => g.reason === "trailing_untracked"));
  });

  it("records leading and trailing untracked time", () => {
    const gaps = detectGaps(
      [
        {
          trialId: TRIAL_ID,
          seq: 0,
          captureMs: 100,
          inferenceDoneMs: 100,
          timestampBasis: "frame",
          x: 1,
          y: 1,
          providerQuality: 1,
          valid: true,
        },
      ],
      500,
      250,
    );
    assert.ok(gaps.some((g) => g.reason === "leading_untracked"));
    assert.ok(gaps.some((g) => g.reason === "trailing_untracked"));
  });

  it("keeps click eligibility when gaze fails", () => {
    const summary = summarizeGaze({
      trialId: TRIAL_ID,
      samples: gappyVariableTrace(),
      regions: BOARD_HALF_REGIONS,
      trialDurationMs: TRIAL_DURATION_MS,
      calibration: {
        id: "c1",
        providerVersion: "mock@0.1.0",
        validationErrorPx: [10],
        qualityPolicy: "nv-gaze-quality@1.0.0",
        resolution: "region",
      },
      streamKind: "mock",
      source: "simulated",
      clickValid: true,
      groupKey: "proto-v1",
    });
    assert.equal(summary.eligibility.click, true);
    assert.equal(summary.eligibility.gaze, false);
  });
});

describe("simulated lab bridge", () => {
  it("preserves legacy SAMPLE_MS summary behavior", () => {
    const left = simulatedTrace(false, 22000);
    assert.equal(gazeSummary(left, 22000).tracked, 18400);
  });

  it("analyzes lab traces without claiming observed webcam", () => {
    const trace = simulatedTrace(false, 2000);
    const result = analyzeSimulatedLabSlice("lab", trace, 2000);
    assert.ok(result.validObservedMs > 0);
    assert.ok(result.coverageRatio <= 1);
  });
});
