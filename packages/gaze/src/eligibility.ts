import type {
  ComparisonEligibility,
  GazeResolution,
  Source,
} from "./contracts.js";

/** Click and gaze eligibility are independent; click validity survives gaze failure. */
export function gazeEligibility(input: {
  clickValid: boolean;
  resolution: GazeResolution;
  coverageRatio: number;
  minCoverageRatio: number;
  source: Source;
  streamIsSurrogate: boolean;
  groupKey: string;
  extraReasons?: string[];
}): ComparisonEligibility {
  const reasons: string[] = [...(input.extraReasons ?? [])];
  let gaze = true;

  if (input.resolution === "none") {
    gaze = false;
    reasons.push("gaze_resolution_none");
  }
  if (input.coverageRatio < input.minCoverageRatio) {
    gaze = false;
    reasons.push("insufficient_gaze_coverage");
  }
  if (input.streamIsSurrogate) {
    gaze = false;
    reasons.push("surrogate_or_simulated_stream");
  }

  return {
    click: input.clickValid,
    gaze,
    reasons,
    groupKey: input.groupKey,
  };
}
