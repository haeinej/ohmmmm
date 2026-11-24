-- The cortex, sealed on the member's device and kept here as ciphertext only, beside the private
-- layer and with the same rules. Additive: nothing existing changes. Apply once:
--   wrangler d1 execute ohm-vault --remote --config service/wrangler.deploy.jsonc --file service/migrations/0005_cortex.sql
-- Not the MVP cortex tables 0001 dropped: those held readable text.
CREATE TABLE IF NOT EXISTS cortex_files (
  did TEXT NOT NULL,
  id TEXT NOT NULL,
  version TEXT,
  ciphertext TEXT,
  generation INTEGER,
  size INTEGER,
  seq INTEGER NOT NULL,
  -- The kept version that is this file's contents now.
  rev INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (did, id)
);
CREATE INDEX IF NOT EXISTS cortex_files_changes ON cortex_files (did, seq);

CREATE TABLE IF NOT EXISTS cortex_file_versions (
  did TEXT NOT NULL,
  id TEXT NOT NULL,
  rev INTEGER NOT NULL,
  version TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  generation INTEGER NOT NULL,
  size INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (did, id, rev)
);
CREATE INDEX IF NOT EXISTS cortex_file_versions_generation ON cortex_file_versions (did, generation);
CREATE TABLE IF NOT EXISTS cortex_journal (
  did TEXT NOT NULL,
  seq INTEGER NOT NULL,
  entry TEXT NOT NULL,
  generation INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (did, seq)
);
CREATE INDEX IF NOT EXISTS cortex_journal_generation ON cortex_journal (did, generation);
CREATE TABLE IF NOT EXISTS cortex_batches (
  did TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  result TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (did, batch_id)
);
