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

-- Dedup: the same image content always maps to one scan.
CREATE UNIQUE INDEX IF NOT EXISTS scans_image_hash_key
  ON scans (image_hash) WHERE image_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS scans_created_at_idx ON scans (created_at DESC);
