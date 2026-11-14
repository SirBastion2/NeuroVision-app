import type { Database } from "./db.js";

/**
 * Idempotent demo identities for IDENTITY_MODE=local.
 * Applied when DEMO_SEED is not "false". Uses ON CONFLICT so cold starts are safe.
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

    INSERT INTO assignments (
      id, revision, org_id, participant_id, manifest, manifest_hash, exposure_status, created_by
    ) VALUES (
      'assign-participant-demo',
      1,
      '${DEMO_ORG_ID}',
      '${DEMO_SUBJECTS.participant}',
      '{"protocol":"spatial-v1","scorer":"events-v1","taskIds":["target-selection","line-bisection"],"source":"live","input":"mouse-trackpad","accessibilityId":"default","configHash":"demo"}'::jsonb,
      'demo-manifest',
      'unseen',
      '${DEMO_SUBJECTS.admin}'
    ) ON CONFLICT DO NOTHING;
  `);
}
