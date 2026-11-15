import { randomUUID } from "node:crypto";
import { parseSessionRecord, type SessionRecord } from "@neurovision/domain";
import { ANALYSIS_VERSION, buildDerivedSummary } from "./analysis.js";
import type { CompletionState, ProcessingState } from "./contracts.provisional.js";
import type { Deps } from "./deps.js";
import { asJson, many, one } from "./db.js";

export { ANALYSIS_VERSION, buildDerivedSummary } from "./analysis.js";

export interface WorkerDeps extends Deps {
  workerId: string;
}

interface JobRow {
  id: string;
  session_id: string;
  kind: "analysis" | "cleanup";
  status: string;
  session_revision: number;
  analysis_version: string;
  input_hash: string;
  attempts: number;
  max_attempts: number;
}

export async function recoverExpiredLeases(deps: WorkerDeps): Promise<number> {
  const rows = await deps.db.query<{ id: string }>(
    `UPDATE jobs
     SET status = 'queued', lease_owner = NULL, lease_expires_at = NULL, updated_at = $2
     WHERE status = 'leased' AND lease_expires_at <= $1
     RETURNING id`,
    [deps.now().toISOString(), deps.now().toISOString()],
  );
  return rows.rows.length;
}

export async function sweepOrphanUploads(deps: WorkerDeps): Promise<number> {
  const traces = await many<{ id: string; object_key: string }>(
    deps.db,
    `SELECT id, object_key FROM trace_refs
     WHERE status = 'authorized' AND expires_at IS NOT NULL AND expires_at <= $1`,
    [deps.now().toISOString()],
  );
  for (const trace of traces) {
    await deps.objects.delete(trace.object_key);
    await deps.db.query("UPDATE trace_refs SET status = 'expired' WHERE id = $1 AND status = 'authorized'", [trace.id]);
  }
  return traces.length;
}

async function leaseNext(deps: WorkerDeps): Promise<JobRow | null> {
  const expires = new Date(deps.now().getTime() + deps.config.leaseMs).toISOString();
  return one<JobRow>(
    deps.db,
    `UPDATE jobs
     SET status = 'leased', lease_owner = $1, lease_expires_at = $2, attempts = attempts + 1, updated_at = $3
     WHERE id = (
       SELECT id FROM jobs
       WHERE status = 'queued'
       ORDER BY created_at
       FOR UPDATE SKIP LOCKED
       LIMIT 1
     )
     RETURNING id, session_id, kind, status, session_revision, analysis_version, input_hash, attempts, max_attempts`,
    [deps.workerId, expires, deps.now().toISOString()],
  );
}

async function failJob(deps: WorkerDeps, job: JobRow, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : "Analysis failed.";
  const safeMessage = message.slice(0, 300);
  if (job.attempts < job.max_attempts) {
    await deps.db.query(
      `UPDATE jobs
       SET status = 'queued', lease_owner = NULL, lease_expires_at = NULL, last_error = $2, updated_at = $3
       WHERE id = $1 AND status <> 'cancelled'`,
      [job.id, safeMessage, deps.now().toISOString()],
    );
    await deps.db.query(
      `UPDATE sessions SET processing_state = 'pending'
       WHERE id = $1 AND processing_state <> 'ready'`,
      [job.session_id],
    );
  } else {
    await deps.db.query(
      `UPDATE jobs
       SET status = 'failed', lease_owner = NULL, lease_expires_at = NULL, last_error = $2, updated_at = $3
       WHERE id = $1 AND status <> 'cancelled'`,
      [job.id, safeMessage, deps.now().toISOString()],
    );
    await deps.db.query(
      `UPDATE sessions SET processing_state = 'failed'
       WHERE id = $1 AND processing_state <> 'ready'`,
      [job.session_id],
    );
  }
  await deps.metrics.record("analysis_failure");
}

