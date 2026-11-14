import type {
  CalibrationResult,
  GazeResolution,
  QualityPolicy,
  QualitySignals,
} from "./contracts.js";
import { DEFAULT_QUALITY_POLICY } from "./contracts.js";

export { DEFAULT_QUALITY_POLICY };

export function withQualityOverrides(
  base: QualityPolicy = DEFAULT_QUALITY_POLICY,
  overrides: Partial<QualityPolicy> = {},
): QualityPolicy {
  return { ...base, ...overrides, id: overrides.id ?? base.id };
}

export interface GateInput {
  validationErrorPx: number[];
  qualitySignals?: QualitySignals | null;
  policy?: QualityPolicy;
}

export interface GateDecision {
  resolution: GazeResolution;
  reasons: string[];
  meanValidationErrorPx: number | null;
  policyId: string;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function evaluateQualityGates(input: GateInput): GateDecision {
  const policy = input.policy ?? DEFAULT_QUALITY_POLICY;
  const reasons: string[] = [];
  const meanErr = mean(input.validationErrorPx);

  if (meanErr === null) {
    reasons.push("no_independent_validation");
    return {
      resolution: "none",
      reasons,
      meanValidationErrorPx: null,
      policyId: `${policy.id}@${policy.version}`,
    };
  }

  const qs = input.qualitySignals;
  if (qs && !qs.ok) reasons.push(`quality_state:${qs.reason}`);
  if (qs?.driftPx != null && qs.driftPx > policy.maxDriftPx) {
    reasons.push("drift_exceeds_policy");
  }
  if (qs?.coverageRatio != null && qs.coverageRatio < policy.minCoverageRatio) {
    reasons.push("coverage_below_policy");
  }
  if (
    qs?.timestampUncertaintyMs != null &&
    qs.timestampUncertaintyMs > policy.maxTimestampUncertaintyMs
  ) {
    reasons.push("timestamp_uncertainty_high");
  }

  let resolution: GazeResolution = "none";

  if (meanErr <= policy.maxMeanValidationErrorPx) {
    if (policy.targetInterpretationEnabled && reasons.length === 0) {
      resolution = "target";
    } else {
      resolution = "region";
      if (!policy.targetInterpretationEnabled) {
        reasons.push("target_interpretation_disabled_pending_feasibility");
      }
    }
  } else if (meanErr <= policy.maxMeanValidationErrorPxRegion) {
    resolution = "region";
    reasons.push("validation_error_region_only");
  } else {
    resolution = "none";
    reasons.push("validation_error_exceeds_region");
  }

  if (
    reasons.some(
      (r) => r.startsWith("quality_state:") || r === "drift_exceeds_policy",
    )
  ) {
    if (resolution === "target") resolution = "region";
    else if (
      resolution === "region" &&
      reasons.includes("drift_exceeds_policy")
    ) {
      resolution = "none";
      reasons.push("downgraded_none_due_to_drift");
    }
  }

  return {
    resolution,
    reasons,
    meanValidationErrorPx: meanErr,
    policyId: `${policy.id}@${policy.version}`,
  };
}

export function calibrationFromGates(
  id: string,
  providerVersion: string,
  validationErrorPx: number[],
  decision: GateDecision,
): CalibrationResult {
  return {
    id,
    providerVersion,
    validationErrorPx: [...validationErrorPx],
    qualityPolicy: decision.policyId,
    resolution: decision.resolution,
  };
}
