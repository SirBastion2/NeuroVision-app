import { randomUUID } from "node:crypto";
import {
  ASSUMED_NORM_NOTICE,
  applyScoringNorms,
  fittedNormNotice,
  parseBatteryRecord,
  parseSessionRecord,
  scoreBatteryRecord,
  scoringNormsFromBatteries,
  type BatteryRecord,
  type PracticeRound,
  type SessionRecord,
  type TrialRecord,
} from "@neurovision/domain";
import { ANALYSIS_VERSION } from "./analysis.js";
import { assertCanAssign, assertMeasurementRead, audit, requireAdmin, requireLiveParticipant } from "./access.js";
import type { AssignmentManifest, BatchPayload, CompletionState, ProcessingState, SyncState } from "./contracts.provisional.js";
import type { Actor, Deps } from "./deps.js";
import { asJson, isUniqueViolation, one, sessionActivity } from "./db.js";
import { HttpError } from "./errors.js";
import { contentHash, sha256Hex } from "./hash.js";
import { settleQueuedAnalysis } from "./worker-lib.js";

interface AssignmentRow {
  id: string;
  revision: number;
  participant_id: string;
  org_id: string;
  manifest: unknown;
  manifest_hash: string;
  exposure_status: "unseen" | "seen" | "unknown";
}

interface SessionRow {
  id: string;
  org_id: string;
  participant_id: string;
  assignment_id: string;
  assignment_revision: number;
  started_at: Date | string;
  completion: CompletionState;
  sync_state: SyncState;
  processing_state: ProcessingState;
  request_hash: string;
  sealed_at: Date | string | null;
  session_revision: number;
  input_hash: string | null;
  participant_subject: string | null;
  deleted_at: Date | string | null;
}

interface JobRow {
  id: string;
  status: string;
  last_error: string | null;
  attempts: number;
}

function manifestOf(row: AssignmentRow): AssignmentManifest {
  return asJson<AssignmentManifest>(row.manifest);
}

export async function createAssignment(
  deps: Deps,
  actor: Actor,
  input: {
    id?: string;
    participantId: string;
    exposureStatus: "unseen" | "seen" | "unknown";
    manifest: AssignmentManifest;
  },
) {
  const participant = await requireLiveParticipant(deps, actor.orgId, input.participantId);
  await assertCanAssign(deps, actor, participant);
  const manifestHash = contentHash(input.manifest);
  return deps.db.transaction(async (tx) => {
    const txDeps = { ...deps, db: tx };
    if (!input.id) {
      const id = randomUUID();
      await tx.query(
        `INSERT INTO assignments (id, revision, org_id, participant_id, manifest, manifest_hash, exposure_status, created_by)
         VALUES ($1, 1, $2, $3, $4::jsonb, $5, $6, $7)`,
        [id, actor.orgId, participant.id, JSON.stringify(input.manifest), manifestHash, input.exposureStatus, actor.subject],
      );
      await audit(txDeps, actor, "assignment.create", "assignment", id, { revision: 1 });
      return { id, revision: 1, manifestHash, exposureStatus: input.exposureStatus, manifest: input.manifest, idempotent: false };
    }
    const latest = await one<AssignmentRow>(
      tx,
      `SELECT id, revision, participant_id, org_id, manifest, manifest_hash, exposure_status
       FROM assignments WHERE id = $1 AND org_id = $2 ORDER BY revision DESC LIMIT 1 FOR UPDATE`,
      [input.id, actor.orgId],
    );
    if (!latest) {
      await tx.query(
        `INSERT INTO assignments (id, revision, org_id, participant_id, manifest, manifest_hash, exposure_status, created_by)
         VALUES ($1, 1, $2, $3, $4::jsonb, $5, $6, $7)`,
        [input.id, actor.orgId, participant.id, JSON.stringify(input.manifest), manifestHash, input.exposureStatus, actor.subject],
      );
      await audit(txDeps, actor, "assignment.create", "assignment", input.id, { revision: 1 });
      return { id: input.id, revision: 1, manifestHash, exposureStatus: input.exposureStatus, manifest: input.manifest, idempotent: false };
    }
    if (latest.participant_id !== participant.id) {
      throw new HttpError(409, "conflict", "Assignment belongs to another participant.", { reason: "participant" });
    }
    if (latest.manifest_hash === manifestHash && latest.exposure_status === input.exposureStatus) {
      return {
        id: latest.id,
        revision: latest.revision,
        manifestHash,
        exposureStatus: latest.exposure_status,
        manifest: manifestOf(latest),
        idempotent: true,
      };
    }
    const revision = latest.revision + 1;
    await tx.query(
      `INSERT INTO assignments (id, revision, org_id, participant_id, manifest, manifest_hash, exposure_status, created_by)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)`,
      [input.id, revision, actor.orgId, participant.id, JSON.stringify(input.manifest), manifestHash, input.exposureStatus, actor.subject],
    );
    await audit(txDeps, actor, "assignment.revise", "assignment", input.id, { revision });
    return { id: input.id, revision, manifestHash, exposureStatus: input.exposureStatus, manifest: input.manifest, idempotent: false };
  });
}

async function lockSession(deps: Deps, actor: Actor, sessionId: string): Promise<SessionRow> {
  const session = await one<SessionRow>(
    deps.db,
    `SELECT s.id, s.org_id, s.participant_id, s.assignment_id, s.assignment_revision, s.started_at,
            s.completion, s.sync_state, s.processing_state, s.request_hash, s.sealed_at,
            s.session_revision, s.input_hash, p.subject AS participant_subject, p.deleted_at
     FROM sessions s
     JOIN participants p ON p.id = s.participant_id
     WHERE s.id = $1 AND s.org_id = $2
     FOR UPDATE`,
    [sessionId, actor.orgId],
  );
  if (!session || session.deleted_at) throw new HttpError(404, "not_found", "Not found.");
  return session;
}

function assertWriter(session: SessionRow, actor: Actor) {
  if (actor.role !== "participant" || session.participant_subject !== actor.subject) {
    throw new HttpError(404, "not_found", "Not found.");
  }
}

