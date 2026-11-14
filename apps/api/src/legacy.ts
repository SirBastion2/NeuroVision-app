import { randomUUID } from "node:crypto";
import {
  CONTRACTS_VERSION,
  isSessionRecord,
  parseSessionRecord,
  type SessionRecord,
  type SessionSource,
  type TaskKind,
} from "@neurovision/domain";
import { ANALYSIS_VERSION } from "./analysis.js";
import { assertMeasurementRead, audit, requireLiveParticipant } from "./access.js";
import type { Actor, Deps } from "./deps.js";
import { isUniqueViolation, one } from "./db.js";
import { HttpError } from "./errors.js";
import { contentHash } from "./hash.js";

const TASK_MAP: Record<string, TaskKind> = {
  "target-selection": "target-selection",
  "line-bisection": "line-bisection",
  cancellation: "target-selection",
  bisection: "line-bisection",
  practice: "target-selection",
};

export interface LegacyDisposition {
  index: number | null;
  dedupeKey: string | null;
  status: "valid" | "invalid" | "duplicate" | "imported" | "rejected";
  issues: string[];
  mappings: string[];
  originalSource: string | null;
  storedSource: SessionSource | null;
  sessionId: string | null;
}

interface Inspection {
  dedupeKey: string | null;
  originalSource: string | null;
  record: SessionRecord | null;
  issues: string[];
  mappings: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function identityOf(value: unknown): { dedupeKey: string | null; originalSource: string | null } {
  if (!isRecord(value)) return { dedupeKey: null, originalSource: null };
  const source = typeof value.source === "string" ? value.source : null;
  const profileId = typeof value.profileId === "string" ? value.profileId : null;
  const id = typeof value.id === "string" ? value.id : null;
  if (!source || !profileId || !id) return { dedupeKey: null, originalSource: source };
  return { dedupeKey: `${source}:${profileId}:${id}`, originalSource: source };
}

function mapTrialTask(trial: unknown, mappings: string[], issues: string[]): unknown {
  if (!isRecord(trial) || typeof trial.task !== "string") return trial;
  const mapped = TASK_MAP[trial.task];
  if (!mapped) {
    issues.push(`Unsupported task "${trial.task}".`);
    return trial;
  }
  if (mapped !== trial.task) mappings.push(`task ${trial.task} -> ${mapped}`);
  return { ...trial, task: mapped };
}

export function inspectLegacySession(value: unknown): Inspection {
  const identity = identityOf(value);
  if (isSessionRecord(value)) {
    return {
      dedupeKey: `${value.source}:${value.profileId}:${value.id}`,
      originalSource: value.source,
      record: value,
      issues: [],
      mappings: [],
    };
  }
  if (!isRecord(value)) {
    return { ...identity, record: null, issues: ["Session is not an object."], mappings: [] };
  }
  const issues: string[] = [];
  const mappings: string[] = [];
  const draft: Record<string, unknown> = { ...value };
  if (draft.source === "simulated") {
    draft.source = "demonstration";
    mappings.push("source simulated -> demonstration");
  } else if (draft.source === "live" || draft.source === "demonstration") {
    mappings.push(`source ${draft.source} kept`);
  } else {
    issues.push("Source is missing or is not live, simulated, or demonstration.");
  }
  if (draft.source === "simulated") {
    issues.push("Refusing to store a simulated session as live.");
  }
  if (Array.isArray(draft.trials)) {
    draft.trials = draft.trials.map((trial) => mapTrialTask(trial, mappings, issues));
  }
  if (Array.isArray(draft.practice)) {
    draft.practice = draft.practice.map((round) => {
      if (!isRecord(round)) return round;
      return { ...round, trial: mapTrialTask(round.trial, mappings, issues) };
    });
  }
  if (issues.length > 0) {
    return { ...identity, record: null, issues, mappings };
  }
  try {
    const record = parseSessionRecord(draft);
    if (identity.originalSource === "simulated" && record.source !== "demonstration") {
      return { ...identity, record: null, issues: ["Simulated sessions must stay non-live."], mappings };
    }
    return { ...identity, record, issues: [], mappings };
  } catch {
    return {
      ...identity,
      record: null,
      issues: ["Session does not match the domain contract and was kept for review."],
      mappings,
    };
  }
}

function envelopeSessions(envelope: unknown): { sessions: unknown[] | null; issues: string[] } {
  if (!isRecord(envelope)) return { sessions: null, issues: ["Envelope is not an object."] };
  const issues: string[] = [];
  if (envelope.version !== 1) issues.push("Envelope version is not 1.");
  if (typeof envelope.seeded !== "boolean") issues.push("Envelope seeded flag is not a boolean.");
  if (!Array.isArray(envelope.sessions)) {
    issues.push("Envelope sessions field is not an array.");
    return { sessions: null, issues };
  }
  return { sessions: envelope.sessions, issues };
}

async function alreadyImported(deps: Deps, orgId: string, dedupeKey: string | null, sessionId: string | null) {
  if (dedupeKey) {
    const row = await one<{ session_id: string | null }>(
      deps.db,
      `SELECT session_id FROM legacy_imports
       WHERE org_id = $1 AND dedupe_key = $2 AND status = 'imported'`,
      [orgId, dedupeKey],
    );
    if (row) return row.session_id;
  }
  if (sessionId) {
    const session = await one<{ id: string }>(deps.db, "SELECT id FROM sessions WHERE id = $1 AND org_id = $2", [sessionId, orgId]);
    if (session) return session.id;
  }
  return null;
}

export async function previewLegacy(deps: Deps, actor: Actor, envelope: unknown): Promise<{ envelopeIssues: string[]; dispositions: LegacyDisposition[] }> {
  if (actor.role === "participant") throw new HttpError(403, "forbidden", "Participants cannot preview imports.");
  const parsed = envelopeSessions(envelope);
  if (!parsed.sessions) {
    return {
      envelopeIssues: parsed.issues,
      dispositions: [
        {
          index: null,
          dedupeKey: null,
          status: "invalid",
          issues: parsed.issues,
          mappings: [],
          originalSource: null,
          storedSource: null,
          sessionId: null,
        },
      ],
    };
  }
  const dispositions: LegacyDisposition[] = [];
  for (const [index, session] of parsed.sessions.entries()) {
    const inspection = inspectLegacySession(session);
    const issues = [...parsed.issues, ...inspection.issues];
    const duplicate = await alreadyImported(deps, actor.orgId, inspection.dedupeKey, inspection.record?.id ?? null);
    let status: LegacyDisposition["status"] = "valid";
    if (duplicate) status = "duplicate";
    else if (!inspection.record || issues.length > 0) status = "invalid";
    dispositions.push({
      index,
      dedupeKey: inspection.dedupeKey,
      status,
      issues,
      mappings: inspection.mappings,
      originalSource: inspection.originalSource,
      storedSource: inspection.record?.source ?? null,
      sessionId: duplicate ?? inspection.record?.id ?? null,
    });
  }
  return { envelopeIssues: parsed.issues, dispositions };
}

export async function commitLegacy(
  deps: Deps,
  actor: Actor,
  participantId: string,
  envelope: unknown,
): Promise<{ envelopeIssues: string[]; dispositions: LegacyDisposition[] }> {
  const participant = await requireLiveParticipant(deps, actor.orgId, participantId);
  if (actor.role === "participant") throw new HttpError(403, "forbidden", "Participants cannot import records.");
  if (actor.role === "reviewer") await assertMeasurementRead(deps, actor, participant);
  const parsed = envelopeSessions(envelope);
  if (!parsed.sessions) {
    await remember(deps, actor, participantId, null, null, null, "rejected", parsed.issues, [], envelope, null);
    return {
      envelopeIssues: parsed.issues,
      dispositions: [
        {
          index: null,
          dedupeKey: null,
          status: "rejected",
          issues: parsed.issues,
          mappings: [],
          originalSource: null,
          storedSource: null,
          sessionId: null,
        },
      ],
    };
  }
  const dispositions: LegacyDisposition[] = [];
  for (const [index, session] of parsed.sessions.entries()) {
    const inspection = inspectLegacySession(session);
    const issues = [...parsed.issues, ...inspection.issues];
    const duplicate = await alreadyImported(deps, actor.orgId, inspection.dedupeKey, inspection.record?.id ?? null);
    if (duplicate) {
      dispositions.push({
        index,
        dedupeKey: inspection.dedupeKey,
        status: "duplicate",
        issues,
        mappings: inspection.mappings,
        originalSource: inspection.originalSource,
        storedSource: inspection.record?.source ?? null,
        sessionId: duplicate,
      });
      continue;
    }
    if (!inspection.record || issues.length > 0) {
      await remember(
        deps,
        actor,
        participantId,
        inspection.dedupeKey,
        inspection.originalSource,
        null,
        "rejected",
        issues,
        inspection.mappings,
        session,
        null,
      );
      dispositions.push({
        index,
        dedupeKey: inspection.dedupeKey,
        status: "rejected",
        issues,
        mappings: inspection.mappings,
        originalSource: inspection.originalSource,
        storedSource: null,
        sessionId: null,
      });
      continue;
    }
    const imported = await importRecord(deps, actor, participant.id, inspection.record, inspection, session, index);
    dispositions.push(imported);
  }
  return { envelopeIssues: parsed.issues, dispositions };
}

async function importRecord(
  deps: Deps,
  actor: Actor,
  participantId: string,
  record: SessionRecord,
  inspection: Inspection,
  raw: unknown,
  index: number,
): Promise<LegacyDisposition> {
  const manifest = {
    protocol: record.protocol,
    scorer: record.scorer,
    taskIds: record.taskIds,
    source: record.source,
    input: record.input,
    accessibilityId: "legacy-import",
    configHash: contentHash({ viewport: record.viewport, pointerSampling: record.pointerSampling }),
  };
  const manifestHash = contentHash(manifest);
  const assignmentId = randomUUID();
  const inputHash = contentHash(record);
  const completion = record.status === "complete" ? "complete" : "interrupted";
  try {
    await deps.db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO assignments (id, revision, org_id, participant_id, manifest, manifest_hash, exposure_status, created_by)
         VALUES ($1, 1, $2, $3, $4::jsonb, $5, 'unknown', $6)`,
        [assignmentId, actor.orgId, participantId, JSON.stringify(manifest), manifestHash, actor.subject],
      );
      await tx.query(
        `INSERT INTO sessions (
           id, org_id, participant_id, assignment_id, assignment_revision, started_at, completion,
           sync_state, processing_state, request_hash, sealed_at, session_revision, input_hash
         ) VALUES ($1, $2, $3, $4, 1, $5, $6, 'acknowledged', 'pending', $7, $8, 1, $9)`,
        [
          record.id,
          actor.orgId,
          participantId,
          assignmentId,
          record.startedAt,
          completion,
          contentHash({ legacy: inspection.dedupeKey }),
          deps.now().toISOString(),
          inputHash,
        ],
      );
      await tx.query(
        `INSERT INTO session_documents (session_id, record, provenance) VALUES ($1, $2::jsonb, $3::jsonb)`,
        [
          record.id,
          JSON.stringify(record),
          JSON.stringify({
            importer: "legacy-envelope-v1",
            originalSource: inspection.originalSource,
            storedSource: record.source,
            mappings: inspection.mappings,
            profileId: record.profileId,
            participantId,
            contractsVersion: CONTRACTS_VERSION,
          }),
        ],
      );
      await tx.query(
        `INSERT INTO jobs (id, session_id, kind, status, session_revision, analysis_version, input_hash, max_attempts)
         VALUES ($1, $2, 'analysis', 'queued', 1, $3, $4, $5)`,
        [randomUUID(), record.id, ANALYSIS_VERSION, inputHash, deps.config.maxJobAttempts],
      );
      await tx.query(
        `INSERT INTO legacy_imports (
           id, org_id, participant_id, dedupe_key, original_source, stored_source, status, issues, mappings, raw, session_id
         ) VALUES ($1, $2, $3, $4, $5, $6, 'imported', '[]'::jsonb, $7::jsonb, $8::jsonb, $9)`,
        [
          randomUUID(),
          actor.orgId,
          participantId,
          inspection.dedupeKey,
          inspection.originalSource,
          record.source,
          JSON.stringify(inspection.mappings),
          JSON.stringify(raw),
          record.id,
        ],
      );
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const existing = await alreadyImported(deps, actor.orgId, inspection.dedupeKey, record.id);
    return {
      index,
      dedupeKey: inspection.dedupeKey,
      status: "duplicate",
      issues: [],
      mappings: inspection.mappings,
      originalSource: inspection.originalSource,
      storedSource: record.source,
      sessionId: existing,
    };
  }
  await audit(deps, actor, "import.legacy", "participant", participantId, { sessionId: record.id });
  return {
    index,
    dedupeKey: inspection.dedupeKey,
    status: "imported",
    issues: [],
    mappings: inspection.mappings,
    originalSource: inspection.originalSource,
    storedSource: record.source,
    sessionId: record.id,
  };
}

async function remember(
  deps: Deps,
  actor: Actor,
  participantId: string | null,
  dedupeKey: string | null,
  originalSource: string | null,
  storedSource: string | null,
  status: "rejected",
  issues: string[],
  mappings: string[],
  raw: unknown,
  sessionId: string | null,
) {
  await deps.db.query(
    `INSERT INTO legacy_imports (
       id, org_id, participant_id, dedupe_key, original_source, stored_source, status, issues, mappings, raw, session_id
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, $11)`,
    [
      randomUUID(),
      actor.orgId,
      participantId,
      dedupeKey,
      originalSource,
      storedSource,
      status,
      JSON.stringify(issues),
      JSON.stringify(mappings),
      JSON.stringify(raw),
      sessionId,
    ],
  );
  await audit(deps, actor, "import.legacy.rejected", "participant", participantId ?? "envelope", {});
}
