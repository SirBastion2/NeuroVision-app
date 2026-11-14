import { CONTRACTS_VERSION, isScoredTrialEnd, scoreSession, type SessionRecord, type TrialRecord } from "@neurovision/domain";
import {
  BOARD_HALF_REGIONS,
  GAZE_ANALYSIS_VERSION,
  calibrationFromGates,
  domainSamplesToAnalysis,
  evaluateQualityGates,
  summarizeGaze,
  type DerivedGazeSummary,
  type GazeStreamKind,
  type Source,
} from "@neurovision/gaze";
import type { ComparisonEligibility, CompletionState } from "./contracts.provisional.js";

/**
 * Trace objects are UTF-8 JSON, version 1:
 * `{ version, trialId, streamKind, samples: [{ elapsed, x, y }], validationErrorPx? }`.
 * Samples are domain gaze samples. The worker maps them with `domainSamplesToAnalysis`
 * and summarizes them with `summarizeGaze`.
 */
export const ANALYSIS_VERSION = `${CONTRACTS_VERSION}+${GAZE_ANALYSIS_VERSION}`;

const STREAM_KINDS: readonly GazeStreamKind[] = ["webcam", "simulated-lab", "mock", "click-only"];

export interface IneligibleGazeTrial {
  trialId: string | null;
  analysisVersion: string;
  metrics: null;
  eligibility: ComparisonEligibility;
  ineligible: true;
}

export type GazeTrialResult = DerivedGazeSummary | IneligibleGazeTrial;

export interface DerivedSummary {
  stub: false;
  analysisVersion: string;
  inputHash: string;
  sessionRevision: number;
  scoring: ReturnType<typeof scoreSession>;
  gazeAnalysis: {
    version: string;
    trials: GazeTrialResult[];
  };
  eligibility: ComparisonEligibility;
  provenance: {
    contractsVersion: string;
    gazeAnalysisVersion: string;
    source: SessionRecord["source"];
  };
}

export function buildDerivedSummary(input: {
  record: SessionRecord;
  completion: CompletionState;
  inputHash: string;
  sessionRevision: number;
  traces?: readonly Uint8Array[];
}): DerivedSummary {
  const scoring = scoreSession(input.record);
  const click =
    input.record.source === "live" && input.record.status === "complete" && input.completion === "complete";
  const groupKey = `${input.record.protocol}:${input.record.scorer}:${input.record.source}:${input.record.input}`;
  const trials = (input.traces ?? []).map((bytes) =>
    analyzeTrace(bytes, input.record, click, groupKey),
  );
  const reasons: string[] = [];
  if (input.record.source !== "live") reasons.push("source_not_live");
  if (input.record.status !== "complete") reasons.push("session_incomplete");
  if (input.completion !== "complete") reasons.push("completion_not_complete");
  if (trials.length === 0) reasons.push("no_gaze_trace");
  let gaze = trials.length > 0;
  for (const trial of trials) {
    if (!trial.eligibility.gaze) {
      gaze = false;
      for (const reason of trial.eligibility.reasons) {
        if (!reasons.includes(reason)) reasons.push(reason);
      }
    }
  }
  return {
    stub: false,
    analysisVersion: ANALYSIS_VERSION,
    inputHash: input.inputHash,
    sessionRevision: input.sessionRevision,
    scoring,
    gazeAnalysis: {
      version: GAZE_ANALYSIS_VERSION,
      trials,
    },
    eligibility: { click, gaze, reasons, groupKey },
    provenance: {
      contractsVersion: CONTRACTS_VERSION,
      gazeAnalysisVersion: GAZE_ANALYSIS_VERSION,
      source: input.record.source,
    },
  };
}

function analyzeTrace(
  bytes: Uint8Array,
  record: SessionRecord,
  sessionClickValid: boolean,
  groupKey: string,
): GazeTrialResult {
  const parsed = parseTraceDocument(bytes);
  if ("error" in parsed) return ineligible(null, groupKey, sessionClickValid, [parsed.error]);
  const trial = findTrial(record, parsed.trialId);
  if (!trial) return ineligible(parsed.trialId, groupKey, sessionClickValid, ["trace_trial_unknown"]);
  const streamKind = record.source === "live" ? parsed.streamKind : "simulated-lab";
  const source: Source = record.source === "live" ? "observed" : "simulated";
  try {
    const samples = domainSamplesToAnalysis(parsed.trialId, parsed.samples);
    const calibration =
      parsed.validationErrorPx.length > 0
        ? calibrationFromGates(
            parsed.trialId,
            GAZE_ANALYSIS_VERSION,
            parsed.validationErrorPx,
            evaluateQualityGates({ validationErrorPx: parsed.validationErrorPx }),
          )
        : null;
    return summarizeGaze({
      trialId: parsed.trialId,
      samples,
      regions: BOARD_HALF_REGIONS,
      trialDurationMs: trial.duration,
      calibration,
      streamKind,
      source,
      clickValid: sessionClickValid && isScoredTrialEnd(trial.end),
      groupKey,
    });
  } catch {
    return ineligible(parsed.trialId, groupKey, sessionClickValid, ["trace_analysis_failed"]);
  }
}

interface ParsedTrace {
  trialId: string;
  streamKind: GazeStreamKind;
  samples: Array<{ elapsed: number; x: number; y: number }>;
  validationErrorPx: number[];
}

function parseTraceDocument(bytes: Uint8Array): ParsedTrace | { error: "trace_unreadable" } {
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!isRecord(value) || value.version !== 1 || typeof value.trialId !== "string" || !value.trialId) {
      return { error: "trace_unreadable" };
    }
    if (!isStreamKind(value.streamKind) || !Array.isArray(value.samples) || !value.samples.every(isDomainSample)) {
      return { error: "trace_unreadable" };
    }
    const errors = value.validationErrorPx;
    if (
      errors !== undefined &&
      (!Array.isArray(errors) || !errors.every((item) => typeof item === "number" && Number.isFinite(item)))
    ) {
      return { error: "trace_unreadable" };
    }
    return {
      trialId: value.trialId,
      streamKind: value.streamKind,
      samples: value.samples,
      validationErrorPx: errors ?? [],
    };
  } catch {
    return { error: "trace_unreadable" };
  }
}

function findTrial(record: SessionRecord, trialId: string): TrialRecord | undefined {
  return (
    record.trials.find((trial) => trial.id === trialId) ??
    record.practice.find((round) => round.trial.id === trialId)?.trial
  );
}

function ineligible(
  trialId: string | null,
  groupKey: string,
  click: boolean,
  reasons: string[],
): IneligibleGazeTrial {
  return {
    trialId,
    analysisVersion: GAZE_ANALYSIS_VERSION,
    metrics: null,
    eligibility: { click, gaze: false, reasons, groupKey },
    ineligible: true,
  };
}

function isStreamKind(value: unknown): value is GazeStreamKind {
  return typeof value === "string" && (STREAM_KINDS as readonly string[]).includes(value);
}

function isDomainSample(value: unknown): value is { elapsed: number; x: number; y: number } {
  if (!isRecord(value)) return false;
  return finite(value.elapsed) && finite(value.x) && finite(value.y);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