export async function putSession(
  deps: Deps,
  actor: Actor,
  sessionId: string,
  body: {
    participantId: string;
    assignmentId: string;
    assignmentRevision: number;
    startedAt: string;
    completion: CompletionState;
  },
) {
  const requestHash = contentHash(body);
  return deps.db.transaction(async (tx) => {
    const txDeps = { ...deps, db: tx };
    const existing = await one<SessionRow>(
      tx,
      `SELECT s.id, s.org_id, s.participant_id, s.assignment_id, s.assignment_revision, s.started_at,
              s.completion, s.sync_state, s.processing_state, s.request_hash, s.sealed_at,
              s.session_revision, s.input_hash, p.subject AS participant_subject, p.deleted_at
       FROM sessions s JOIN participants p ON p.id = s.participant_id
       WHERE s.id = $1 FOR UPDATE`,
      [sessionId],
    );
    if (existing && existing.org_id !== actor.orgId) throw new HttpError(404, "not_found", "Not found.");
    if (existing?.deleted_at) throw new HttpError(409, "conflict", "Participant is deleted.", { reason: "tombstone" });
    if (existing) {
      assertWriter(existing, actor);
      if (existing.request_hash === requestHash) return { ...presentSession(existing), idempotent: true };
      throw new HttpError(409, "conflict", "Session identifier was reused with different content.", { reason: "session_content" });
    }
    const participant = await requireLiveParticipant(txDeps, actor.orgId, body.participantId);
    if (actor.role !== "participant" || participant.subject !== actor.subject) {
      throw new HttpError(403, "forbidden", "Only the participant can start this session.");
    }
    const assignment = await one<AssignmentRow>(
      tx,
      `SELECT id, revision, participant_id, org_id, manifest, manifest_hash, exposure_status
       FROM assignments WHERE id = $1 AND revision = $2 AND org_id = $3`,
      [body.assignmentId, body.assignmentRevision, actor.orgId],
    );
    if (!assignment || assignment.participant_id !== participant.id) {
      throw new HttpError(404, "not_found", "Assignment not found.");
    }
    await tx.query(
      `INSERT INTO sessions (
         id, org_id, participant_id, assignment_id, assignment_revision, started_at,
         completion, sync_state, processing_state, request_hash
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'uploading', 'pending', $8)`,
      [sessionId, actor.orgId, participant.id, assignment.id, assignment.revision, body.startedAt, body.completion, requestHash],
    );
    const created = await lockSession(txDeps, actor, sessionId);
    return { ...presentSession(created), idempotent: false };
  });
}

function trialsIn(payload: BatchPayload): TrialRecord[] {
  return [...payload.trials, ...payload.practice.map((round) => round.trial)];
}

function assertBatchContract(sessionId: string, payload: BatchPayload, manifest: AssignmentManifest): SessionRecord {
  let record: SessionRecord;
  try {
    record = parseSessionRecord({ ...payload.shell, trials: payload.trials, practice: payload.practice });
  } catch {
    throw new HttpError(400, "validation", "Batch does not match the domain session contract.");
  }
  if (record.id !== sessionId) {
    throw new HttpError(400, "validation", "Session id does not match the batch.");
  }
  if (
    record.protocol !== manifest.protocol ||
    record.scorer !== manifest.scorer ||
    record.source !== manifest.source ||
    record.input !== manifest.input ||
    record.taskIds.some((taskId) => !manifest.taskIds.includes(taskId))
  ) {
    throw new HttpError(409, "conflict", "Batch does not match the assignment manifest.", { reason: "manifest" });
  }
  for (const trial of trialsIn(payload)) {
    const stimulusIds = new Set(trial.layout.stimuli.map((stimulus) => stimulus.id));
    const sequences = new Set<number>();
    for (const event of trial.events) {
      if (sequences.has(event.seq)) {
        throw new HttpError(400, "validation", "Duplicate response sequence in a trial.");
      }
      sequences.add(event.seq);
      if (event.elapsed < 0) throw new HttpError(400, "validation", "Negative elapsed time.");
      if (event.sessionId !== sessionId || event.trialId !== trial.id) {
        throw new HttpError(400, "validation", "Response event does not match its trial.");
      }
      if (event.stimulusId !== null && !stimulusIds.has(event.stimulusId)) {
        throw new HttpError(400, "validation", "Response references an unknown stimulus.");
      }
    }
  }
  return record;
}

export async function putBatch(deps: Deps, actor: Actor, sessionId: string, batchId: string, body: BatchPayload & { contentHash: string }) {
  const { contentHash: declaredHash, ...payload } = body;
  const actualHash = contentHash(payload);
  if (declaredHash !== actualHash) {
    throw new HttpError(400, "validation", "Batch hash does not match its content.", { reason: "hash" });
  }
  try {
    return await deps.db.transaction(async (tx) => {
      const txDeps = { ...deps, db: tx };
      const session = await lockSession(txDeps, actor, sessionId);
      assertWriter(session, actor);
      if (session.sealed_at) throw new HttpError(409, "conflict", "Session is sealed.", { reason: "sealed" });
      const existing = await one<{ content_hash: string }>(
        tx,
        "SELECT content_hash FROM batches WHERE session_id = $1 AND id = $2",
        [sessionId, batchId],
      );
      if (existing) {
        if (existing.content_hash === actualHash) return { batchId, sequence: payload.sequence, idempotent: true };
        throw new HttpError(409, "conflict", "Batch identifier was reused with different content.", { reason: "batch_content" });
      }
      const assignment = await one<AssignmentRow>(
        tx,
        `SELECT id, revision, participant_id, org_id, manifest, manifest_hash, exposure_status
         FROM assignments WHERE id = $1 AND revision = $2`,
        [session.assignment_id, session.assignment_revision],
      );
      if (!assignment) throw new HttpError(404, "not_found", "Assignment not found.");
      assertBatchContract(sessionId, payload, manifestOf(assignment));
      const maxRow = await one<{ max: number | null }>(tx, "SELECT MAX(sequence) AS max FROM batches WHERE session_id = $1", [sessionId]);
      const maxSequence = Number(maxRow?.max ?? 0);
      if (payload.sequence !== maxSequence + 1) {
        throw new HttpError(409, "conflict", "Batch sequence is not contiguous.", { reason: "sequence" });
      }
      if (payload.sequence === 1) {
        if (payload.parentBatchId !== null) {
          throw new HttpError(409, "conflict", "The first batch cannot name a parent.", { reason: "parent" });
        }
      } else {
        const parent = await one<{ id: string }>(
          tx,
          "SELECT id FROM batches WHERE session_id = $1 AND sequence = $2",
          [sessionId, payload.sequence - 1],
        );
        if (!parent || parent.id !== payload.parentBatchId) {
          throw new HttpError(409, "conflict", "Batch parent does not match the previous sequence.", { reason: "parent" });
        }
      }
      if (payload.sequence > 1) {
        const first = await one<{ payload: unknown }>(tx, "SELECT payload FROM batches WHERE session_id = $1 AND sequence = 1", [sessionId]);
        if (!first) throw new HttpError(409, "conflict", "Previous batch is missing.", { reason: "parent" });
        const firstPayload = asJson<BatchPayload>(first.payload);
        if (contentHash(firstPayload.shell) !== contentHash(payload.shell)) {
          throw new HttpError(409, "conflict", "Batch shell does not match the first batch.", { reason: "shell" });
        }
      }
      await tx.query(
        `INSERT INTO batches (id, session_id, sequence, parent_batch_id, content_hash, payload)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
        [batchId, sessionId, payload.sequence, payload.parentBatchId, actualHash, JSON.stringify(payload)],
      );
      for (const trial of trialsIn(payload)) {
        const trialHash = contentHash(trial);
        const stored = await one<{ content_hash: string }>(
          tx,
          "SELECT content_hash FROM trials WHERE session_id = $1 AND trial_id = $2",
          [sessionId, trial.id],
        );
        if (stored && stored.content_hash !== trialHash) {
          throw new HttpError(409, "conflict", "Trial was reused with different content.", { reason: "trial" });
        }
        if (!stored) {
          await tx.query(
            "INSERT INTO trials (session_id, trial_id, payload, content_hash) VALUES ($1, $2, $3::jsonb, $4)",
            [sessionId, trial.id, JSON.stringify(trial), trialHash],
          );
        }
        for (const event of trial.events) {
          const eventHash = contentHash(event);
          const storedEvent = await one<{ content_hash: string }>(
            tx,
            "SELECT content_hash FROM response_events WHERE session_id = $1 AND trial_id = $2 AND seq = $3",
            [sessionId, trial.id, event.seq],
          );
          if (storedEvent && storedEvent.content_hash !== eventHash) {
            throw new HttpError(409, "conflict", "Response sequence was reused with different content.", { reason: "event" });
          }
          if (!storedEvent) {
            await tx.query(
              `INSERT INTO response_events (session_id, trial_id, seq, elapsed_ms, object_id, kind, x, y, content_hash)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
              [sessionId, trial.id, event.seq, event.elapsed, event.stimulusId, event.type, event.x, event.y, eventHash],
            );
          }
        }
      }
      return { batchId, sequence: payload.sequence, idempotent: false };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new HttpError(409, "conflict", "Batch sequence or identifier conflicts with an existing batch.", { reason: "unique" });
    }
    throw error;
  }
}

