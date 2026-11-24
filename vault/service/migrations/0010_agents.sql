-- Coding agents the member connected, what each waits for the member to approve, and what each did
-- lately (src/agents.mjs). Additive. Apply once to a database created before it:
--   wrangler d1 execute ohm-vault --remote --config service/wrangler.deploy.jsonc --file service/migrations/0010_agents.sql
CREATE TABLE IF NOT EXISTS agents (
  did TEXT NOT NULL,
  agent TEXT NOT NULL,
  state TEXT NOT NULL,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  last_tool TEXT,
  PRIMARY KEY (did, agent)
);
CREATE TABLE IF NOT EXISTS agent_approvals (
  did TEXT NOT NULL,
  id TEXT NOT NULL,
  agent TEXT NOT NULL,
  tool TEXT NOT NULL,
  plan TEXT NOT NULL,
  shown TEXT NOT NULL,
  state TEXT NOT NULL,
  asked_at TEXT NOT NULL,
  answered_at TEXT,
  used_at TEXT,
  PRIMARY KEY (did, id)
);
CREATE INDEX IF NOT EXISTS agent_approvals_waiting ON agent_approvals (did, state);
CREATE TABLE IF NOT EXISTS agent_activity (
  did TEXT NOT NULL,
  seq INTEGER NOT NULL,
  agent TEXT NOT NULL,
  at TEXT NOT NULL,
  tool TEXT NOT NULL,
  PRIMARY KEY (did, seq)
);
