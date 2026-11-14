/**
 * Gaze/analysis types aligned with workstream A contracts (architecture §07–§09).
 * Session / Trial / ResponseEvent ownership remains with A; trial IDs are opaque.
 * When `packages/domain` lands on main, prefer importing shared shapes from there.
 */

export type Source = "observed" | "simulated";
export type LegacySource = "live" | "simulated";
export type TimestampBasis = "frame" | "estimated";
export type GazeResolution = "none" | "region" | "target";

export type GazeStreamKind =
  | "webcam"
  | "simulated-lab"
  | "mock"
  | "click-only";

export interface CalibrationPoint {
  id: string;
  x: number;
  y: number;
}

/** C extension: train vs independent validate (must not share ids). */
export type CalibrationTarget = CalibrationPoint & {
  role: "train" | "validate";
};

export interface GazeSample {
  trialId: string;
  seq: number;
  captureMs: number;
  inferenceDoneMs: number;
  timestampBasis: TimestampBasis;
  x: number | null;
  y: number | null;
  providerQuality: number | null;
  valid: boolean;
}

export interface GazeGap {
  startMs: number;
  endMs: number;
  reason: string;
}

export interface CalibrationResult {
  id: string;
  providerVersion: string;
  validationErrorPx: number[];
  qualityPolicy: string;
  resolution: GazeResolution;
}

/** Provider quality callback shape (A contract). */
export interface QualityState {
  resolution: GazeResolution;
  reason: string;
}

/** Richer engineering signals used by C quality gates (not the provider callback). */
export interface QualitySignals {
  ok: boolean;
  reason: string;
  driftPx: number | null;
  coverageRatio: number | null;
  timestampUncertaintyMs: number | null;
}

export interface ComparisonEligibility {
  click: boolean;
  gaze: boolean;
  reasons: string[];
  groupKey: string;
}

export interface DerivedGazeSummary {
  trialId: string;
  analysisVersion: string;
  inputHash: string;
  metrics: Record<string, number | null>;
  eligibility: ComparisonEligibility;
  gaps: GazeGap[];
  resolution: GazeResolution;
  source: Source;
  streamKind: GazeStreamKind;
}

export interface TrialClock {
  now(): number;
}

export interface QualityPolicy {
  id: string;
  version: string;
  maxMeanValidationErrorPx: number;
  maxMeanValidationErrorPxRegion: number;
  maxIntegrationGapMs: number;
  minCoverageRatio: number;
  maxDriftPx: number;
  maxTimestampUncertaintyMs: number;
  targetInterpretationEnabled: boolean;
}

export const DEFAULT_QUALITY_POLICY: QualityPolicy = {
  id: "nv-gaze-quality",
  version: "1.0.0",
  maxMeanValidationErrorPx: 40,
  maxMeanValidationErrorPxRegion: 80,
  maxIntegrationGapMs: 250,
  minCoverageRatio: 0.35,
  maxDriftPx: 60,
  maxTimestampUncertaintyMs: 80,
  targetInterpretationEnabled: false,
};

export const GAZE_ANALYSIS_VERSION = "gaze-analysis@0.1.0";

export function mapLegacySource(source: LegacySource): Source {
  return source === "live" ? "observed" : "simulated";
}

export interface GazeProvider {
  initialize(): Promise<void>;
  calibrate(points: CalibrationPoint[]): Promise<void>;
  validate(points: CalibrationPoint[]): Promise<CalibrationResult>;
  start(clock: TrialClock, emit: (sample: GazeSample) => void): void;
  onQuality(handler: (state: QualityState) => void): () => void;
  stop(): Promise<void>;
}