export async function authorizeTrace(
  deps: Deps,
  actor: Actor,
  sessionId: string,
  body: { declaredByteCount: number; declaredExpandedBytes: number; declaredChecksum: string; contentType: string },
) {
  if (body.declaredByteCount > deps.config.traceMaxBytes || body.declaredExpandedBytes > deps.config.traceMaxExpandedBytes) {
    await deps.metrics.record("upload_failure");
    throw new HttpError(413, "payload_too_large", "Trace exceeds the configured size limit.");
  }
  return deps.db.transaction(async (tx) => {
    const txDeps = { ...deps, db: tx };
    const session = await lockSession(txDeps, actor, sessionId);
    assertWriter(session, actor);
    if (session.sealed_at) throw new HttpError(409, "conflict", "Session is sealed.", { reason: "sealed" });
    const traceId = randomUUID();
    const objectKey = `orgs/${actor.orgId}/sessions/${sessionId}/traces/${traceId}`;
    const expires = new Date(deps.now().getTime() + deps.config.traceTtlMs);
    await tx.query(
      `INSERT INTO trace_refs (
         id, session_id, org_id, object_key, declared_byte_count, declared_expanded_bytes,
         declared_checksum, content_type, status, expires_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'authorized', $9)`,
      [
        traceId,
        sessionId,
        actor.orgId,
        objectKey,
        body.declaredByteCount,
        body.declaredExpandedBytes,
        body.declaredChecksum,
        body.contentType,
        expires.toISOString(),
      ],
    );
    const upload =
      deps.objects.kind === "s3"
        ? {
            method: "PUT" as const,
            url: await deps.objects.presignPut(objectKey, body.contentType, Math.floor(deps.config.traceTtlMs / 1000), body.declaredByteCount),
            headers: { "content-type": body.contentType },
            adapter: "s3" as const,
            localOnly: false,
          }
        : {
            method: "PUT" as const,
            url: `/api/v1/sessions/${sessionId}/trace-uploads/${traceId}/content`,
            headers: { "content-type": body.contentType },
            adapter: deps.objects.kind,
            localOnly: true,
          };
    return { traceId, objectKey, expiresAt: expires.toISOString(), upload };
  });
}

export async function writeTraceContent(deps: Deps, actor: Actor, sessionId: string, traceId: string, bytes: Uint8Array) {
  const trace = await one<{
    object_key: string;
    declared_byte_count: number;
    declared_checksum: string;
    status: string;
    expires_at: Date | string;
    org_id: string;
  }>(deps.db, "SELECT object_key, declared_byte_count, declared_checksum, status, expires_at, org_id FROM trace_refs WHERE id = $1 AND session_id = $2", [
    traceId,
    sessionId,
  ]);
  if (!trace || trace.org_id !== actor.orgId) throw new HttpError(404, "not_found", "Not found.");
  const session = await one<SessionRow>(
    deps.db,
    `SELECT s.id, s.org_id, s.participant_id, s.assignment_id, s.assignment_revision, s.started_at,
            s.completion, s.sync_state, s.processing_state, s.request_hash, s.sealed_at,
            s.session_revision, s.input_hash, p.subject AS participant_subject, p.deleted_at
     FROM sessions s JOIN participants p ON p.id = s.participant_id
     WHERE s.id = $1 AND s.org_id = $2`,
    [sessionId, actor.orgId],
  );
  if (!session || session.deleted_at) throw new HttpError(404, "not_found", "Not found.");
  assertWriter(session, actor);
  if (session.sealed_at) throw new HttpError(409, "conflict", "Session is sealed.", { reason: "sealed" });
  if (new Date(trace.expires_at).getTime() <= deps.now().getTime()) {
    throw new HttpError(409, "conflict", "Trace upload authorization expired.", { reason: "expired" });
  }
  if (bytes.byteLength !== trace.declared_byte_count || bytes.byteLength > deps.config.traceMaxBytes) {
    await deps.metrics.record("upload_failure");
    throw new HttpError(413, "payload_too_large", "Trace size does not match the authorization.");
  }
  if (sha256Hex(bytes) !== trace.declared_checksum) {
    await deps.metrics.record("upload_failure");
    throw new HttpError(400, "validation", "Trace checksum does not match the authorization.", { reason: "checksum" });
  }
  await deps.objects.put(trace.object_key, bytes);
  await deps.db.query("UPDATE trace_refs SET status = 'uploaded', byte_count = $2, checksum = $3 WHERE id = $1", [
    traceId,
    bytes.byteLength,
    trace.declared_checksum,
  ]);
  return { traceId, status: "uploaded" as const };
}

interface TraceRow {
  id: string;
  object_key: string;
  declared_byte_count: number;
  declared_checksum: string;
  status: string;
  expires_at: Date | string | null;
}

function missingHasChecksum(error: HttpError): boolean {
  if (!error.details || typeof error.details !== "object" || !("missing" in error.details)) return false;
  const missing = (error.details as { missing?: unknown }).missing;
  return Array.isArray(missing) && missing.some((item) => {
    return Boolean(item) && typeof item === "object" && "reason" in item && item.reason === "checksum";
  });
}

