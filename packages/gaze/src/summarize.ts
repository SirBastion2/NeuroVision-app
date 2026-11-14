import {
  GAZE_ANALYSIS_VERSION,
  type CalibrationResult,
  type DerivedGazeSummary,
  type GazeSample,
  type GazeStreamKind,
  type QualityPolicy,
  type Source,
} from "./contracts.js";
import { gazeEligibility } from "./eligibility.js";
import { integrateGazeRegions, type RegionDefinition } from "./integrate.js";
import { provenanceFor } from "./labels.js";
import { DEFAULT_QUALITY_POLICY } from "./quality.js";

export interface SummarizeGazeInput {
  trialId: string;
  samples: readonly GazeSample[];
  regions: readonly RegionDefinition[];
  trialDurationMs: number;
  calibration: CalibrationResult | null;
  streamKind: GazeStreamKind;
  source: Source;
  clickValid: boolean;
  groupKey: string;
  policy?: QualityPolicy;
}

/** Browser-safe deterministic hash (no node:crypto). */
function hashInputs(parts: unknown[]): string {
  const text = JSON.stringify(parts);
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function summarizeGaze(input: SummarizeGazeInput): DerivedGazeSummary {
  const policy = input.policy ?? DEFAULT_QUALITY_POLICY;
  const provenance = provenanceFor(input.streamKind);
  const resolution = input.calibration?.resolution ?? "none";

  const integration = integrateGazeRegions({
    samples: input.samples,
    regions: input.regions,
    trialDurationMs: input.trialDurationMs,
    maxIntegrationGapMs: policy.maxIntegrationGapMs,
  });

  const eligibility = gazeEligibility({
    clickValid: input.clickValid,
    resolution,
    coverageRatio: integration.coverageRatio,
    minCoverageRatio: policy.minCoverageRatio,
    source: input.source,
    streamIsSurrogate: provenance.isSurrogate,
    groupKey: input.groupKey,
  });

  const metrics: Record<string, number | null> = {
    validObservedMs: integration.validObservedMs,
    coverageRatio: integration.coverageRatio,
    gapCount: integration.gaps.length,
    sampleCount: input.samples.length,
    validSampleCount: input.samples.filter((s) => s.valid).length,
  };

  for (const [id, ms] of Object.entries(integration.regionMs)) {
    metrics[`regionMs:${id}`] = ms;
    metrics[`regionProp:${id}`] = integration.regionProportions[id] ?? null;
  }

  metrics.targetLevelAvailable =
    resolution === "none" ? null : resolution === "target" ? 1 : 0;

  return {
    trialId: input.trialId,
    analysisVersion: GAZE_ANALYSIS_VERSION,
    inputHash: hashInputs([
      GAZE_ANALYSIS_VERSION,
      input.trialId,
      input.calibration,
      input.samples,
      input.regions,
      input.trialDurationMs,
      policy,
      input.streamKind,
      input.source,
    ]),
    metrics,
    eligibility,
    gaps: integration.gaps,
    resolution,
    source: input.source,
    streamKind: input.streamKind,
  };
}
