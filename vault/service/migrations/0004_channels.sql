-- Channels kept on the service, and the guard a batch uses to fail on purpose.
-- Additive: nothing existing changes. Apply once to a database created before it:
--   wrangler d1 execute ohm-vault --remote --config service/wrangler.deploy.jsonc --file service/migrations/0004_channels.sql
CREATE TABLE IF NOT EXISTS channels (
  did TEXT NOT NULL,
  path TEXT NOT NULL,
  version TEXT,
  title TEXT,
  kind TEXT,
  text TEXT,
  seq INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (did, path)
);
CREATE INDEX IF NOT EXISTS channels_changes ON channels (did, seq);
CREATE TABLE IF NOT EXISTS guard (ok INTEGER NOT NULL CHECK (ok = 1));