export async function finalizeSession(deps: Deps, actor: Actor, sessionId: string) {
  try {
    return await deps.db.transaction(async (tx) => {
    const txDeps = { ...deps, db: tx };
    const session = await lockSession(txDeps, actor, sessionId);
    assertWriter(session, actor);
    if (session.sealed_at && session.input_hash) {
      const job = await one<{ id: string }>(
        tx,
        `SELECT id FROM jobs
         WHERE session_id = $1 AND kind = 'analysis' AND session_revision = $2 AND analysis_version = $3 AND input_hash = $4`,
        [sessionId, session.session_revision, ANALYSIS_VERSION, session.input_hash],
      );
      return {
        sessionId,
        sealed: true,
        idempotent: true,
        jobId: job?.id ?? null,
        inputHash: session.input_hash,
        processing: session.processing_state,
      };
    }
    const batches = await tx.query<{ sequence: number; id: string; content_hash: string; payload: unknown }>(
      "SELECT sequence, id, content_hash, payload FROM batches WHERE session_id = $1 ORDER BY sequence",
      [sessionId],
    );
    const traces = await tx.query<TraceRow>("SELECT id, object_key, declared_byte_count, declared_checksum, status, expires_at FROM trace_refs WHERE session_id = $1 AND status <> 'deleted' ORDER BY created_at", [
      sessionId,
    ]);
    const missing: Array<{ type: string; id?: string; reason: string }> = [];
    if (batches.rows.length === 0) missing.push({ type: "batch", reason: "missing" });
    for (let index = 0; index < batches.rows.length; index += 1) {
      const batch = batches.rows[index];
      if (!batch || batch.sequence !== index + 1) missing.push({ type: "batch_sequence", reason: "gap" });
    }
    const traceChecksums: string[] = [];
    for (const trace of traces.rows) {
      if (trace.status === "expired" || (trace.expires_at && new Date(trace.expires_at).getTime() <= deps.now().getTime() && trace.status === "authorized")) {
        missing.push({ type: "trace", id: trace.id, reason: "expired" });
        continue;
      }
      const bytes = await deps.objects.get(trace.object_key);
      if (!bytes) {
        missing.push({ type: "trace", id: trace.id, reason: "not_uploaded" });
        continue;
      }
      const checksum = sha256Hex(bytes);
      if (checksum !== trace.declared_checksum || bytes.byteLength !== trace.declared_byte_count || bytes.byteLength > deps.config.traceMaxBytes) {
        missing.push({ type: "trace", id: trace.id, reason: "checksum" });
        continue;
      }
      traceChecksums.push(checksum);
      await tx.query("UPDATE trace_refs SET status = 'verified', byte_count = $2, checksum = $3 WHERE id = $1", [
        trace.id,
        bytes.byteLength,
        checksum,
      ]);
    }
    if (missing.length > 0) {
      throw new HttpError(422, "missing_dependencies", "Finalization is missing dependencies.", { missing });
    }
    const ordered = batches.rows.map((batch) => asJson<BatchPayload>(batch.payload));
    const shell = ordered[0]?.shell;
    const trials = ordered.flatMap((batch) => batch.trials);
    const practice: PracticeRound[] = ordered.flatMap((batch) => batch.practice);
    let record: SessionRecord;
    try {
      record = parseSessionRecord({ ...shell, trials, practice });
    } catch {
      throw new HttpError(422, "missing_dependencies", "Finalization is missing dependencies.", {
        missing: [{ type: "session_record", reason: "invalid" }],
      });
    }
    const inputHash = contentHash({
      batches: batches.rows.map((batch) => batch.content_hash),
      traces: traceChecksums,
    });
    const jobId = randomUUID();
    await tx.query(
      `UPDATE sessions
       SET sealed_at = $2, session_revision = 1, input_hash = $3, sync_state = 'acknowledged', processing_state = 'pending'
       WHERE id = $1`,
      [sessionId, deps.now().toISOString(), inputHash],
    );
    await tx.query(
      `INSERT INTO session_documents (session_id, record, provenance)
       VALUES ($1, $2::jsonb, $3::jsonb)`,
      [
        sessionId,
        JSON.stringify(record),
        JSON.stringify({ contractsVersion: ANALYSIS_VERSION, sealedBy: actor.subject }),
      ],
    );
    await tx.query(
      `INSERT INTO jobs (id, session_id, kind, status, session_revision, analysis_version, input_hash, max_attempts)
       VALUES ($1, $2, 'analysis', 'queued', 1, $3, $4, $5)`,
      [jobId, sessionId, ANALYSIS_VERSION, inputHash, deps.config.maxJobAttempts],
    );
    return { sessionId, sealed: true, idempotent: false, jobId, inputHash, processing: "pending" as const };
    });
  } catch (error) {
    if (error instanceof HttpError && missingHasChecksum(error)) {
      await deps.metrics.record("upload_failure");
    }
    throw error;
  }
}

function presentSession(session: SessionRow) {
  return {
    id: session.id,
    participantId: session.participant_id,
    assignmentId: session.assignment_id,
    assignmentRevision: session.assignment_revision,
    startedAt: new Date(session.started_at).toISOString(),
    completion: session.completion,
    sync: session.sync_state,
    processing: session.processing_state,
    sealed: Boolean(session.sealed_at),
    sessionRevision: session.session_revision,
    inputHash: session.input_hash,
  };
}

async function processingView(deps: Deps, session: SessionRow) {
  const job = await one<JobRow>(
    deps.db,
    `SELECT id, status, last_error, attempts FROM jobs
     WHERE session_id = $1 AND kind = 'analysis'
     ORDER BY created_at DESC LIMIT 1`,
    [session.id],
  );
  return {
    state: session.processing_state,
    retryable: session.processing_state !== "failed" && session.processing_state !== "ready" && Boolean(job?.last_error),
    lastError: job?.last_error ?? null,
    jobStatus: job?.status ?? null,
  };
}

export async function readSession(deps: Deps, actor: Actor, sessionId: string) {
  const session = await one<SessionRow>(
    deps.db,
    `SELECT s.id, s.org_id, s.participant_id, s.assignment_id, s.assignment_revision, s.started_at,
            s.completion, s.sync_state, s.processing_state, s.request_hash, s.sealed_at,
            s.session_revision, s.input_hash, p.subject AS participant_subject, p.deleted_at
     FROM sessions s JOIN participants p ON p.id = s.participant_id
     WHERE s.id = $1 AND s.org_id = $2`,
    [sessionId, actor.orgId],
  );
  if (!session || session.deleted_at) throw new HttpError(404, "not_found", "Not found.");
  const participant = await requireLiveParticipant(deps, actor.orgId, session.participant_id);
  await assertMeasurementRead(deps, actor, participant);
  if (session.processing_state === "pending" || session.processing_state === "running") {
    try {
      const processing = await settleQueuedAnalysis(deps, sessionId);
      if (processing) session.processing_state = processing;
    } catch {
      /* Leave the stored processing state; the next read retries. */
    }
  }
  const document = await one<{ record: unknown; provenance: unknown }>(
    deps.db,
    "SELECT record, provenance FROM session_documents WHERE session_id = $1",
    [sessionId],
  );
  const batteryRow = await one<{ record: unknown }>(deps.db, "SELECT record FROM battery_records WHERE session_id = $1", [sessionId]);
  let record: SessionRecord | null = null;
  if (document) {
    try {
      record = parseSessionRecord(asJson(document.record));
    } catch {
      record = null;
    }
  }
  let battery: BatteryRecord | null = null;
  let score = null;
  if (batteryRow) {
    try {
      battery = parseBatteryRecord(asJson(batteryRow.record));
      const current = await scoringNormsForOrg(deps, actor);
      score = scoreBatteryRecord(applyScoringNorms(battery, current.norms));
    } catch {
      battery = asJson<BatteryRecord>(batteryRow.record);
    }
  }
  return {
    ...presentSession(session),
    processingDetail: await processingView(deps, session),
    record,
    battery,
    score,
  };
}

