/**
 * PROVISIONAL CONTRACTS
 *
 * Shapes the connected API needs that @neurovision/domain does not export yet.
 * Session records, trials, response events, scoring, and gaze sample/stream
 * types come from @neurovision/domain. Do not add a second SessionRecord here.
 *
 * Agent 1 owns packages/domain. This file is the request list until those
 * types move there. The API validates domain records with parseSessionRecord.
 */

import type {
  InputModality,
  PracticeRound,
  SessionRecord,
  SessionSource,
  TaskKind,
  TrialRecord,
} from "@neurovision/domain";

/** REQUEST: domain has no organization or membership model. */
export type Role = "admin" | "reviewer" | "participant";

export interface Organization {
  id: string;
  name: string;
}

export interface Membership {
  orgId: string;
  subject: string;
  role: Role;
}

/** REQUEST: domain profiles are local labels, not org-scoped participant records. */
export interface Participant {
  id: string;
  orgId: string;
  label: string;
  subject: string | null;
}

/**
 * REQUEST: domain SessionSource is "live" | "demonstration".
 * The earlier connected vocabulary "observed" | "simulated" is not in the
 * domain package. Legacy import keeps the original source string in
 * provenance and stores a domain SessionRecord:
 *   live -> live
 *   simulated -> demonstration
 * A simulated record is never stored as live.
 * If "observed" is added, live imports should use it.
 */
export type LegacySource = "live" | "simulated";

export type ExposureStatus = "unseen" | "seen" | "unknown";

/** Immutable assignment snapshot. Revisions are new rows, never updates. */
export interface AssignmentManifest {
  protocol: string;
  scorer: string;
  taskIds: TaskKind[];
  source: SessionSource;
  input: InputModality;
  accessibilityId: string;
  configHash: string;
}

export interface TaskAssignment {
  id: string;
  participantId: string;
  manifestHash: string;
  revision: number;
  exposureStatus: ExposureStatus;
  manifest: AssignmentManifest;
}

export type CompletionState = "active" | "complete" | "interrupted";
export type SyncState = "local" | "queued" | "uploading" | "acknowledged" | "blocked";
export type ProcessingState = "pending" | "running" | "ready" | "failed";

/** Ingestion session. The measurement body is a domain SessionRecord. */
export interface IngestionSession {
  id: string;
  participantId: string;
  assignmentId: string;
  assignmentRevision: number;
  startedAt: string;
  completion: CompletionState;
  sync: SyncState;
  processing: ProcessingState;
}

export type SessionShell = Omit<SessionRecord, "trials" | "practice">;

/** Ordered batch. Hash covers this object with canonical JSON. */
export interface BatchPayload {
  sequence: number;
  parentBatchId: string | null;
  shell: SessionShell;
  trials: TrialRecord[];
  practice: PracticeRound[];
}

export interface TraceUploadRequest {
  declaredByteCount: number;
  declaredExpandedBytes: number;
  declaredChecksum: string;
  contentType: string;
}

/**
 * REQUEST for Agent 1 and Agent 3: domain GazeSample is { elapsed, x, y }.
 * Connected traces also need capture versus inference timing. Bytes stay in
 * object storage; this metadata is not inferred by the API.
 */
export interface GazeSampleProvenanceRequest {
  trialId: string;
  seq: number;
  captureMs: number;
  inferenceDoneMs: number;
  timestampBasis: "frame" | "estimated";
  providerQuality: number | null;
  valid: boolean;
}

/** REQUEST: domain has no transfer mode. Practice lives on SessionRecord.practice. */
export type RequestedMode = "assessment" | "practice" | "transfer";

export interface ComparisonEligibility {
  click: boolean;
  gaze: boolean;
  reasons: string[];
  groupKey: string;
}

export interface LegacyEnvelope {
  version: 1;
  seeded: boolean;
  sessions: unknown[];
}
