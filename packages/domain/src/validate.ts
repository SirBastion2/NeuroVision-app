import { RESPONSE_EVENT_TYPES, type ResponseEvent } from "./events.js";
import type { Stimulus, TaskKind, TaskLayout, LineSegment } from "./layouts.js";
import {
  INPUT_MODALITIES,
  SESSION_SOURCES,
  SESSION_STATUSES,
  TRIAL_END_REASONS,
  VIEWPORT_CLASSES,
  type PracticeSuggestion,
  type SessionRecord,
  type TrialRecord,
  type Viewport,
} from "./session.js";
import { PRACTICE_CUES, PRACTICE_LEVELS } from "./practice.js";
import type { CalibrationQualityReport } from "./gaze.js";

const TASK_KINDS: readonly TaskKind[] = ["target-selection", "line-bisection"];
const STIMULUS_KINDS = ["target", "distractor"] as const;
const SIDES = ["left", "right"] as const;
const DENSITIES = ["standard", "low"] as const;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

function isViewport(value: unknown): value is Viewport {
  return (
    isObject(value) &&
    isFiniteNumber(value.width) &&
    isFiniteNumber(value.height) &&
    isFiniteNumber(value.dpr) &&
    isOneOf(value.class, VIEWPORT_CLASSES)
  );
}

function isStimulus(value: unknown): value is Stimulus {
  return (
    isObject(value) &&
    typeof value.id === "string" &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    isOneOf(value.kind, STIMULUS_KINDS) &&
    isOneOf(value.side, SIDES)
  );
}

function isLayout(value: unknown): value is TaskLayout {
  return isObject(value) && typeof value.id === "string" && Array.isArray(value.stimuli) && value.stimuli.every(isStimulus);
}

function isLine(value: unknown): value is LineSegment {
  return (
    isObject(value) &&
    isFiniteNumber(value.x1) &&
    isFiniteNumber(value.x2) &&
    isFiniteNumber(value.y) &&
    value.x1 < value.x2
  );
}

function isEvent(value: unknown, trialId: string): value is ResponseEvent {
  return (
    isObject(value) &&
    typeof value.sessionId === "string" &&
    value.trialId === trialId &&
    Number.isInteger(value.seq) &&
    (value.seq as number) > 0 &&
    isFiniteNumber(value.elapsed) &&
    value.elapsed >= 0 &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    (value.stimulusId === null || typeof value.stimulusId === "string") &&
    isOneOf(value.type, RESPONSE_EVENT_TYPES)
  );
}

function isPracticeSuggestion(value: unknown): value is PracticeSuggestion {
  if (
    !isObject(value) ||
    typeof value.version !== "string" ||
    !isOneOf(value.cue, PRACTICE_CUES) ||
    !isOneOf(value.density, DENSITIES) ||
    !PRACTICE_LEVELS.includes(value.level as 0 | 1 | 2) ||
    typeof value.explanation !== "string" ||
    !(value.override === null || typeof value.override === "string") ||
    !(value.scanGuide === undefined || typeof value.scanGuide === "boolean")
  ) {
    return false;
  }
  if (value.metrics === null) return true;
  return isObject(value.metrics) && isFiniteNumber(value.metrics.hitRate) && isFiniteNumber(value.metrics.asymmetry);
}

function isCalibration(value: unknown): value is CalibrationQualityReport {
  return (
    isObject(value) &&
    Number.isInteger(value.pointCount) &&
    isFiniteNumber(value.leftRightAgreement) &&
    isFiniteNumber(value.gridAgreement) &&
    isFiniteNumber(value.averageErrorPx)
  );
}

function isTrial(value: unknown): value is TrialRecord {
  if (
    !isObject(value) ||
    typeof value.id !== "string" ||
    !isOneOf(value.task, TASK_KINDS) ||
    !isOneOf(value.end, TRIAL_END_REASONS) ||
    !isFiniteNumber(value.duration) ||
    value.duration < 0 ||
    !isOneOf(value.input, INPUT_MODALITIES) ||
    !isViewport(value.viewport) ||
    !isLayout(value.layout) ||
    !Array.isArray(value.events)
  ) {
    return false;
  }
  if (value.task === "line-bisection" && !isLine(value.line)) return false;
  return value.events.every((event) => isEvent(event, value.id as string));
}

export function isSessionRecord(value: unknown): value is SessionRecord {
  if (
    !isObject(value) ||
    typeof value.id !== "string" ||
    typeof value.profileId !== "string" ||
    typeof value.alias !== "string" ||
    !isOneOf(value.source, SESSION_SOURCES) ||
    typeof value.protocol !== "string" ||
    typeof value.scorer !== "string" ||
    !Array.isArray(value.taskIds) ||
    !value.taskIds.every((id) => isOneOf(id, TASK_KINDS)) ||
    !isOneOf(value.status, SESSION_STATUSES) ||
    !isOneOf(value.input, INPUT_MODALITIES) ||
    !isViewport(value.viewport) ||
    !isIsoTimestamp(value.startedAt) ||
    !isIsoTimestamp(value.completedAt) ||
    !Array.isArray(value.trials) ||
    !Array.isArray(value.practice) ||
    !isPracticeSuggestion(value.decision) ||
    typeof value.pointerSampling !== "boolean" ||
    !(value.calibration === null || isCalibration(value.calibration))
  ) {
    return false;
  }

  return (
    value.trials.every(isTrial) &&
    value.practice.every(
      (round) => isObject(round) && isTrial(round.trial) && isPracticeSuggestion(round.config),
    )
  );
}

export function parseSessionRecord(value: unknown): SessionRecord {
  if (!isSessionRecord(value)) {
    throw new Error("Cannot save an invalid session record.");
  }
  return value;
}