export async function readSummaries(deps: Deps, actor: Actor, sessionId: string) {
  const view = await readSession(deps, actor, sessionId);
  const summaries = await deps.db.query<{ summary: unknown }>(
    "SELECT summary FROM derived_summaries WHERE session_id = $1 ORDER BY created_at",
    [sessionId],
  );
  return {
    sessionId,
    processing: view.processingDetail,
    summaries: view.processing === "ready" || summaries.rows.length > 0 ? summaries.rows.map((row) => asJson(row.summary)) : [],
  };
}

export async function readTraceDownload(deps: Deps, actor: Actor, sessionId: string, traceId: string) {
  const view = await readSession(deps, actor, sessionId);
  const trace = await one<{ object_key: string; checksum: string | null; byte_count: number | null; status: string }>(
    deps.db,
    "SELECT object_key, checksum, byte_count, status FROM trace_refs WHERE id = $1 AND session_id = $2 AND org_id = $3",
    [traceId, sessionId, actor.orgId],
  );
  if (!trace || trace.status === "deleted" || trace.status === "expired") throw new HttpError(404, "not_found", "Not found.");
  if (deps.objects.kind === "s3") {
    return {
      sessionId: view.id,
      traceId,
      checksum: trace.checksum,
      byteCount: trace.byte_count,
      adapter: "s3" as const,
      url: await deps.objects.presignGet(trace.object_key, 60),
    };
  }
  return {
    sessionId: view.id,
    traceId,
    checksum: trace.checksum,
    byteCount: trace.byte_count,
    adapter: deps.objects.kind,
    localOnly: true,
    url: `/api/v1/sessions/${sessionId}/trace-uploads/${traceId}/content`,
  };
}

export async function readTraceBytes(deps: Deps, actor: Actor, sessionId: string, traceId: string) {
  await readSession(deps, actor, sessionId);
  const trace = await one<{ object_key: string; status: string }>(
    deps.db,
    "SELECT object_key, status FROM trace_refs WHERE id = $1 AND session_id = $2 AND org_id = $3",
    [traceId, sessionId, actor.orgId],
  );
  if (!trace || trace.status === "deleted" || trace.status === "expired") throw new HttpError(404, "not_found", "Not found.");
  const bytes = await deps.objects.get(trace.object_key);
  if (!bytes) throw new HttpError(404, "not_found", "Not found.");
  return bytes;
}

export async function exportParticipant(deps: Deps, actor: Actor, participantId: string) {
  const participant = await requireLiveParticipant(deps, actor.orgId, participantId);
  await assertMeasurementRead(deps, actor, participant);
  const sessions = await deps.db.query<{
    id: string;
    completion: string;
    processing_state: string;
    input_hash: string | null;
    assignment_id: string;
    assignment_revision: number;
  }>(
    `SELECT id, completion, processing_state, input_hash, assignment_id, assignment_revision
     FROM sessions WHERE participant_id = $1 AND org_id = $2 ORDER BY created_at`,
    [participantId, actor.orgId],
  );
  const items = [];
  for (const session of sessions.rows) {
    const document = await one<{ record: unknown; provenance: unknown }>(
      deps.db,
      "SELECT record, provenance FROM session_documents WHERE session_id = $1",
      [session.id],
    );
    const summaries = await deps.db.query<{ summary: unknown }>(
      "SELECT summary FROM derived_summaries WHERE session_id = $1 ORDER BY created_at",
      [session.id],
    );
    const assignment = await one<AssignmentRow>(
      deps.db,
      "SELECT id, revision, participant_id, org_id, manifest, manifest_hash, exposure_status FROM assignments WHERE id = $1 AND revision = $2",
      [session.assignment_id, session.assignment_revision],
    );
    const traces = await deps.db.query<{ id: string; checksum: string | null; byte_count: number | null; status: string }>(
      "SELECT id, checksum, byte_count, status FROM trace_refs WHERE session_id = $1",
      [session.id],
    );
    items.push({
      sessionId: session.id,
      completion: session.completion,
      processing: session.processing_state,
      inputHash: session.input_hash,
      record: document ? asJson(document.record) : null,
      summaries: summaries.rows.map((row) => asJson(row.summary)),
      assignment: assignment
        ? { id: assignment.id, revision: assignment.revision, manifestHash: assignment.manifest_hash, manifest: manifestOf(assignment) }
        : null,
      traces: traces.rows.map((trace) => ({
        id: trace.id,
        checksum: trace.checksum,
        byteCount: trace.byte_count,
        status: trace.status,
      })),
    });
  }
  const provenance = {
    exportedAt: deps.now().toISOString(),
    exportedBy: actor.subject,
    orgId: actor.orgId,
    analysisVersion: ANALYSIS_VERSION,
    note: "Bundle contains authorized observations, assignment snapshots, and summaries. It does not contain signed URLs.",
  };
  const bundle = {
    version: 1,
    participant: { id: participant.id, label: participant.label },
    sessions: items,
    provenance,
  };
  const exportId = randomUUID();
  await deps.db.query(
    `INSERT INTO exports (id, org_id, participant_id, requested_by, bundle, provenance)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)`,
    [exportId, actor.orgId, participant.id, actor.subject, JSON.stringify(bundle), JSON.stringify(provenance)],
  );
  await audit(deps, actor, "export", "participant", participant.id, { exportId });
  return { exportId, bundle };
}

