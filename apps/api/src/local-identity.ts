import { parseParticipantId, PROTOCOL_ID, SCORER_ID } from "@neurovision/domain";
import type { Actor } from "./deps.js";
import type { Database } from "./db.js";
import { DEMO_ORG_ID } from "./demo-seed.js";
import { HttpError } from "./errors.js";

const LOCAL_MANIFEST = {
  protocol: PROTOCOL_ID,
  scorer: SCORER_ID,
  taskIds: ["target-selection", "line-bisection"],
  source: "live",
  input: "mouse-trackpad",
  accessibilityId: "default",
  configHash: "local",
} as const;

export const LOCAL_ORG_ID = DEMO_ORG_ID;

export async function ensureLocalParticipant(
  db: Database,
  orgId: string,
  subject: string,
): Promise<{ role: Actor["role"] }> {
  const id = parseParticipantId(subject);
  const existing = await db.query<{ role: Actor["role"]; revoked_at: Date | string | null }>(
    "SELECT role, revoked_at FROM memberships WHERE org_id = $1 AND subject = $2",
    [orgId, id],
  );
  const row = existing.rows[0];
  if (row?.revoked_at) {
    throw new HttpError(403, "forbidden", "No active membership for this local identity.");
  }
  if (row) return { role: row.role };

  const orgName = orgId === LOCAL_ORG_ID ? "Demo organization" : orgId;
  const assignmentId = `assign-${id}`;
  await db.transaction(async (tx) => {
    await tx.query("INSERT INTO organizations (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING", [
      orgId,
      orgName,
    ]);
    await tx.query("INSERT INTO identities (subject) VALUES ($1) ON CONFLICT (subject) DO NOTHING", [id]);
    await tx.query(
      `INSERT INTO memberships (org_id, subject, role) VALUES ($1, $2, 'participant')
       ON CONFLICT (org_id, subject) DO NOTHING`,
      [orgId, id],
    );
    await tx.query(
      `INSERT INTO participants (id, org_id, label, subject) VALUES ($1, $2, $3, $1)
       ON CONFLICT (id) DO NOTHING`,
      [id, orgId, id],
    );
    await tx.query(
      `INSERT INTO assignments (
         id, revision, org_id, participant_id, manifest, manifest_hash, exposure_status, created_by
       ) VALUES ($1, 1, $2, $3, $4::jsonb, $5, 'unseen', $3)
       ON CONFLICT DO NOTHING`,
      [assignmentId, orgId, id, JSON.stringify(LOCAL_MANIFEST), "local-manifest"],
    );
  });

  const created = await db.query<{ role: Actor["role"]; revoked_at: Date | string | null }>(
    "SELECT role, revoked_at FROM memberships WHERE org_id = $1 AND subject = $2",
    [orgId, id],
  );
  const membership = created.rows[0];
  if (!membership || membership.revoked_at) {
    throw new HttpError(403, "forbidden", "No active membership for this local identity.");
  }
  return { role: membership.role };
}
