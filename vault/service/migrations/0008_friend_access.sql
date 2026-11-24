-- Friends approved like devices: who asked, and which channels each friend sees (src/friendship.mjs).
-- Additive: a friend added before sees every channel, as before. Apply once to a database created before it:
--   wrangler d1 execute ohm-vault --remote --config service/wrangler.deploy.jsonc --file service/migrations/0008_friend_access.sql
ALTER TABLE friends ADD COLUMN channels TEXT;
ALTER TABLE friends ADD COLUMN name TEXT;
ALTER TABLE friends ADD COLUMN email TEXT;
CREATE TABLE IF NOT EXISTS friend_requests (
  did TEXT NOT NULL,
  id TEXT NOT NULL,
  friend TEXT NOT NULL,
  name TEXT,
  email TEXT,
  message TEXT,
  asked_at TEXT NOT NULL,
  state TEXT NOT NULL,
  answered_at TEXT,
  PRIMARY KEY (did, id)
);
CREATE INDEX IF NOT EXISTS friend_requests_waiting ON friend_requests (did, state);
-- One request waits for each asker: a second ask, even at the same moment, keeps the first.
CREATE UNIQUE INDEX IF NOT EXISTS friend_requests_one_waiting ON friend_requests (did, friend) WHERE state = 'waiting';