export async function deleteSession(deps: Deps, actor: Actor, sessionId: string) {
  const traces = await deps.db.transaction(async (tx) => {
    const txDeps = { ...deps, db: tx };
    const session = await one<SessionRow>(
      tx,
      `SELECT s.id, s.org_id, s.participant_id, s.assignment_id, s.assignment_revision, s.started_at,
              s.completion, s.sync_state, s.processing_state, s.request_hash, s.sealed_at,
              s.session_revision, s.input_hash, p.subject AS participant_subject, p.deleted_at
       FROM sessions s
       JOIN participants p ON p.id = s.participant_id
       WHERE s.id = $1 AND s.org_id = $2
       FOR UPDATE`,
      [sessionId, actor.orgId],
    );
    if (!session || session.deleted_at) {
      return { sessionId, deleted: true as const, idempotent: true as const, traces: [] as Array<{ object_key: string }> };
    }
    assertWriter(session, actor);
    const storedTraces = await tx.query<{ object_key: string }>("SELECT object_key FROM trace_refs WHERE session_id = $1", [
      sessionId,
    ]);
    await tx.query("DELETE FROM response_events WHERE session_id = $1", [sessionId]);
    await tx.query("DELETE FROM gaze_samples WHERE session_id = $1", [sessionId]);
    await tx.query("DELETE FROM trials WHERE session_id = $1", [sessionId]);
    await tx.query("DELETE FROM batches WHERE session_id = $1", [sessionId]);
    await tx.query("DELETE FROM derived_summaries WHERE session_id = $1", [sessionId]);
    await tx.query("DELETE FROM session_documents WHERE session_id = $1", [sessionId]);
    await tx.query("DELETE FROM battery_records WHERE session_id = $1", [sessionId]);
    await tx.query("DELETE FROM jobs WHERE session_id = $1", [sessionId]);
    await tx.query("DELETE FROM trace_refs WHERE session_id = $1", [sessionId]);
    await tx.query("DELETE FROM sessions WHERE id = $1", [sessionId]);
    await audit(txDeps, actor, "delete", "session", sessionId, { participantId: session.participant_id });
    return { sessionId, deleted: true as const, idempotent: false as const, traces: storedTraces.rows };
  });
  for (const trace of traces.traces) await deps.objects.delete(trace.object_key);
  return { sessionId: traces.sessionId, deleted: traces.deleted, idempotent: traces.idempotent };
}

export async function deleteParticipant(deps: Deps, actor: Actor, participantId: string) {
  requireAdmin(actor);
  return deps.db.transaction(async (tx) => {
    const txDeps = { ...deps, db: tx };
    const participant = await one<{ id: string; deleted_at: Date | string | null }>(
      tx,
      "SELECT id, deleted_at FROM participants WHERE id = $1 AND org_id = $2 FOR UPDATE",
      [participantId, actor.orgId],
    );
    if (!participant) throw new HttpError(404, "not_found", "Not found.");
    if (participant.deleted_at) {
      return { participantId, deleted: true, idempotent: true };
    }
    await tx.query("UPDATE participants SET deleted_at = $2 WHERE id = $1", [participantId, deps.now().toISOString()]);
    await tx.query(
      `UPDATE jobs SET status = 'cancelled', lease_owner = NULL, lease_expires_at = NULL, updated_at = $2
       WHERE kind = 'analysis' AND status IN ('queued', 'leased', 'failed')
         AND session_id IN (SELECT id FROM sessions WHERE participant_id = $1)`,
      [participantId, deps.now().toISOString()],
    );
    const sessions = await tx.query<{ id: string; session_revision: number; input_hash: string | null }>(
      "SELECT id, session_revision, input_hash FROM sessions WHERE participant_id = $1",
      [participantId],
    );
    for (const session of sessions.rows) {
      const cleanupHash = `cleanup:${participantId}:${session.id}`;
      try {
        await tx.query(
          `INSERT INTO jobs (id, session_id, kind, status, session_revision, analysis_version, input_hash, max_attempts)
           VALUES ($1, $2, 'cleanup', 'queued', $3, 'cleanup-1', $4, $5)`,
          [randomUUID(), session.id, session.session_revision, cleanupHash, deps.config.maxJobAttempts],
        );
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
      }
    }
    await audit(txDeps, actor, "delete", "participant", participantId, {});
    return { participantId, deleted: true, idempotent: false };
  });
}

export async function createParticipant(deps: Deps, actor: Actor, input: { id?: string; label: string; subject?: string }) {
  requireAdmin(actor);
  const id = input.id ?? randomUUID();
  try {
    await deps.db.query("INSERT INTO participants (id, org_id, label, subject) VALUES ($1, $2, $3, $4)", [
      id,
      actor.orgId,
      input.label,
      input.subject ?? null,
    ]);
  } catch (error) {
    if (isUniqueViolation(error)) throw new HttpError(409, "conflict", "Participant identifier or subject already exists.", { reason: "participant" });
    throw error;
  }
  await audit(deps, actor, "participant.create", "participant", id, {});
  return { id, label: input.label, subject: input.subject ?? null };
}

export async function createMembership(deps: Deps, actor: Actor, input: { subject: string; role: "admin" | "reviewer" | "participant" }) {
  requireAdmin(actor);
  await deps.db.query("INSERT INTO identities (subject) VALUES ($1) ON CONFLICT (subject) DO NOTHING", [input.subject]);
  try {
    await deps.db.query(
      `INSERT INTO memberships (org_id, subject, role) VALUES ($1, $2, $3)
       ON CONFLICT (org_id, subject) DO UPDATE SET role = EXCLUDED.role, revoked_at = NULL`,
      [actor.orgId, input.subject, input.role],
    );
  } catch (error) {
    if (isUniqueViolation(error)) throw new HttpError(409, "conflict", "Membership already exists.", { reason: "membership" });
    throw error;
  }
  await audit(deps, actor, "membership.upsert", "membership", input.subject, { role: input.role });
  return { subject: input.subject, role: input.role, orgId: actor.orgId };
}

export async function revokeMembership(deps: Deps, actor: Actor, subject: string) {
  requireAdmin(actor);
  const updated = await deps.db.query(
    "UPDATE memberships SET revoked_at = $3 WHERE org_id = $1 AND subject = $2 AND revoked_at IS NULL",
    [actor.orgId, subject, deps.now().toISOString()],
  );
  await deps.db.query("DELETE FROM app_sessions WHERE org_id = $1 AND subject = $2", [actor.orgId, subject]);
  await audit(deps, actor, "membership.revoke", "membership", subject, {});
  return { subject, revoked: (updated.rows?.length ?? 0) >= 0 };
}

export async function assignReviewer(deps: Deps, actor: Actor, input: { subject: string; participantId: string }) {
  requireAdmin(actor);
  await requireLiveParticipant(deps, actor.orgId, input.participantId);
  const reviewer = await one<{ role: string }>(
    deps.db,
    "SELECT role FROM memberships WHERE org_id = $1 AND subject = $2 AND revoked_at IS NULL",
    [actor.orgId, input.subject],
  );
  if (!reviewer || reviewer.role !== "reviewer") {
    throw new HttpError(400, "validation", "Subject is not an active reviewer in this organization.");
  }
  await deps.db.query(
    `INSERT INTO reviewer_assignments (org_id, subject, participant_id) VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING`,
    [actor.orgId, input.subject, input.participantId],
  );
  await audit(deps, actor, "reviewer.assign", "participant", input.participantId, { subject: input.subject });
  return { subject: input.subject, participantId: input.participantId };
}