async function runAnalysis(deps: WorkerDeps, job: JobRow): Promise<void> {
  await deps.db.query(
    `UPDATE sessions SET processing_state = 'running'
     WHERE id = $1 AND processing_state IN ('pending', 'failed')`,
    [job.session_id],
  );
  await deps.db.transaction(async (tx) => {
    const current = await one<{ status: string }>(tx, "SELECT status FROM jobs WHERE id = $1 FOR UPDATE", [job.id]);
    if (!current || current.status === "cancelled" || current.status === "succeeded") return;
    const session = await one<{ completion: CompletionState; deleted_at: Date | string | null; processing_state: string }>(
      tx,
      `SELECT s.completion, p.deleted_at, s.processing_state
       FROM sessions s JOIN participants p ON p.id = s.participant_id
       WHERE s.id = $1 FOR UPDATE`,
      [job.session_id],
    );
    if (!session) throw new Error("Sealed session is missing.");
    if (session.deleted_at) {
      await tx.query(
        `UPDATE jobs SET status = 'cancelled', lease_owner = NULL, lease_expires_at = NULL, updated_at = $2
         WHERE id = $1`,
        [job.id, deps.now().toISOString()],
      );
      return;
    }
    const existing = await one<{ id: string }>(
      tx,
      `SELECT id FROM derived_summaries
       WHERE session_id = $1 AND session_revision = $2 AND analysis_version = $3 AND input_hash = $4`,
      [job.session_id, job.session_revision, job.analysis_version, job.input_hash],
    );
    if (existing) {
      await tx.query(
        `UPDATE jobs SET status = 'succeeded', lease_owner = NULL, lease_expires_at = NULL, updated_at = $2 WHERE id = $1`,
        [job.id, deps.now().toISOString()],
      );
      await tx.query("UPDATE sessions SET processing_state = 'ready' WHERE id = $1", [job.session_id]);
      return;
    }
    const document = await one<{ record: unknown }>(tx, "SELECT record FROM session_documents WHERE session_id = $1", [job.session_id]);
    if (!document) throw new Error("Sealed session has no document.");
    const record = parseSessionRecord(asJson<SessionRecord>(document.record));
    const tombstone = await one<{ deleted_at: Date | string | null }>(
      tx,
      `SELECT p.deleted_at FROM sessions s JOIN participants p ON p.id = s.participant_id WHERE s.id = $1`,
      [job.session_id],
    );
    if (tombstone?.deleted_at) {
      await tx.query(
        `UPDATE jobs SET status = 'cancelled', lease_owner = NULL, lease_expires_at = NULL, updated_at = $2 WHERE id = $1`,
        [job.id, deps.now().toISOString()],
      );
      return;
    }
    const traceRows = await many<{ object_key: string }>(
      tx,
      `SELECT object_key FROM trace_refs WHERE session_id = $1 AND status = 'verified' ORDER BY created_at`,
      [job.session_id],
    );
    const traces: Uint8Array[] = [];
    for (const trace of traceRows) {
      traces.push((await deps.objects.get(trace.object_key)) ?? new Uint8Array());
    }
    const summary = buildDerivedSummary({
      record,
      completion: session.completion,
      inputHash: job.input_hash,
      sessionRevision: job.session_revision,
      traces,
    });
    if (summary.analysisVersion !== ANALYSIS_VERSION) {
      throw new Error("Analysis version drifted.");
    }
    await tx.query(
      `INSERT INTO derived_summaries (id, session_id, analysis_version, input_hash, session_revision, summary)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [randomUUID(), job.session_id, job.analysis_version, job.input_hash, job.session_revision, JSON.stringify(summary)],
    );
    await tx.query(
      `UPDATE jobs SET status = 'succeeded', lease_owner = NULL, lease_expires_at = NULL, last_error = NULL, updated_at = $2
       WHERE id = $1`,
      [job.id, deps.now().toISOString()],
    );
    await tx.query("UPDATE sessions SET processing_state = 'ready' WHERE id = $1", [job.session_id]);
  });
}

async function runCleanup(deps: WorkerDeps, job: JobRow): Promise<void> {
  const traces = await deps.db.transaction(async (tx) => {
    const current = await one<{ status: string }>(tx, "SELECT status FROM jobs WHERE id = $1 FOR UPDATE", [job.id]);
    if (!current || current.status === "cancelled" || current.status === "succeeded") return [] as Array<{ object_key: string }>;
    const participant = await one<{ deleted_at: Date | string | null }>(
      tx,
      `SELECT p.deleted_at FROM sessions s JOIN participants p ON p.id = s.participant_id WHERE s.id = $1 FOR UPDATE`,
      [job.session_id],
    );
    if (!participant?.deleted_at) {
      await tx.query(
        `UPDATE jobs SET status = 'cancelled', lease_owner = NULL, lease_expires_at = NULL, updated_at = $2 WHERE id = $1`,
        [job.id, deps.now().toISOString()],
      );
      return [] as Array<{ object_key: string }>;
    }
    const rows = await many<{ object_key: string }>(tx, "SELECT object_key FROM trace_refs WHERE session_id = $1", [job.session_id]);
    await tx.query("DELETE FROM response_events WHERE session_id = $1", [job.session_id]);
    await tx.query("DELETE FROM trials WHERE session_id = $1", [job.session_id]);
    await tx.query("DELETE FROM batches WHERE session_id = $1", [job.session_id]);
    await tx.query("DELETE FROM derived_summaries WHERE session_id = $1", [job.session_id]);
    await tx.query("DELETE FROM session_documents WHERE session_id = $1", [job.session_id]);
    await tx.query("UPDATE trace_refs SET status = 'deleted', byte_count = NULL, checksum = NULL WHERE session_id = $1", [job.session_id]);
    await tx.query(
      `UPDATE jobs SET status = 'succeeded', lease_owner = NULL, lease_expires_at = NULL, updated_at = $2 WHERE id = $1`,
      [job.id, deps.now().toISOString()],
    );
    return rows;
  });
  for (const trace of traces) await deps.objects.delete(trace.object_key);
}

export async function runJob(deps: WorkerDeps, job: JobRow): Promise<void> {
  try {
    if (job.kind === "analysis") await runAnalysis(deps, job);
    else if (job.kind === "cleanup") await runCleanup(deps, job);
    else throw new Error("Unknown job kind.");
  } catch (error) {
    await failJob(deps, job, error);
  }
}

export async function settleJob(deps: WorkerDeps, jobId: string): Promise<void> {
  const job = await one<JobRow>(
    deps.db,
    `SELECT id, session_id, kind, status, session_revision, analysis_version, input_hash, attempts, max_attempts
     FROM jobs WHERE id = $1`,
    [jobId],
  );
  if (!job || job.status === "succeeded" || job.status === "cancelled") return;
  await runJob(deps, job);
}

function inlineWorker(deps: Deps): WorkerDeps {
  return { ...deps, workerId: deps.config.host ? `inline-${deps.config.host}` : "inline-analysis" };
}

/**
 * Run a queued analysis job for one session. Used when there is no separate
 * worker process (the Vercel function) so processing can reach `ready` and
 * `derived_summaries` are written in the same request that sealed the session.
 */
export async function settleQueuedAnalysis(deps: Deps, sessionId: string): Promise<ProcessingState | null> {
  const worker = inlineWorker(deps);
  await recoverExpiredLeases(worker);
  const expires = new Date(worker.now().getTime() + worker.config.leaseMs).toISOString();
  const job = await one<JobRow>(
    worker.db,
    `UPDATE jobs
     SET status = 'leased', lease_owner = $2, lease_expires_at = $3, attempts = attempts + 1, updated_at = $4
     WHERE id = (
       SELECT id FROM jobs
       WHERE session_id = $1 AND kind = 'analysis' AND status = 'queued'
       ORDER BY created_at
       FOR UPDATE SKIP LOCKED
       LIMIT 1
     )
     RETURNING id, session_id, kind, status, session_revision, analysis_version, input_hash, attempts, max_attempts`,
    [sessionId, worker.workerId, expires, worker.now().toISOString()],
  );
  if (job) await runJob(worker, job);
  const session = await one<{ processing_state: ProcessingState }>(
    worker.db,
    "SELECT processing_state FROM sessions WHERE id = $1",
    [sessionId],
  );
  return session?.processing_state ?? null;
}

export async function runOnce(deps: WorkerDeps): Promise<{ processed: boolean }> {
  await recoverExpiredLeases(deps);
  await sweepOrphanUploads(deps);
  const job = await leaseNext(deps);
  if (!job) return { processed: false };
  await runJob(deps, job);
  return { processed: true };
}
