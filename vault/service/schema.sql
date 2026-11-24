-- The vault service's storage. One row for each post a member has. A post's ID is given once, when
-- it is made, and is what the row is known by; its slug, label and everything else can change. A
-- removed post keeps its row with no version, so a client asking "what changed since" is told
-- that it went.
CREATE TABLE IF NOT EXISTS posts (
  did TEXT NOT NULL,
  id TEXT NOT NULL,
  version TEXT,
  slug TEXT,
  label TEXT,
  sublabel TEXT,
  visibility TEXT,
  title TEXT,
  form TEXT,
  date TEXT,
  problems TEXT,
  post TEXT,
  seq INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  leaving_at TEXT,
  PRIMARY KEY (did, id)
);
CREATE INDEX IF NOT EXISTS posts_changes ON posts (did, seq);
-- A slug is the end of a post's address, so it is used once in a vault. The database refuses a second.
CREATE UNIQUE INDEX IF NOT EXISTS posts_slug ON posts (did, slug) WHERE version IS NOT NULL;

-- Which AT Protocol account an ohm account works in. Made once, when the person connects their
-- PDS and proves the account is theirs. One ohm account, one AT Protocol account, each way.
CREATE TABLE IF NOT EXISTS links (
  user_id TEXT PRIMARY KEY,
  did TEXT NOT NULL UNIQUE,
  linked_at TEXT NOT NULL,
  -- When what the account had already published was first brought into the vault. Empty until then.
  mirrored_at TEXT,
  -- The ohm account's name and email, as its own sign-in last said, so a friend can be found by email.
  name TEXT,
  email TEXT
);
CREATE INDEX IF NOT EXISTS links_email ON links (email);

-- The friends layer: blocks a member keeps readable here, so the friends they chose can read them.
-- One row for each block that is not a post (posts stay in `posts`, whose friends-only rows are part
-- of the same layer). A block is kept as the file it is in the member's folder: its path and its
-- text. Private blocks are never kept here; public ones are published as posts. A removed block
-- keeps its row with no version, so "what changed since" can say it went. See plans/encryption.md.
CREATE TABLE IF NOT EXISTS blocks (
  did TEXT NOT NULL,
  id TEXT NOT NULL,
  version TEXT,
  path TEXT,
  kind TEXT,
  title TEXT,
  text TEXT,
  seq INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  -- Set when the block is moving to the private layer: friends no longer read it, and the member's
  -- device seals it when next unlocked (src/visibility.mjs).
  leaving_at TEXT,
  PRIMARY KEY (did, id)
);
CREATE INDEX IF NOT EXISTS blocks_changes ON blocks (did, seq);
-- A path is a file in the member's folder, so it is used once.
CREATE UNIQUE INDEX IF NOT EXISTS blocks_path ON blocks (did, path) WHERE version IS NOT NULL;

-- The private layer: private blocks, as ciphertext only (plans/encryption.md, "The two stores").
-- `id` is opaque, chosen on the member's device; paths and names are content and are inside the
-- ciphertext. `ciphertext` is the sealed file (a file key wrapped by the member's master key, and
-- the contents encrypted with it), which the service cannot open. `version` is computed over the
-- ciphertext, so a stale write is refused without reading anything. `generation` says which master
-- key wraps the file key, so a key rotation can find the files it has not re-wrapped yet. A removed
-- block keeps its row with no version, so "what changed since" can say it went.
CREATE TABLE IF NOT EXISTS private_blocks (
  did TEXT NOT NULL,
  id TEXT NOT NULL,
  version TEXT,
  ciphertext TEXT,
  generation INTEGER,
  size INTEGER,
  seq INTEGER NOT NULL,
  -- The kept version that is this block's contents now.
  rev INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (did, id)
);
CREATE INDEX IF NOT EXISTS private_blocks_changes ON private_blocks (did, seq);

