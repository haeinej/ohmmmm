-- Visibility moves: a block on its way to the private layer, the journal of moves, and agents'
-- requests waiting for the member, and the last copy of what each member published (served when their
-- PDS is down). Additive. Apply once to a database created before it:
--   wrangler d1 execute ohm-vault --remote --config service/wrangler.deploy.jsonc --file service/migrations/0007_visibility.sql
ALTER TABLE blocks ADD COLUMN leaving_at TEXT;
ALTER TABLE posts ADD COLUMN leaving_at TEXT;
CREATE TABLE IF NOT EXISTS moves (
  did TEXT NOT NULL,
  seq INTEGER NOT NULL,
  at TEXT NOT NULL,
  block TEXT NOT NULL,
  from_layer TEXT NOT NULL,
  to_layer TEXT NOT NULL,
  action TEXT NOT NULL,
  state TEXT NOT NULL,
  asked_by TEXT NOT NULL,
  approved_by TEXT,
  reason TEXT,
  request TEXT,
  PRIMARY KEY (did, seq)
);
CREATE TABLE IF NOT EXISTS move_requests (
  did TEXT NOT NULL,
  id TEXT NOT NULL,
  block TEXT NOT NULL,
  store TEXT NOT NULL,
  from_layer TEXT NOT NULL,
  to_layer TEXT NOT NULL,
  version TEXT,
  asked_by TEXT NOT NULL,
  reason TEXT,
  asked_at TEXT NOT NULL,
  state TEXT NOT NULL,
  answered_at TEXT,
  PRIMARY KEY (did, id)
);
CREATE INDEX IF NOT EXISTS move_requests_waiting ON move_requests (did, state);

-- The last copy of what each member published, as content reads gave it (src/content.mjs): served,
-- marked stale, when their PDS cannot be reached, so a site keeps working.
CREATE TABLE IF NOT EXISTS published_copies (
  did TEXT PRIMARY KEY,
  entries TEXT NOT NULL,
  read_at TEXT NOT NULL
);
