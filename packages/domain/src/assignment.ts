import {
  isInteger,
  isIsoTimestamp,
  isNonEmptyString,
  isObject,
  isOneOf,
  parseFail,
} from "./guard.js";
import { isRequestedMode, type RequestedMode } from "./mode.js";
import { INPUT_MODALITIES, SESSION_SOURCES, type InputModality, type SessionSource } from "./session.js";
import type { TaskKind } from "./layouts.js";

export const EXPOSURE_STATUSES = ["unseen", "seen", "unknown"] as const;
export type ExposureStatus = (typeof EXPOSURE_STATUSES)[number];

const TASK_KINDS: readonly TaskKind[] = ["target-selection", "line-bisection"];

export interface AssignmentManifest {
  protocol: string;
  scorer: string;
  taskIds: TaskKind[];
  source: SessionSource;
  input: InputModality;
  accessibilityId: string;
  configHash: string;
  requestedMode: RequestedMode;
}

export interface TaskAssignment {
  id: string;
  orgId: string;
  participantId: string;
  revision: number;
  supersedes: number | null;
  createdAt: string;
  exposureStatus: ExposureStatus;
  manifest: AssignmentManifest;
}

export function isExposureStatus(value: unknown): value is ExposureStatus {
  return isOneOf(value, EXPOSURE_STATUSES);
}

export function parseExposureStatus(value: unknown): ExposureStatus {
  if (!isExposureStatus(value)) parseFail("exposure status");
  return value;
}

export function isAssignmentManifest(value: unknown): value is AssignmentManifest {
  return (
    isObject(value) &&
    isNonEmptyString(value.protocol) &&
    isNonEmptyString(value.scorer) &&
    Array.isArray(value.taskIds) &&
    value.taskIds.length > 0 &&
    value.taskIds.every((id) => isOneOf(id, TASK_KINDS)) &&
    isOneOf(value.source, SESSION_SOURCES) &&
    isOneOf(value.input, INPUT_MODALITIES) &&
    isNonEmptyString(value.accessibilityId) &&
    isNonEmptyString(value.configHash) &&
    isRequestedMode(value.requestedMode)
  );
}

export function parseAssignmentManifest(value: unknown): AssignmentManifest {
  if (!isAssignmentManifest(value)) parseFail("assignment manifest");
  return {
    protocol: value.protocol,
    scorer: value.scorer,
    taskIds: [...value.taskIds],
    source: value.source,
    input: value.input,
    accessibilityId: value.accessibilityId,
    configHash: value.configHash,
    requestedMode: value.requestedMode,
  };
}

export function isTaskAssignment(value: unknown): value is TaskAssignment {
  return (
    isObject(value) &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.orgId) &&
    isNonEmptyString(value.participantId) &&
    isInteger(value.revision) &&
    value.revision >= 1 &&
    (value.supersedes === null || (isInteger(value.supersedes) && value.supersedes >= 1)) &&
    (value.supersedes === null ? value.revision === 1 : value.supersedes === value.revision - 1) &&
    isIsoTimestamp(value.createdAt) &&
    isExposureStatus(value.exposureStatus) &&
    isAssignmentManifest(value.manifest)
  );
}

export function parseTaskAssignment(value: unknown): TaskAssignment {
  if (!isTaskAssignment(value)) parseFail("task assignment");
  return {
    id: value.id,
    orgId: value.orgId,
    participantId: value.participantId,
    revision: value.revision,
    supersedes: value.supersedes,
    createdAt: value.createdAt,
    exposureStatus: value.exposureStatus,
    manifest: parseAssignmentManifest(value.manifest),
  };
}

export interface AssignmentRevisionInput {
  id: string;
  orgId: string;
  participantId: string;
  createdAt: string;
  exposureStatus: ExposureStatus;
  manifest: AssignmentManifest;
}

/**
 * Append an immutable assignment revision. Returns a new array; does not mutate `revisions`
 * or any existing revision object.
 */
export function appendAssignmentRevision(
  revisions: readonly TaskAssignment[],
  input: AssignmentRevisionInput,
): TaskAssignment[] {
  const history = revisions.map(parseTaskAssignment);
  const manifest = parseAssignmentManifest(input.manifest);
  const exposureStatus = parseExposureStatus(input.exposureStatus);
  if (!isNonEmptyString(input.id) || !isNonEmptyString(input.orgId) || !isNonEmptyString(input.participantId)) {
    parseFail("task assignment");
  }
  if (!isIsoTimestamp(input.createdAt)) parseFail("task assignment");

  const latest = history.at(-1);
  if (latest) {
    if (latest.id !== input.id || latest.orgId !== input.orgId || latest.participantId !== input.participantId) {
      throw new Error("Assignment identity cannot change across revisions.");
    }
  }

  const revision = latest ? latest.revision + 1 : 1;
  const supersedes = latest ? latest.revision : null;
  const next: TaskAssignment = {
    id: input.id,
    orgId: input.orgId,
    participantId: input.participantId,
    revision,
    supersedes,
    createdAt: input.createdAt,
    exposureStatus,
    manifest,
  };
  return [...history, next];
}
