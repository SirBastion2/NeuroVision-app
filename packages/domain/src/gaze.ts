import type { Point } from "./board.js";
import { isFiniteNumber, isNonNegativeNumber, isObject, isOneOf, parseFail } from "./guard.js";

export interface GazeSample {
  elapsed: number;
  x: number;
  y: number;
}

export const TIMESTAMP_BASES = ["frame", "estimated"] as const;
export type TimestampBasis = (typeof TIMESTAMP_BASES)[number];

/**
 * Timing provenance for a gaze sample. Stored alongside GazeSample, never inside it.
 * GazeSample remains `{ elapsed, x, y }`.
 */
export interface GazeSampleProvenanceRequest {
  captureMs: number;
  inferenceDoneMs: number;
  timestampBasis: TimestampBasis;
}

export interface GazeSampleWithProvenance {
  sample: GazeSample;
  provenance: GazeSampleProvenanceRequest;
}

export function isGazeSample(value: unknown): value is GazeSample {
  return (
    isObject(value) &&
    isNonNegativeNumber(value.elapsed) &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y)
  );
}

export function parseGazeSample(value: unknown): GazeSample {
  if (!isGazeSample(value)) parseFail("gaze sample");
  return { elapsed: value.elapsed, x: value.x, y: value.y };
}

export function isTimestampBasis(value: unknown): value is TimestampBasis {
  return isOneOf(value, TIMESTAMP_BASES);
}

export function isGazeSampleProvenanceRequest(value: unknown): value is GazeSampleProvenanceRequest {
  return (
    isObject(value) &&
    isNonNegativeNumber(value.captureMs) &&
    isNonNegativeNumber(value.inferenceDoneMs) &&
    value.inferenceDoneMs >= value.captureMs &&
    isTimestampBasis(value.timestampBasis)
  );
}

export function parseGazeSampleProvenanceRequest(value: unknown): GazeSampleProvenanceRequest {
  if (!isGazeSampleProvenanceRequest(value)) parseFail("gaze sample provenance request");
  return {
    captureMs: value.captureMs,
    inferenceDoneMs: value.inferenceDoneMs,
    timestampBasis: value.timestampBasis,
  };
}

/** Pair a gaze sample with provenance without putting timing fields on the sample. */
export function attachGazeSampleProvenance(
  sample: GazeSample,
  provenance: GazeSampleProvenanceRequest,
): GazeSampleWithProvenance {
  return {
    sample: parseGazeSample(sample),
    provenance: parseGazeSampleProvenanceRequest(provenance),
  };
}

export interface TrackingGap {
  start: number;
  end: number;
}

export interface GazeStream {
  id: string;
  label: string;
  samples: GazeSample[];
  gaps: TrackingGap[];
}

export interface CalibrationPoint extends Point {}

export interface CalibrationQualityReport {
  pointCount: number;
  leftRightAgreement: number;
  gridAgreement: number;
  averageErrorPx: number;
}
