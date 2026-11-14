import type {
  CalibrationQualityReport,
  GazeSample as DomainGazeSample,
  GazeStream,
  TrackingGap,
} from "@neurovision/domain";
import type { GazeGap, GazeSample as AnalysisGazeSample } from "./contracts.js";
import type { LabGazeTrace } from "./simulated.js";
import { evaluateQualityGates } from "./quality.js";

/** Map domain board-space samples into Agent C analysis samples. */
export function domainSamplesToAnalysis(
  trialId: string,
  samples: readonly DomainGazeSample[],
): AnalysisGazeSample[] {
  return samples.map((s, seq) => ({
    trialId,
    seq,
    captureMs: s.elapsed,
    inferenceDoneMs: s.elapsed,
    timestampBasis: "estimated",
    x: s.x,
    y: s.y,
    providerQuality: 1,
    valid: true,
  }));
}

/** Map analysis gaps into domain TrackingGap intervals (ms → board elapsed). */
export function analysisGapsToDomain(gaps: readonly GazeGap[]): TrackingGap[] {
  return gaps.map((g) => ({ start: g.startMs, end: g.endMs }));
}

/** Build a domain GazeStream from a simulated lab trace. */
export function labTraceToDomainStream(
  id: string,
  label: string,
  trace: LabGazeTrace,
): GazeStream {
  return {
    id,
    label,
    samples: trace.samples.map((s) => ({
      elapsed: s.elapsed,
      x: s.x,
      y: s.y,
    })),
    gaps: trace.gaps.map((g) => ({ start: g.start, end: g.end })),
  };
}

/** Produce a domain CalibrationQualityReport from validation errors. */
export function calibrationReportFromErrors(
  validationErrorPx: readonly number[],
): CalibrationQualityReport {
  const decision = evaluateQualityGates({ validationErrorPx: [...validationErrorPx] });
  const averageErrorPx =
    validationErrorPx.length === 0
      ? 0
      : validationErrorPx.reduce((a, b) => a + b, 0) / validationErrorPx.length;
  return {
    pointCount: validationErrorPx.length,
    leftRightAgreement: decision.resolution === "none" ? 0 : 1,
    gridAgreement: decision.resolution === "target" ? 1 : decision.resolution === "region" ? 0.7 : 0,
    averageErrorPx,
  };
}
