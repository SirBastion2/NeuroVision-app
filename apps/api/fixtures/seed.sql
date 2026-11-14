-- Local demo identities. No measurement data and no secrets.
INSERT INTO organizations (id, name) VALUES ('org-demo', 'Demo organization')
ON CONFLICT (id) DO NOTHING;

INSERT INTO identities (subject) VALUES ('admin-demo')
ON CONFLICT (subject) DO NOTHING;

INSERT INTO memberships (org_id, subject, role) VALUES ('org-demo', 'admin-demo', 'admin')
ON CONFLICT (org_id, subject) DO NOTHING;