-- Every version of each private block, as ciphertext, under a `rev` that never changes, so a device
-- can restore any of them. Written in the same batch as the change that makes it.
CREATE TABLE IF NOT EXISTS private_block_versions (
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
CREATE INDEX IF NOT EXISTS private_block_versions_generation ON private_block_versions (did, generation);
-- The private layer's journal: each entry sealed on the device (what changed, to which page, by whom
-- and why are inside), kept in the same batch as the changes it describes.
CREATE TABLE IF NOT EXISTS private_journal (
  did TEXT NOT NULL,
  seq INTEGER NOT NULL,
  entry TEXT NOT NULL,
  generation INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (did, seq)
);
CREATE INDEX IF NOT EXISTS private_journal_generation ON private_journal (did, generation);
-- Batches already applied, by the ID the device gave, with what they answered: sent again, a batch
-- answers the same and changes nothing.
CREATE TABLE IF NOT EXISTS private_batches (
  did TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  result TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (did, batch_id)
);
-- Always empty. A statement in a batch that inserts a 0 here fails the CHECK, and so refuses the
-- whole batch: how a version or rotation check stops several changes from half happening.
CREATE TABLE IF NOT EXISTS private_guard (ok INTEGER NOT NULL CHECK (ok = 1));

-- A member's key rotation, as the private store sees it: `target` is the generation of the master key
-- being rotated to. From the start, a write sealed under an older generation is refused, so no device
-- holding only the old key adds a file the rotation would miss; `finished` is set only when no block
-- is below the target, in the same statement that checks. The row stays after, as the floor.
CREATE TABLE IF NOT EXISTS private_rotations (
  did TEXT PRIMARY KEY,
  target INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('rotating', 'finished')),
  started_at TEXT NOT NULL,
  finished_at TEXT
);

-- Who may read a member's friends layer, by DID (their ohm account). The member approves and removes
-- them. `channels` is a JSON list of the channels they see, or empty for every channel; `name` and
-- `email` are from their ohm account when they asked (src/friendship.mjs).
CREATE TABLE IF NOT EXISTS friends (
  did TEXT NOT NULL,
  friend TEXT NOT NULL,
  added_at TEXT NOT NULL,
  channels TEXT,
  name TEXT,
  email TEXT,
  PRIMARY KEY (did, friend)
);
-- Someone signed in to ohm asking to be a member's friend, waiting until the member answers.
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
CREATE INDEX IF NOT EXISTS friends_of ON friends (friend);

-- Channels: each member's channel files (`_channel.md`), kept readable like the friends layer.
-- `path` is the channel's path; `text` is the file exactly as the member's folder holds it. A
-- removed or moved channel keeps its row with no version, so "what changed since" can say it went.
-- A private channel, and a mixed channel's private overlay, are sealed in the private layer instead.
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

-- Fails a batch on purpose: a statement inserts a row here only when what it checks has changed,
-- and the CHECK refuses it, undoing the whole batch. Never holds a row.
CREATE TABLE IF NOT EXISTS guard (ok INTEGER NOT NULL CHECK (ok = 1));

-- The cortex, sealed: profile, observations, skills and tools as files the member's device seals with
-- the same master key as the private layer (key context ohm-vault/cortex/v1), so the service keeps
-- them and cannot read them. The same shape and rules as the private layer's tables: an opaque `id`,
-- every version kept under a `rev`, a sealed journal saying who changed what and why, and batches
-- applied once. A key rotation covers both stores. The vault and the cortex stay apart: nothing here
-- is a vault block, and the cortex is never written into the vault's tables.
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

-- A member's own sites: the only addresses a viewer token is posted back to (src/viewers.mjs). One
-- row for each https origin the member listed, signed in to ohm.
CREATE TABLE IF NOT EXISTS sites (
  did TEXT NOT NULL,
  origin TEXT NOT NULL,
  added_at TEXT NOT NULL,
  PRIMARY KEY (did, origin)
);

-- Visibility moves (src/visibility.mjs). Every move is a row in `moves`, oldest first: which block
-- (its ID, opaque for a private block; never its title or text), from and to which layer, who asked,
-- who approved, why, and how it stands. An agent's request to show a block to more people waits in
-- `move_requests` until the member answers it.
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
