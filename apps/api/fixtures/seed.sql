-- Idempotent HackPrinceton demo identities. No measurements and no secrets.
-- The API also applies this when IDENTITY_MODE=local and DEMO_SEED is not false.

INSERT INTO organizations (id, name) VALUES ('org-demo', 'Demo organization')
ON CONFLICT (id) DO NOTHING;

INSERT INTO identities (subject) VALUES
  ('admin-demo'),
  ('reviewer-demo'),
  ('participant-demo')
ON CONFLICT (subject) DO NOTHING;

INSERT INTO memberships (org_id, subject, role) VALUES
  ('org-demo', 'admin-demo', 'admin'),
  ('org-demo', 'reviewer-demo', 'reviewer'),
  ('org-demo', 'participant-demo', 'participant')
ON CONFLICT (org_id, subject) DO NOTHING;

INSERT INTO participants (id, org_id, label, subject) VALUES
  ('participant-demo', 'org-demo', 'Demo participant', 'participant-demo')
ON CONFLICT (id) DO NOTHING;

INSERT INTO reviewer_assignments (org_id, subject, participant_id) VALUES
  ('org-demo', 'reviewer-demo', 'participant-demo')
ON CONFLICT DO NOTHING;
