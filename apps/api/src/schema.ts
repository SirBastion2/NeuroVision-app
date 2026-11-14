export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS identities (
  subject TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS memberships (
  org_id TEXT NOT NULL REFERENCES organizations (id),
  subject TEXT NOT NULL REFERENCES identities (subject),
  role TEXT NOT NULL CHECK (role IN ('admin', 'reviewer', 'participant')),
  revoked_at TIMESTAMPTZ,
  PRIMARY KEY (org_id, subject)
);

CREATE TABLE IF NOT EXISTS participants (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations (id),
  label TEXT NOT NULL,
  subject TEXT,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS participants_subject_org
  ON participants (org_id, subject)
  WHERE subject IS NOT NULL;

CREATE TABLE IF NOT EXISTS reviewer_assignments (
  org_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  participant_id TEXT NOT NULL REFERENCES participants (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, subject, participant_id)
);

CREATE TABLE IF NOT EXISTS assignments (
  id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  org_id TEXT NOT NULL,
  participant_id TEXT NOT NULL REFERENCES participants (id),
  manifest JSONB NOT NULL,
  manifest_hash TEXT NOT NULL,
  exposure_status TEXT NOT NULL CHECK (exposure_status IN ('unseen', 'seen', 'unknown')),
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id, revision)
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  participant_id TEXT NOT NULL REFERENCES participants (id),
  assignment_id TEXT NOT NULL,
  assignment_revision INTEGER NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  completion TEXT NOT NULL CHECK (completion IN ('active', 'complete', 'interrupted')),
  sync_state TEXT NOT NULL CHECK (sync_state IN ('local', 'queued', 'uploading', 'acknowledged', 'blocked')),
  processing_state TEXT NOT NULL CHECK (processing_state IN ('pending', 'running', 'ready', 'failed')),
  request_hash TEXT NOT NULL,
  sealed_at TIMESTAMPTZ,
  session_revision INTEGER NOT NULL DEFAULT 0,
  input_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (assignment_id, assignment_revision) REFERENCES assignments (id, revision)
);

CREATE TABLE IF NOT EXISTS batches (
  id TEXT NOT NULL,
  session_id TEXT NOT NULL REFERENCES sessions (id),
  sequence INTEGER NOT NULL,
  parent_batch_id TEXT,
  content_hash TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, id),
  UNIQUE (session_id, sequence)
);

CREATE TABLE IF NOT EXISTS trials (
  session_id TEXT NOT NULL,
  trial_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  content_hash TEXT NOT NULL,
  PRIMARY KEY (session_id, trial_id)
);

CREATE TABLE IF NOT EXISTS response_events (
  session_id TEXT NOT NULL,
  trial_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  elapsed_ms DOUBLE PRECISION NOT NULL CHECK (elapsed_ms >= 0),
  object_id TEXT,
  kind TEXT NOT NULL,
  x DOUBLE PRECISION NOT NULL,
  y DOUBLE PRECISION NOT NULL,
  content_hash TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, trial_id, seq)
);

CREATE TABLE IF NOT EXISTS gaze_samples (
  session_id TEXT NOT NULL,
  trial_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  elapsed_ms DOUBLE PRECISION NOT NULL,
  x DOUBLE PRECISION NOT NULL,
  y DOUBLE PRECISION NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, trial_id, seq)
);

CREATE TABLE IF NOT EXISTS object_blobs (
  object_key TEXT PRIMARY KEY,
  body BYTEA NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS battery_records (
  session_id TEXT PRIMARY KEY REFERENCES sessions (id),
  record JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS trace_refs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions (id),
  org_id TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  declared_byte_count INTEGER NOT NULL,
  declared_expanded_bytes INTEGER NOT NULL,
  declared_checksum TEXT NOT NULL,
  content_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('authorized', 'uploaded', 'verified', 'expired', 'deleted')),
  byte_count INTEGER,
  checksum TEXT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS session_documents (
  session_id TEXT PRIMARY KEY REFERENCES sessions (id),
  record JSONB NOT NULL,
  provenance JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS derived_summaries (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions (id),
  analysis_version TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  session_revision INTEGER NOT NULL,
  summary JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, session_revision, analysis_version, input_hash)
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions (id),
  kind TEXT NOT NULL CHECK (kind IN ('analysis', 'cleanup')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'leased', 'succeeded', 'failed', 'cancelled')),
  session_revision INTEGER NOT NULL,
  analysis_version TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  lease_owner TEXT,
  lease_expires_at TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, kind, session_revision, analysis_version, input_hash)
);

CREATE INDEX IF NOT EXISTS jobs_status_created ON jobs (status, created_at);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  org_id TEXT,
  actor_subject TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_sessions (
  id TEXT PRIMARY KEY,
  subject TEXT NOT NULL,
  org_id TEXT NOT NULL,
  csrf_token TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS oidc_transactions (
  state TEXT PRIMARY KEY,
  nonce TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS legacy_imports (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  participant_id TEXT,
  dedupe_key TEXT,
  original_source TEXT,
  stored_source TEXT,
  status TEXT NOT NULL CHECK (status IN ('imported', 'duplicate', 'rejected')),
  issues JSONB NOT NULL,
  mappings JSONB NOT NULL DEFAULT '[]'::jsonb,
  raw JSONB NOT NULL,
  session_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS legacy_imports_imported
  ON legacy_imports (org_id, dedupe_key)
  WHERE status = 'imported' AND dedupe_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS exports (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  bundle JSONB NOT NULL,
  provenance JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS metric_events (
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE response_events ADD COLUMN IF NOT EXISTS recorded_at TIMESTAMPTZ NOT NULL DEFAULT now();
`;
