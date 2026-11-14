import { isOneOf, isObject, parseFail } from "./guard.js";
import type { PracticeSuggestion, PracticeRound, TrialRecord } from "./session.js";

export const REQUESTED_MODES = ["assessment", "practice", "transfer"] as const;
export type RequestedMode = (typeof REQUESTED_MODES)[number];

/**
 * How a requested run mode is stored on SessionRecord.
 *
 * - assessment → SessionRecord trials (assessment layouts). Practice array is not the assessment.
 * - practice → SessionRecord.practice with transfer omitted/false.
 * - transfer → transfer-cue isolation; stored as a practice round with `transfer: true`.
 */
export interface RequestedModeMapping {
  requested: RequestedMode;
  usesAssessmentTrials: boolean;
  usesPracticeRecord: boolean;
  transfer: boolean;
}

export function isRequestedMode(value: unknown): value is RequestedMode {
  return isOneOf(value, REQUESTED_MODES);
}

export function parseRequestedMode(value: unknown): RequestedMode {
  if (!isRequestedMode(value)) parseFail("requested mode");
  return value;
}

export function mapRequestedMode(mode: RequestedMode): RequestedModeMapping {
  const requested = parseRequestedMode(mode);
  if (requested === "assessment") {
    return {
      requested,
      usesAssessmentTrials: true,
      usesPracticeRecord: false,
      transfer: false,
    };
  }
  if (requested === "practice") {
    return {
      requested,
      usesAssessmentTrials: false,
      usesPracticeRecord: true,
      transfer: false,
    };
  }
  return {
    requested,
    usesAssessmentTrials: false,
    usesPracticeRecord: true,
    transfer: true,
  };
}

export function isTransferPracticeRound(round: PracticeRound): boolean {
  return round.transfer === true;
}

/** Build the practice record a requested practice/transfer mode maps onto. */
export function practiceRoundForRequestedMode(
  mode: RequestedMode,
  trial: TrialRecord,
  config: PracticeSuggestion,
): PracticeRound {
  const mapping = mapRequestedMode(mode);
  if (!mapping.usesPracticeRecord) {
    throw new Error("Assessment is recorded on SessionRecord trials, not SessionRecord.practice.");
  }
  return { trial, config, transfer: mapping.transfer };
}

export function parseRequestedModeMapping(value: unknown): RequestedModeMapping {
  if (!isObject(value) || !isRequestedMode(value.requested)) parseFail("requested mode mapping");
  const expected = mapRequestedMode(value.requested);
  if (
    value.usesAssessmentTrials !== expected.usesAssessmentTrials ||
    value.usesPracticeRecord !== expected.usesPracticeRecord ||
    value.transfer !== expected.transfer
  ) {
    parseFail("requested mode mapping");
  }
  return expected;
}