export async function listParticipants(deps: Deps, actor: Actor) {
  const rows = await deps.db.query<{ id: string; label: string }>(
    `SELECT p.id, p.label
     FROM participants p
     WHERE p.org_id = $1 AND p.deleted_at IS NULL
       AND (
         $2 = 'admin'
         OR ($2 = 'reviewer' AND EXISTS (
           SELECT 1 FROM reviewer_assignments ra
           WHERE ra.org_id = p.org_id AND ra.subject = $3 AND ra.participant_id = p.id
         ))
         OR ($2 = 'participant' AND p.subject = $3)
       )
     ORDER BY p.created_at, p.id`,
    [actor.orgId, actor.role, actor.subject],
  );
  return rows.rows.map((row) => ({ id: row.id, label: row.label }));
}

export function shouldPersistBattery(record: BatteryRecord): boolean {
  return record.mode === "full" && record.source === "live";
}

function batteryManifest(record: BatteryRecord): AssignmentManifest {
  return {
    protocol: record.contract,
    scorer: "battery-events-v1",
    taskIds: ["target-selection", "line-bisection"],
    source: record.source,
    input: "mouse-trackpad",
    accessibilityId: "battery",
    configHash: record.id,
  };
}

function batteryTrials(record: BatteryRecord): Array<{
  trialId: string;
  payload: unknown;
  events: Array<{ seq: number; elapsed: number; x: number; y: number; kind: string; objectId: string | null }>;
}> {
  const trials: Array<{
    trialId: string;
    payload: unknown;
    events: Array<{ seq: number; elapsed: number; x: number; y: number; kind: string; objectId: string | null }>;
  }> = [
    {
      trialId: `${record.id}-scene`,
      payload: { task: "scene", taps: record.scene.taps },
      events: record.scene.taps.map((tap, index) => ({
        seq: index + 1,
        elapsed: tap.t,
        x: tap.x,
        y: tap.y,
        kind: "background",
        objectId: null,
      })),
    },
    {
      trialId: `${record.id}-clock`,
      payload: { task: "clock", trials: record.clock.trials, responses: record.clock.responses },
      events: record.clock.responses.map((response, index) => ({
        seq: index + 1,
        elapsed: response.rtMs ?? 0,
        x: response.choice === "top" ? 0 : response.choice === "bottom" ? 1 : -1,
        y: 0,
        kind: "target",
        objectId: response.trialId,
      })),
    },
  ];
  if (record.greyscales) {
    trials.push({
      trialId: `${record.id}-greyscales`,
      payload: { task: "greyscales", trials: record.greyscales.trials, responses: record.greyscales.responses },
      events: record.greyscales.responses.map((response, index) => ({
        seq: index + 1,
        elapsed: response.rtMs ?? 0,
        x: response.choice === "top" ? 0 : response.choice === "bottom" ? 1 : -1,
        y: 0,
        kind: "target",
        objectId: response.trialId,
      })),
    });
  }
  if (record.bisection) {
    trials.push({
      trialId: `${record.id}-bisection`,
      payload: { task: "line-bisection", lines: record.bisection.lines, responses: record.bisection.responses },
      events: record.bisection.responses.map((response, index) => {
        const line = record.bisection?.lines.find((item) => item.id === response.lineId);
        return {
          seq: index + 1,
          elapsed: index * 1000,
          x: response.x ?? 0,
          y: line?.y ?? 0,
          kind: "bisection",
          objectId: response.lineId,
        };
      }),
    });
  }
  if (record.detection) {
    trials.push({
      trialId: `${record.id}-detection`,
      payload: { task: "detection", left: record.detection.left, right: record.detection.right },
      events: [
        {
          seq: 1,
          elapsed: 0,
          x: record.detection.left.hits,
          y: record.detection.left.targets,
          kind: "target",
          objectId: "left",
        },
        {
          seq: 2,
          elapsed: 0,
          x: record.detection.right.hits,
          y: record.detection.right.targets,
          kind: "target",
          objectId: "right",
        },
      ],
    });
  }
  if (record.cancellation) {
    trials.push({
      trialId: `${record.id}-cancellation`,
      payload: { task: "cancellation", left: record.cancellation.left, right: record.cancellation.right },
      events: [
        {
          seq: 1,
          elapsed: 0,
          x: record.cancellation.left.omissions,
          y: record.cancellation.left.targets,
          kind: "target",
          objectId: "left",
        },
        {
          seq: 2,
          elapsed: 0,
          x: record.cancellation.right.omissions,
          y: record.cancellation.right.targets,
          kind: "target",
          objectId: "right",
        },
      ],
    });
  }
  return trials;
}

async function loadOrgBatteries(deps: Deps, orgId: string): Promise<BatteryRecord[]> {
  const rows = await deps.db.query<{ record: unknown }>(
    `SELECT b.record
     FROM battery_records b
     JOIN sessions s ON s.id = b.session_id
     JOIN participants p ON p.id = s.participant_id
     WHERE s.org_id = $1 AND p.deleted_at IS NULL
     ORDER BY s.started_at, s.id`,
    [orgId],
  );
  const records: BatteryRecord[] = [];
  for (const row of rows.rows) {
    try {
      records.push(parseBatteryRecord(asJson(row.record)));
    } catch {
      /* skip rows that are not domain battery records */
    }
  }
  return records;
}

export async function scoringNormsForOrg(deps: Deps, actor: Actor) {
  const batteries = await loadOrgBatteries(deps, actor.orgId);
  const fitted = scoringNormsFromBatteries(batteries);
  return {
    n: fitted.n,
    source: fitted.source,
    norms: fitted.norms,
    notice: fitted.source === "fitted" ? fittedNormNotice(fitted.n) : ASSUMED_NORM_NOTICE,
  };
}

