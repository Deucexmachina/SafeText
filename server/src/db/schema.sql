CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL
);
-- Device info shown on the account page's signed-in sessions list.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS user_agent TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled BOOLEAN NOT NULL DEFAULT false;
-- Legacy reset counters are retained for migration compatibility; the current policy is request-based.
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_window TIMESTAMPTZ;
-- Activity and abuse signals surfaced on the admin dashboard.
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_logins INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS scan_rate_hits INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_rate_hits INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_rate_hits INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS api_rate_hits INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled_reason TEXT;
-- Multiple operator-promoted admins are allowed. Never infer admin access from an email address.
DROP INDEX IF EXISTS users_single_admin;

CREATE TABLE IF NOT EXISTS admin_audit (
  id BIGSERIAL PRIMARY KEY,
  actor_id UUID NOT NULL REFERENCES users(id),
  target_id UUID NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE admin_audit ADD COLUMN IF NOT EXISTS reason TEXT;
-- Domain, settings and export actions have no target account; details records what changed.
ALTER TABLE admin_audit ALTER COLUMN target_id DROP NOT NULL;
ALTER TABLE admin_audit ADD COLUMN IF NOT EXISTS details TEXT;
-- Changes made from the server command line (admin:grant) have no admin actor.
ALTER TABLE admin_audit ALTER COLUMN actor_id DROP NOT NULL;

-- Runtime-tunable knobs set from the admin UI; absent keys fall back to env config.
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Curated domain reputation: 'block' always flags, 'allow' never flags.
-- A domain lives on one list; moving it replaces the old entry.
CREATE TABLE IF NOT EXISTS domain_lists (
  domain TEXT PRIMARY KEY,
  list TEXT NOT NULL CHECK (list IN ('block', 'allow')),
  added_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auth_attempts (
  key_hash TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  window_start TIMESTAMPTZ NOT NULL
);

-- One active password-reset code per account; replaced on each request.
CREATE TABLE IF NOT EXISTS password_resets (
  user_id    UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  code_hash  TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  attempts   INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS password_resets_expires_idx ON password_resets(expires_at);

CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS scans (
  id             TEXT PRIMARY KEY,
  state          TEXT NOT NULL DEFAULT 'QUEUED',
  input_type     TEXT NOT NULL,
  input_text     TEXT,
  image_hash     TEXT,
  image_mime     TEXT,
  image_bytes    BYTEA,
  extracted_text TEXT,
  sender_id      TEXT,
  analysis       JSONB,
  threat_intel   JSONB,
  incomplete     JSONB NOT NULL DEFAULT '[]'::jsonb,
  error          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Existing anonymous scans stay stored but are not assigned to a new account.
ALTER TABLE scans ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;
-- NULL identifies legacy extractions, including results from the former stub.
-- Never label existing image text as real OCR during migration.
ALTER TABLE scans ADD COLUMN IF NOT EXISTS extraction_source TEXT;
-- Zero marks existing OCR for one-time reprocessing on re-upload, without trusting legacy stubs.
ALTER TABLE scans ADD COLUMN IF NOT EXISTS extraction_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE scans ADD COLUMN IF NOT EXISTS extraction_note TEXT;
-- Keyword-derived scam type; trends are aggregated from this column alone.
ALTER TABLE scans ADD COLUMN IF NOT EXISTS scam_category TEXT;
DROP INDEX IF EXISTS scans_image_hash_key;
CREATE UNIQUE INDEX IF NOT EXISTS scans_user_image_hash_key
  ON scans (user_id, image_hash) WHERE image_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS scans_user_created_idx ON scans(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS scans_created_at_idx ON scans (created_at DESC);
CREATE INDEX IF NOT EXISTS scans_state_updated_idx ON scans(state, updated_at);
CREATE INDEX IF NOT EXISTS sessions_user_expiry_idx ON sessions(user_id, expires_at DESC);
CREATE INDEX IF NOT EXISTS auth_attempts_window_idx ON auth_attempts(window_start);
CREATE INDEX IF NOT EXISTS admin_audit_created_idx ON admin_audit(created_at);

-- User feedback on verdicts. Message text is stored only with consent.
CREATE TABLE IF NOT EXISTS scan_reports (
  id BIGSERIAL PRIMARY KEY,
  scan_id TEXT NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expected_verdict TEXT NOT NULL CHECK (expected_verdict IN ('SAFE','SUSPICIOUS','MALICIOUS','INCONCLUSIVE')),
  shared_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (scan_id, user_id)
);
