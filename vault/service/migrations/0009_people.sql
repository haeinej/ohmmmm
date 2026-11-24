-- Finding a friend by email: each ohm account's name and email, kept from its own sign-in.
-- Additive. Apply once to a database created before it:
--   wrangler d1 execute ohm-vault --remote --config service/wrangler.deploy.jsonc --file service/migrations/0009_people.sql
ALTER TABLE links ADD COLUMN name TEXT;
ALTER TABLE links ADD COLUMN email TEXT;
CREATE INDEX IF NOT EXISTS links_email ON links (email);
-- Who a person asked to be friends with, by the email they typed. Kept whether or not that email has
-- an ohm account, so the asker's list never says which emails do (src/friendship.mjs).
CREATE TABLE IF NOT EXISTS friend_asks (
  viewer TEXT NOT NULL,
  email TEXT NOT NULL,
  message TEXT,
  asked_at TEXT NOT NULL,
  -- When ohm emailed the invite, once (src/mail.mjs).
  mailed_at TEXT,
  PRIMARY KEY (viewer, email)
);
