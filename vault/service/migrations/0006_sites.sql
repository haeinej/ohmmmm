-- A member's own sites: the only addresses a viewer token is posted back to (src/viewers.mjs).
-- Additive: nothing existing changes. Apply once to a database created before it:
--   wrangler d1 execute ohm-vault --remote --config service/wrangler.deploy.jsonc --file service/migrations/0006_sites.sql
CREATE TABLE IF NOT EXISTS sites (
  did TEXT NOT NULL,
  origin TEXT NOT NULL,
  added_at TEXT NOT NULL,
  PRIMARY KEY (did, origin)
);