export async function putBattery(deps: Deps, actor: Actor, sessionId: string, raw: unknown) {
  let record: BatteryRecord;
  try {
    record = parseBatteryRecord({ ...(raw as object), id: sessionId });
  } catch {
    throw new HttpError(400, "validation", "Battery record does not match the contract.");
  }
  if (record.id !== sessionId) {
    throw new HttpError(400, "validation", "Battery id does not match the session.");
  }
  if (!shouldPersistBattery(record)) {
    throw new HttpError(400, "validation", "The hidden scene demo is not saved.");
  }
  const currentNorms = await scoringNormsForOrg(deps, actor);
  record = applyScoringNorms(record, currentNorms.norms);
  const bound = await one<{ id: string; subject: string | null }>(
    deps.db,
    "SELECT id, subject FROM participants WHERE org_id = $1 AND subject = $2 AND deleted_at IS NULL",
    [actor.orgId, actor.subject],
  );
  if (!bound || actor.role !== "participant") {
    throw new HttpError(403, "forbidden", "Only the participant can store this battery.");
  }
  const participant = await requireLiveParticipant(deps, actor.orgId, bound.id);
  const manifest = batteryManifest(record);
  const assignment = await createAssignment(deps, actor, {
    id: `assign-battery-${participant.id}`,
    participantId: participant.id,
    exposureStatus: "seen",
    manifest,
  });
  return deps.db.transaction(async (tx) => {
    const txDeps = { ...deps, db: tx };
    const existing = await one<{ id: string; request_hash: string; sealed_at: Date | string | null }>(
      tx,
      "SELECT id, request_hash, sealed_at FROM sessions WHERE id = $1 FOR UPDATE",
      [sessionId],
    );
    const requestHash = contentHash(record);
    const storedBattery = await one<{ record: unknown }>(tx, "SELECT record FROM battery_records WHERE session_id = $1", [
      sessionId,
    ]);
    if (storedBattery) {
      if (contentHash(asJson(storedBattery.record)) === requestHash) {
        return { sessionId, sealed: Boolean(existing?.sealed_at), idempotent: true, battery: true };
      }
      throw new HttpError(409, "conflict", "Session identifier was reused with different content.", { reason: "battery_content" });
    }
    if (existing) {
      await insertBatteryRows(tx, sessionId, record, { writeDocument: false, writeSummary: false });
      await audit(txDeps, actor, "battery.store", "session", sessionId, { mode: record.mode, attached: true });
      return { sessionId, sealed: Boolean(existing.sealed_at), idempotent: false, battery: true };
    }
    await tx.query(
      `INSERT INTO sessions (
         id, org_id, participant_id, assignment_id, assignment_revision, started_at,
         completion, sync_state, processing_state, request_hash, sealed_at, session_revision, input_hash
       ) VALUES ($1, $2, $3, $4, $5, $6, 'complete', 'acknowledged', 'ready', $7, $8, 1, $7)`,
      [
        sessionId,
        actor.orgId,
        participant.id,
        assignment.id,
        assignment.revision,
        record.startedAt,
        requestHash,
        deps.now().toISOString(),
      ],
    );
    await insertBatteryRows(tx, sessionId, record, { writeDocument: true, writeSummary: true, actorSubject: actor.subject });
    await audit(txDeps, actor, "battery.store", "session", sessionId, { mode: record.mode });
    return { sessionId, sealed: true, idempotent: false, battery: true };
  });
}

async function insertBatteryRows(
  tx: Deps["db"],
  sessionId: string,
  record: BatteryRecord,
  options: { writeDocument: boolean; writeSummary: boolean; actorSubject?: string },
) {
  for (const trial of batteryTrials(record)) {
    const trialHash = contentHash(trial.payload);
    const stored = await one<{ content_hash: string }>(
      tx,
      "SELECT content_hash FROM trials WHERE session_id = $1 AND trial_id = $2",
      [sessionId, trial.trialId],
    );
    if (stored && stored.content_hash !== trialHash) {
      throw new HttpError(409, "conflict", "Trial was reused with different content.", { reason: "trial" });
    }
    if (!stored) {
      await tx.query("INSERT INTO trials (session_id, trial_id, payload, content_hash) VALUES ($1, $2, $3::jsonb, $4)", [
        sessionId,
        trial.trialId,
        JSON.stringify(trial.payload),
        trialHash,
      ]);
    }
    for (const event of trial.events) {
      const eventHash = contentHash(event);
      const storedEvent = await one<{ content_hash: string }>(
        tx,
        "SELECT content_hash FROM response_events WHERE session_id = $1 AND trial_id = $2 AND seq = $3",
        [sessionId, trial.trialId, event.seq],
      );
      if (storedEvent && storedEvent.content_hash !== eventHash) {
        throw new HttpError(409, "conflict", "Response sequence was reused with different content.", { reason: "event" });
      }
      if (!storedEvent) {
        await tx.query(
          `INSERT INTO response_events (session_id, trial_id, seq, elapsed_ms, object_id, kind, x, y, content_hash)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [sessionId, trial.trialId, event.seq, event.elapsed, event.objectId, event.kind, event.x, event.y, eventHash],
        );
      }
    }
  }
  await tx.query("INSERT INTO battery_records (session_id, record) VALUES ($1, $2::jsonb)", [sessionId, JSON.stringify(record)]);
  if (options.writeDocument) {
    await tx.query(
      `INSERT INTO session_documents (session_id, record, provenance)
       VALUES ($1, $2::jsonb, $3::jsonb)
       ON CONFLICT (session_id) DO NOTHING`,
      [
        sessionId,
        JSON.stringify(record),
        JSON.stringify({ kind: "battery", contractsVersion: record.contract, sealedBy: options.actorSubject ?? "" }),
      ],
    );
  }
  if (options.writeSummary) {
    const scored = scoreBatteryRecord(record);
    await tx.query(
      `INSERT INTO derived_summaries (id, session_id, analysis_version, input_hash, session_revision, summary)
       VALUES ($1, $2, $3, $4, 1, $5::jsonb)
       ON CONFLICT (session_id, session_revision, analysis_version, input_hash) DO NOTHING`,
      [
        randomUUID(),
        sessionId,
        ANALYSIS_VERSION,
        contentHash(record),
        JSON.stringify({
          stub: false,
          analysisVersion: ANALYSIS_VERSION,
          inputHash: contentHash(record),
          sessionRevision: 1,
          scoring: scored,
          gazeAnalysis: { version: ANALYSIS_VERSION, trials: [] },
          eligibility: { click: true, gaze: false, reasons: ["no_gaze_trace"], groupKey: record.contract },
          provenance: { contractsVersion: record.contract, source: record.source },
        }),
      ],
    );
  }
}

export async function listSessions(deps: Deps, actor: Actor) {
  const rows = await deps.db.query<{
    id: string;
    started_at: Date | string;
    completion: CompletionState;
    processing_state: ProcessingState;
    record: unknown;
    battery: unknown;
    participant_id: string;
  }>(
    `SELECT s.id, s.started_at, s.completion, s.processing_state, d.record, b.record AS battery, s.participant_id
     FROM sessions s
     JOIN participants p ON p.id = s.participant_id
     LEFT JOIN session_documents d ON d.session_id = s.id
     LEFT JOIN battery_records b ON b.session_id = s.id
     WHERE s.org_id = $1 AND p.deleted_at IS NULL
       AND (
         ($2 = 'participant' AND p.subject = $3)
         OR ($2 = 'reviewer' AND EXISTS (
           SELECT 1 FROM reviewer_assignments ra
           WHERE ra.org_id = s.org_id AND ra.subject = $3 AND ra.participant_id = s.participant_id
         ))
       )
     ORDER BY s.started_at DESC`,
    [actor.orgId, actor.role, actor.subject],
  );
  const sessions: SessionRecord[] = [];
  const batteries: BatteryRecord[] = [];
  for (const row of rows.rows) {
    if (row.battery) {
      try {
        batteries.push(parseBatteryRecord(asJson(row.battery)));
      } catch {
        /* skip rows that are not domain battery records */
      }
    }
    if (row.record) {
      try {
        sessions.push(parseSessionRecord(asJson(row.record)));
      } catch {
        /* skip rows that are not domain session records */
      }
    }
  }
  return {
    sessions,
    batteries,
    activity: await sessionActivity(deps.db, actor.orgId),
  };
}
