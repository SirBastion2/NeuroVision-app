import {
  isInteger,
  isNonEmptyString,
  isObject,
  isOneOf,
  parseFail,
} from "./guard.js";
import { isSessionRecord, parseSessionRecord } from "./validate.js";
import type { SessionRecord } from "./session.js";

export const COMPLETION_STATES = ["active", "complete", "interrupted"] as const;
export type CompletionState = (typeof COMPLETION_STATES)[number];

export const SYNC_STATES = ["local", "queued", "uploading", "acknowledged", "blocked"] as const;
export type SyncState = (typeof SYNC_STATES)[number];

export const PROCESSING_STATES = ["pending", "running", "ready", "failed"] as const;
export type ProcessingState = (typeof PROCESSING_STATES)[number];

export const COMPLETION_TRANSITIONS: Record<CompletionState, readonly CompletionState[]> = {
  active: ["complete", "interrupted"],
  complete: [],
  interrupted: [],
};

export const SYNC_TRANSITIONS: Record<SyncState, readonly SyncState[]> = {
  local: ["queued", "uploading"],
  queued: ["uploading", "blocked"],
  uploading: ["acknowledged", "blocked", "queued"],
  acknowledged: [],
  blocked: ["queued", "uploading"],
};

export const PROCESSING_TRANSITIONS: Record<ProcessingState, readonly ProcessingState[]> = {
  pending: ["running", "failed"],
  running: ["ready", "failed"],
  ready: [],
  failed: ["pending", "running"],
};

export interface TraceUploadRequest {
  declaredByteCount: number;
  declaredExpandedBytes: number;
  declaredChecksum: string;
  contentType: string;
}

/** Ordered upload batch of validated session records and optional trace upload requests. */
export interface BatchPayload {
  sequence: number;
  parentBatchId: string | null;
  records: SessionRecord[];
  traces: TraceUploadRequest[];
}

export function isCompletionState(value: unknown): value is CompletionState {
  return isOneOf(value, COMPLETION_STATES);
}

export function parseCompletionState(value: unknown): CompletionState {
  if (!isCompletionState(value)) parseFail("completion state");
  return value;
}

export function isSyncState(value: unknown): value is SyncState {
  return isOneOf(value, SYNC_STATES);
}

export function parseSyncState(value: unknown): SyncState {
  if (!isSyncState(value)) parseFail("sync state");
  return value;
}

export function isProcessingState(value: unknown): value is ProcessingState {
  return isOneOf(value, PROCESSING_STATES);
}

export function parseProcessingState(value: unknown): ProcessingState {
  if (!isProcessingState(value)) parseFail("processing state");
  return value;
}

function canTransition<T extends string>(
  allowed: Record<T, readonly T[]>,
  from: T,
  to: T,
): boolean {
  return allowed[from].includes(to);
}

function transition<T extends string>(kind: string, allowed: Record<T, readonly T[]>, from: T, to: T): T {
  if (!canTransition(allowed, from, to)) {
    throw new Error(`Cannot transition ${kind} from ${from} to ${to}.`);
  }
  return to;
}

export function canTransitionCompletion(from: CompletionState, to: CompletionState): boolean {
  return canTransition(COMPLETION_TRANSITIONS, parseCompletionState(from), parseCompletionState(to));
}

export function transitionCompletion(from: CompletionState, to: CompletionState): CompletionState {
  return transition("completion", COMPLETION_TRANSITIONS, parseCompletionState(from), parseCompletionState(to));
}

export function canTransitionSync(from: SyncState, to: SyncState): boolean {
  return canTransition(SYNC_TRANSITIONS, parseSyncState(from), parseSyncState(to));
}

export function transitionSync(from: SyncState, to: SyncState): SyncState {
  return transition("sync", SYNC_TRANSITIONS, parseSyncState(from), parseSyncState(to));
}

export function canTransitionProcessing(from: ProcessingState, to: ProcessingState): boolean {
  return canTransition(PROCESSING_TRANSITIONS, parseProcessingState(from), parseProcessingState(to));
}

export function transitionProcessing(from: ProcessingState, to: ProcessingState): ProcessingState {
  return transition(
    "processing",
    PROCESSING_TRANSITIONS,
    parseProcessingState(from),
    parseProcessingState(to),
  );
}

export function isTraceUploadRequest(value: unknown): value is TraceUploadRequest {
  return (
    isObject(value) &&
    isInteger(value.declaredByteCount) &&
    value.declaredByteCount >= 0 &&
    isInteger(value.declaredExpandedBytes) &&
    value.declaredExpandedBytes >= value.declaredByteCount &&
    isNonEmptyString(value.declaredChecksum) &&
    isNonEmptyString(value.contentType)
  );
}

export function parseTraceUploadRequest(value: unknown): TraceUploadRequest {
  if (!isTraceUploadRequest(value)) parseFail("trace upload request");
  return {
    declaredByteCount: value.declaredByteCount,
    declaredExpandedBytes: value.declaredExpandedBytes,
    declaredChecksum: value.declaredChecksum,
    contentType: value.contentType,
  };
}

export function isBatchPayload(value: unknown): value is BatchPayload {
  return (
    isObject(value) &&
    isInteger(value.sequence) &&
    value.sequence >= 1 &&
    (value.parentBatchId === null || isNonEmptyString(value.parentBatchId)) &&
    (value.sequence === 1 ? value.parentBatchId === null : value.parentBatchId !== null) &&
    Array.isArray(value.records) &&
    value.records.every(isSessionRecord) &&
    Array.isArray(value.traces) &&
    value.traces.every(isTraceUploadRequest)
  );
}

export function parseBatchPayload(value: unknown): BatchPayload {
  if (!isBatchPayload(value)) parseFail("batch payload");
  return {
    sequence: value.sequence,
    parentBatchId: value.parentBatchId,
    records: value.records.map(parseSessionRecord),
    traces: value.traces.map(parseTraceUploadRequest),
  };
}

export function batchPayloadFromSession(
  session: SessionRecord,
  options: {
    sequence?: number;
    parentBatchId?: string | null;
    traces?: readonly TraceUploadRequest[];
  } = {},
): BatchPayload {
  const sequence = options.sequence ?? 1;
  const parentBatchId = options.parentBatchId ?? null;
  return parseBatchPayload({
    sequence,
    parentBatchId,
    records: [parseSessionRecord(session)],
    traces: (options.traces ?? []).map(parseTraceUploadRequest),
  });
}
