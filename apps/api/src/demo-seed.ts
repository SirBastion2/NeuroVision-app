import type { Database } from "./db.js";

/**
 * Idempotent HackPrinceton demo identities.
 * Applied only when IDENTITY_MODE=local and DEMO_SEED is not "false".
 * Production refuses local identity, so this never runs there.
 */
export const DEMO_ORG_ID = "org-demo";

export const DEMO_SUBJECTS = {
  admin: "admin-demo",
  reviewer: "reviewer-demo",
  participant: "participant-demo",
} as const;

export async function seedDemo(db: Database): Promise<void> {
  await db.exec(`
    INSERT INTO organizations (id, name) VALUES ('${DEMO_ORG_ID}', 'Demo organization')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO identities (subject) VALUES
      ('${DEMO_SUBJECTS.admin}'),
      ('${DEMO_SUBJECTS.reviewer}'),
      ('${DEMO_SUBJECTS.participant}')
    ON CONFLICT (subject) DO NOTHING;

    INSERT INTO memberships (org_id, subject, role) VALUES
      ('${DEMO_ORG_ID}', '${DEMO_SUBJECTS.admin}', 'admin'),
      ('${DEMO_ORG_ID}', '${DEMO_SUBJECTS.reviewer}', 'reviewer'),
      ('${DEMO_ORG_ID}', '${DEMO_SUBJECTS.participant}', 'participant')
    ON CONFLICT (org_id, subject) DO NOTHING;

    INSERT INTO participants (id, org_id, label, subject) VALUES
      ('${DEMO_SUBJECTS.participant}', '${DEMO_ORG_ID}', 'Demo participant', '${DEMO_SUBJECTS.participant}')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO reviewer_assignments (org_id, subject, participant_id) VALUES
      ('${DEMO_ORG_ID}', '${DEMO_SUBJECTS.reviewer}', '${DEMO_SUBJECTS.participant}')
    ON CONFLICT DO NOTHING;
  `);
}
