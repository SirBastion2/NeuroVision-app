import { randomUUID } from "node:crypto";
import type { Actor, Deps } from "./deps.js";
import { one } from "./db.js";
import { HttpError } from "./errors.js";

export async function audit(
  deps: Deps,
  actor: Actor,
  action: string,
  targetType: string,
  targetId: string,
  metadata: Record<string, string | number | boolean | null> = {},
): Promise<void> {
  await deps.db.query(
    `INSERT INTO audit_events (id, org_id, actor_subject, action, target_type, target_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [randomUUID(), actor.orgId, actor.subject, action, targetType, targetId, JSON.stringify(metadata)],
  );
}

export interface ParticipantRow {
  id: string;
  org_id: string;
  label: string;
  subject: string | null;
  deleted_at: Date | string | null;
}

export async function participantInOrg(deps: Deps, orgId: string, participantId: string): Promise<ParticipantRow | null> {
  return one<ParticipantRow>(
    deps.db,
    "SELECT id, org_id, label, subject, deleted_at FROM participants WHERE id = $1 AND org_id = $2",
    [participantId, orgId],
  );
}

export async function requireLiveParticipant(deps: Deps, orgId: string, participantId: string): Promise<ParticipantRow> {
  const participant = await participantInOrg(deps, orgId, participantId);
  if (!participant || participant.deleted_at) throw new HttpError(404, "not_found", "Not found.");
  return participant;
}

export async function assertMeasurementRead(deps: Deps, actor: Actor, participant: ParticipantRow): Promise<void> {
  if (actor.role === "admin") {
    throw new HttpError(403, "forbidden", "Measurement review requires an explicit assignment.");
  }
  if (actor.role === "participant") {
    if (participant.subject !== actor.subject) throw new HttpError(404, "not_found", "Not found.");
    return;
  }
  const assigned = await one<{ ok: number }>(
    deps.db,
    `SELECT 1 AS ok FROM reviewer_assignments
     WHERE org_id = $1 AND subject = $2 AND participant_id = $3`,
    [actor.orgId, actor.subject, participant.id],
  );
  if (!assigned) throw new HttpError(403, "forbidden", "Reviewer is not assigned to this participant.");
}

export async function assertCanAssign(deps: Deps, actor: Actor, participant: ParticipantRow): Promise<void> {
  if (actor.role === "participant") {
    if (participant.subject !== actor.subject) {
      throw new HttpError(403, "forbidden", "Participants cannot manage assignments.");
    }
    return;
  }
  if (actor.role === "admin") return;
  await assertMeasurementRead(deps, actor, participant);
}

export function requireAdmin(actor: Actor): void {
  if (actor.role !== "admin") throw new HttpError(403, "forbidden", "Administrator role required.");
}
