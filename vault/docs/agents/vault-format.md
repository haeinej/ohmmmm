# Vault folder format: agent reference

Human guide: [docs/vault-format.md](../vault-format.md). Design and what comes next: [plans/vault.md](../../plans/vault.md).

## Purpose and boundary

[vault/node.mjs](../../vault/node.mjs) reads and writes a vault folder as four kinds of nodes (block, channel, entity, source) and derives evidence edges from their content. It is pure: callers pass `{ path, text }` pairs and write what they get back. It does no I/O, indexing, sync or publishing, and it holds no inference: agent conclusions live in ohm-cortex, which refers to blocks by ID.

Agent writes, grants, history, lint and `vault_where` are tested in [agent-write.test.mjs](../../test/agent-write.test.mjs). Format and evidence are tested in [node.test.mjs](../../test/node.test.mjs). Indexing and provenance use temporary folders and SQLite in [indexer.test.mjs](../../test/indexer.test.mjs) and [provenance.test.mjs](../../test/provenance.test.mjs). The friends layer has signed-token service tests in [friends.test.mjs](../../test/friends.test.mjs).

## Schemas

[lexicons/com/ohmmmm/vault/](../../lexicons/com/ohmmmm/vault/): `block`, `channel`, `entity`, `source`, all `key: tid`. They describe file contents; nothing is written to a PDS. A test pins each lexicon's property list to `BLOCK_FIELDS`, `CHANNEL_FIELDS`, `ENTITY_FIELDS` and `SOURCE_FIELDS` and its known values to the exported enums. Change both together. `com.ohmmmm.post` is unchanged and remains fixed (AGENTS.md rule 2).

## Paths

| Path | Node | Notes |
| --- | --- | --- |
| `<folders>/<name>.md` | block | `home` = folders joined by `/` (`''` at the vault's top). `slug` = `slug` property or `slugOf(name)` |
| `<folders>/_channel.md` | channel | `path` = folders. Body = description. Not valid at the vault's top |
| `_entities/<kind>/<name>.md` | entity | `kind` comes from the folder: `person`, `work`, `place`, `org` |
| `_sources/<id>/source.json` | source | Folder name is the ID. Other files in that folder (extracted text, original) are not nodes |
| any segment starting `.`, other `_` paths and files, non-`.md` files | none | `readNode` returns `null`. Attachments such as `churn.sql` are reached through embeds |

## Contracts

- `readNode(path, text) -> { node, problems } | null`. Problems are sentences for the author; a node is still returned where possible. Unknown properties are kept in `node.properties`.
- `nodeFile(node) -> { path, text }`. It throws `VaultProblem` for a node it cannot write. Invariant: `readNode(nodeFile(n).path, nodeFile(n).text).node` deep-equals `n` for any node `readNode` produced. `kind` is written only when it was given, differs from `inferKind(body)`, or is needed so a block that writes `visibility` and nothing in `BLOCK_ONLY` does not read back as a post file; `slug` only when it was given or differs from the file name.
- **Visibility.** Every block node has `visibility`, one of `VISIBILITIES` (`public`, `friends`, `private`), with `DEFAULT_VISIBILITY` `private` when the file does not say. An unknown value is reported and read as private. It is written only when it was given or is not private. It decides the storage layer in [plans/encryption.md](../../plans/encryption.md) (not built). It replaced `intent`.
- **Posts.** A file with `kind: post`, or with no `kind`, a `visibility` property and none of `origin`, `from`, `excerpt`, `by`, `status`, `created` and `updated` (`BLOCK_ONLY`), is read through `filePost` and written through `postFile` ([vault/file.mjs](../../vault/file.mjs)). `node.post` is the unchanged post object, so `postVersion` and `syncFolder` behave as before. `channels` is stored as an ordinary post property; the home channel is the label/sublabel folder; posts stay at most two folders deep.
- **IDs** are `newNodeId()` (= `newPostId`, 13-character TID). A node without one is keyed `block:<path>` / `channel:<path>` until given one. `nodeKey(node)` gives `block:<id>`, `channel:<id|path>`, `entity:<id>` or `source:<id>`.
- `originKind(origin)` returns `local` (`/`, `~/`, `C:\`), `drive` (`gdrive:` or `/Library/CloudStorage/GoogleDrive-`), `web`, `atproto`, or `null` (refused).
- `readVault(files) -> { blocks, channels, entities, sources, problems: [{path, problems}], items(channelPath) }`.
  - Every folder that holds a block or channel, and each folder above it, is a channel; those without `_channel.md` have `implicit: true`.
  - It reports duplicate IDs, duplicate block slugs (an ambiguous `[[slug]]`), `channels` naming no folder, and `from` naming no source.
  - `items` lists the channel's `order` first, then the remaining child channels and blocks newest first (`created`, then ID).
- `evidence(vault) -> [{ kind, from, to, at }]`, with kinds `contains`, `links`, `embeds`, `mentions`, `from` and `quotes`.
  - `at` is the line number counted from the start of the body (after the frontmatter), or the property it came from (`folder`, `channels`, `connect`, `from`, `excerpt`).
  - Targets are node keys, or `url:`, `at:`, `file:<name>`, or `missing:<as written>`.
  - Fenced code and inline code spans are skipped, and so are e-mail addresses.
  - `[[x]]` resolves against block slug, path, file name and title, then entity slug, name and aliases.

## Roots and the index

[vault/roots.mjs](../../vault/roots.mjs): `readConfig(json, { vault, home }) -> { roots, problems }` for `.vault/config.json` (`CONFIG`).
- Each root has `name`, an absolute `path` (`~/` expanded), `mode`, `channel` (default: the name), `include` and `exclude` globs (`globTest`), and `retain` (default `reference` for a Drive path, otherwise `text`).
- The canonical root is the vault folder itself, named `vault` (`CANONICAL`). It is implicit, and that name is reserved.
- `mode` is `read` only. `two-way` is refused with a message saying it is not built.
- A root may not be the vault itself, be inside it, or contain it. A bad entry is dropped with a problem; the other entries still apply.

[vault/indexer.mjs](../../vault/indexer.mjs). Node only (fs, `node:sqlite` passed in as `DatabaseSync`).
- `openIndex(vault, { DatabaseSync })` opens `.vault/index.sqlite` (`INDEX`).
  - A different `INDEX_VERSION` drops every table and recreates the schema.
  - An unreadable file is renamed `index.sqlite.damaged-<ms>` and recreated.
  - The index is derived data only and never the sole copy of anything.
- `scan({ vault, db, home })` walks the vault (excluding `.`-prefixed entries and `node_modules`, never following symlinks) and each root (by its `takes(relative)`).
  - **Stamps:** a file is re-read only when its stamp `ino:size:mtimeMs:ctimeMs` changes.
  - **Reading:** `reference` roots are never opened (`hash` null). Other files are read and addressed with `blobCid` (CIDv1 raw SHA-256). A `full` root's bytes are copied to `.vault/cache/<cid>` atomically.
  - **Kept text:** in the vault, only `.md` text. In a `text` or `full` root, any `TEXT_ENDINGS` file.
  - **Moves:** a file is moved when it vanishes from one path and appears at another in the same root with the same hash, or the same inode and size.
  - **Unavailable roots:** an unreadable root keeps its rows and adds a problem. A root removed from the configuration has its rows deleted.
  - **One transaction:** nodes, edges, terms and problems are rebuilt from the `files` table in the same transaction.
  - **Report:** `{ roots[{name,path,files,available}], added, changed, removed, moved, unchanged, opened, cached, problems[{root,path,problems}], nodes, edges }`.
- How root files become nodes:
  - A root's `.md` with kept text is read through `readNode` at `<channel>/<relative>`, and given `origin` = its absolute path when it has none.
  - Any other root file becomes a block. Its `kind` is `code` for `CODE_ENDINGS`, `media` for image, video and audio, and `file` otherwise. Its `slug` is `<name>-<ending>`, its `title` is the file name, and its `origin` is the absolute path.
  - Keys follow `nodeKey`, so a block without an ID is `block:<path>` (the virtual path for root files).
- `inspect(db, ref)` looks a node up by key, then slug (blocks first), then path or file. It returns `{ key, node, root, origin{where,kind}, file{root,path,abs,size,mtime,hash,cached,seen}, out[], in[] }`.
- `search(db, query, { limit })`: `words()` lowercases, splits on non-letters and digits, and splits Korean, Japanese and Chinese runs into character bigrams. Results are ranked by the number of distinct matched terms, then summed weight (title, slug, aliases and tags weigh 2; body and a root's text 1). This does not use FTS5, because Node 22.12's SQLite lacks it.
- `summary(db)` gives counts by table and by root, plus the last scan time.

Tables: `meta`, `files(root,path,…)`, `nodes(key,…,node JSON)`, `edges`, `terms`, `problems`. Never write to them outside `scan`.

CLI: [scripts/vault.mjs](../../scripts/vault.mjs), run as `ohm vault init|add SOURCE|index|status|inspect REF|search WORDS|hook|rename REF [TO] [--vault DIR] [--limit N] [--channel C] [--title T] [--by agent:NAME] [--move] [--agent NAME]`. `init` also creates the vault folder. It defaults to `OHM_VAULT_FOLDER`, then the current folder. It prints JSON and exits 1 with a sentence on failure. Without `node:sqlite` it re-runs itself with `--experimental-sqlite`. It makes no network calls.

## Journal and provenance

[vault/journal.mjs](../../vault/journal.mjs) manages `.vault/journal.jsonl` (`JOURNAL`).
- The journal is append-only. It is **not** derived data: never truncate or rewrite it, and sync it with the vault.
- Event shape: `{ at, op, root, path, from?, origin?, by, via, session?, hash? }`.
  - `op` is one of `added`, `changed`, `moved` (needs `from`), `removed`, `written`, `copied-from` (needs `origin`), `downloaded-from` (needs `origin`) or `renamed` (needs `from`: the old name; `path` is the block's file, or the channel's folder, now).
  - `by` is `me`, `unknown` or `agent:<name>`.
  - `via` is `add`, `hook`, `scan`, `editor` or `sync`.
- `appendEvents` checks every event, then writes all of them or none, in one append.
- `readEvents` skips unparsable lines and counts them. `scan` reports that count as a problem.
- `downloadedFrom(abs)` works on macOS only. It reads `com.apple.metadata:kMDItemWhereFroms` with `xattr -px`, decodes it with `plutil`, and returns only addresses. On other systems it returns `[]`, and also on error.

How `scan` writes the journal: after walking, and **before** the index transaction commits, it appends:
- for each added file, `added`, unless an `add`, `hook` or `editor` event since the last scan already said `added`;
- `changed`, `moved` and `removed` events;
- for a new file in the vault folder that has no stated origin, `copied-from` when its content address matches another indexed file (read-only roots preferred);
- for a new non-`.md` file, `downloaded-from` from macOS;
- then, inside the rebuild, `renamed` events for what `renamesBetween` finds (below), appended and loaded into `events` before the vault is read a second time.

## Former names

[vault/names.mjs](../../vault/names.mjs). Pure; no disk. Plan: [renames.md](../../plans/renames.md), step 1.
- `formerNames(events)` → `{ channels: Map<old path, path now>, blocks: Map<nameKey(old name), file now> }`, from the vault root's `moved` and `renamed` events in order. A later event wins for a name. Chains are followed (`notes` → `journal` → `diary`), cycles stop.
  - `moved`: the file's `pathNames(from)` (the path, the file name and `slugOf` it, as `nameKey`) name the new file; a moved `_channel.md` names its folder's move.
  - `renamed`: a `from` ending in `.md` gives its `pathNames`; any other `from` with a `.md` `path` is one block name; with a folder `path` it is a channel's old path.
- `renamesBetween(before, vault, { moved, at })` → `renamed` events (`root: 'vault'`, `by: 'unknown'`, `via: 'scan'`):
  - a block found again (by `id`, else by its file's move, else at the same path) that lost its old slug or title, unless the move's `pathNames` already cover it; and its old path when no move says so;
  - a channel whose path is gone: by `id`; else, when every block anywhere under it now sits under one other folder in the same place inside it (`notes/2026/x` → `journal/2026/x` gives `notes` → `journal`). A moved `_channel.md` is left to its `moved` event. Folders whose blocks split are not taken for a rename.
- `readVault(files, { nodes, former })`: before its checks, a block's `channels` entry or a channel's `order` entry that names nothing now, but a former name does, is put on the node it names now, and a problem says the name to write. A current name always wins.
- `evidence(vault)`: a `[[link]]`, `![[embed]]` or `connect` target that only `vault.former` explains resolves to that block, and its edge carries `former: <the name written>`. `scan` lists each as a problem on the linking file.
- `scan` reads `nodes` before the rebuild as `before`; reads the vault with `formerNames` of the `events` table; writes `renamesBetween`'s events to the journal and `events`, and reads the vault again if there were any. `report.renamed` is `[{ from, to }]`. There is no table of names: the journal is the record, so a deleted index loses nothing.
- `inspect(db, ref)` falls back to former names (a channel's old path, a block's old name) and then says `formerly: ref`.

## Renaming through ohm

[vault/rename.mjs](../../vault/rename.mjs). Plan: [renames.md](../../plans/renames.md), step 2.
- `planRename(files, change, { paths, newId })` is pure. `change` is `{ channel, to }` (any `change` without `block`) or `{ block: <file path>, slug?, title?, channel? }`. It returns `{ kind, from, to, moves, folder?, writes: [{ path (after the moves), before?, after }], renamed: [{ path, from }], id? }`.
  - **Channel:** refuses an unknown channel, a bad path, the same path, a path inside itself, or one where any file already is. Every file under it moves (`folder` is moved whole). Rewrites `channels` entries and `order` entries that are channels, and any `[[…]]`/`![[…]]` target starting with `<from>/`. Gives the channel an `id` (makes `_channel.md` if it had none). `renamed` lists the channel and every channel inside it.
  - **Block:** refuses no change, a bad slug or title, a slug another block has, or a taken path. A new slug renames the file to `<slug>.md` (and drops a `slug` property); `channel` moves it. A link is rewritten only when `blockResolver` of the vault resolves it to this block, keeping its form: slug → new slug, path → new path, file name → new name, title → new title; `|words` and `#part` are kept; file embeds (`![[x.png]]`), fenced code and code spans are not touched. `connect` entries and `order` entries naming the old slug follow. `renamed` holds the old title, and the old slug when it was a property.
- `applyRename({ vault, plan, by, via = 'rename', may, keep, now })` refuses before touching anything if `may` denies the node's own old or new path or any move. It moves, then writes each file only if it still holds what was read; a file `may` denies or that changed is skipped into `left: [{ path, why }]`. It journals in one append: `moved`, `added` or `changed` (with `before`/`hash` from `keep`), and `renamed`, all `via: 'rename'`. Returns `{ kind, from, to, id?, moved, written, left, journaled }`. Callers hold the collect lock (`withCollectLock`, exported by `mcp/local.mjs`) and rescan.
- `readVaultFolder(vault, { open })` gives `{ files, paths }`: every non-hidden file's path, and the Markdown outside `_sources/`.
- `scan` pairs a file a tool journaled as `moved` since the last scan with its old path even when its bytes changed, does not journal that move again, treats `via: 'rename'` like `write` for `changed`, and drops learned `renamed` events the journal already has. So a rename is journaled once.

`by` comes from the latest non-scan event for that path since the last scan (`meta.scanned`); otherwise it is `unknown`. The whole journal is then loaded into the `events` table. A crash between the append and the commit can repeat an event; it cannot lose one. `INDEX_VERSION` is 3. `history(db, root, path)` follows `moved` events backwards, and `inspect` returns it as `history`.

[vault/add.mjs](../../vault/add.mjs):
- `addToVault({ vault, source, channel = 'inbox', by = 'me', title, move })`:
  - **Absolute path:** a file only. It refuses folders, anything already inside the vault, and missing files.
  - **`.md` file:** written with `setProperty` for `origin` (only if absent), `title`, `created`, and `by` plus `status: proposed` for agents.
  - **Any other file:** copied with `COPYFILE_EXCL` (or moved, falling back to copy then unlink across devices), plus a block `<slug>.md` with `kind` (`code` for `CODE_ENDINGS`), `title`, `origin`, the same marks, and body `![[name]]`.
  - **HTTP(S) address:** `_sources/<id>/source.json` (`retain: reference`) plus a link block with `from`. No network call.
  - **Names:** taken names get `-2`, `-3`.
  - **Inbox:** `inbox/_channel.md` (`kind: inbox`) is made on first use.
  - **Journal:** `added` events with `via: add`.
- `hookEvent(input, { vault, agent })` maps Claude Code PostToolUse JSON (`tool_name` in `WRITING_TOOLS`, `tool_input.file_path`/`notebook_path`, `cwd`, `session_id`) to a `written` event. It returns `null` outside the vault, for `.`-paths, for other tools, and for an invalid agent name.
  - `ohm vault hook` reads stdin, writes no output, never loads SQLite, and always exits 0.

## MCP entry points

- `ohm vault mcp --vault /path/to/vault --agent example` launches the local stdio server, [mcp/local.mjs](../../mcp/local.mjs). The server name is `ohm-vault`. Select the vault explicitly, via `OHM_VAULT_FOLDER` or by launching within a home. The process reads the selected folder and its configured roots. It has local plaintext access and no connection to the encrypted service store.
- Run `vault_index` for the scan report. `vault_local_search({query, limit?})` searches the current index. `vault_local_read({ref})` accepts a key, slug or indexed path and returns `inspect` output, including file stats and history. `vault_neighbors({ref, direction?, kind?, depth?})` follows evidence up to five levels with at most 200 edges. Those three reads have `readOnlyHint`.
- `vault_capture({source, channel?, title?})` uses `addToVault`. It accepts HTTP(S) references or files included by a configured root with text or full retention. The Inbox is the default. It records `by: agent:<name>`, `status: proposed` and journal events with `via: add`.
- `vault_collect({block, channel, position?})` adds canonical block membership and creates or updates `_channel.md` order. Position is zero-based. It appends `via: collect` events for changed files. Capture and collect rescan before returning. A SQLite lock in `.vault/collect.sqlite` serializes local MCP collections across processes. If another collection holds it, retry the request.
- **Where data lives.** `vault_where()` returns the canonical vault's top channels and kinds, each configured root (`name`, `channel`, `where` local or drive, `path`, `retain`, `include`, `exclude`, file count, kinds, the person's `note` from `.vault/config.json`, `writable: false`), the calling agent's grant, and config or grant problems.
- **Semantic lint.** `vault_lint({limit?})` ([vault/lint.mjs](../../vault/lint.mjs)) returns candidates only: `problems`, `missing` targets, `orphans` (no edge but `contains`), `related` (block pairs with no edge sharing ≥3 terms held by 2..max(3, 5% of blocks) blocks), `sameTitle`, `proposed` (oldest first), and `next`. The agent judges them ([skills/lint](../../skills/lint/SKILL.md)); conclusions go to cortex observations. `ohm vault lint` prints the same.
- **Grants.** `.vault/grants.json` ([vault/grants.mjs](../../vault/grants.mjs)): `{ agents: { <name>: { write: [scope], link: [scope] } } }`. A scope is a channel path, `_entities[/kind]`, or `*`, and covers that folder and everything under it; write includes link. Only `ohm vault grant|revoke|grants` changes it; every tool refuses paths with a `.` segment, `_sources/` and non-`.md` files. With no grant an agent keeps capture and collect only. A refusal names the exact `ohm vault grant` command.
- **Writes.** `vault_write({path, text, replaces?})` makes or replaces a block, channel or entity; `replaces` (the current `blobCid` of the file, `file.hash` from `vault_local_read`) is required for an existing file and refused for a new one. The text must read through `readNode` with no problems. A new non-post block without `by` gets `by: agent:<name>`. `vault_remove({path, replaces})` removes. `vault_link({from, to, note?})` appends `- [[slug]] note` to the block (joined to a trailing list of links), and is a no-op when `[[slug]]` is already there. `vault_restore({path, to, replaces?})` writes a kept version back. `vault_rename({ref, to?, title?, channel?})` renames a channel (`to` its new path) or a block (`to` its new slug, a `title`, a home `channel`) through `planRename`/`applyRename`: it needs write on the node where it is and where it goes, and leaves references in files without a grant (listed in `left`). All five take the collect lock.
- **History.** Before and after every write, link, remove and restore, the text is kept once at `.vault/history/<blobCid>`; the journal event has `via` `write`, `link`, `restore` or `rename`, `before` and `hash`. `scan` does not repeat a `changed` or `removed` event a tool already wrote with the same hash. `vault_history({path, limit?})` lists events newest first with `beforeKept`/`hashKept`. The person restores with `ohm vault restore PATH ADDRESS` (journaled `by: me`, no grant needed).
- The service tool registry is [mcp/tools.mjs](../../mcp/tools.mjs). The [generated request map](../../service/CAPABILITIES.md) includes Friends listing, reading, saving, deleting and removing access. Saves, deletions and friend removals return a preview and require the same request and its `confirm` value after person approval. Pass the last-read `version` as `replaces` for save or delete. Shared reads use the reader's own DID. The `addFriend` and keys requests require an ohm session.
- The service tool results exclude private post bodies, search passages and tree entries. Publish removals carry a record key and a generic reason. Private drafts are device-local captures. [mcp.test.mjs](../../test/mcp.test.mjs) exercises the service tools against SQLite and a simulated PDS. [local-mcp.test.mjs](../../test/local-mcp.test.mjs) exercises the local tools and stdio.
- [words.mjs](../../vault/words.mjs) normalizes and tokenizes text without platform imports. The local index and the cortex vault reader both use it.

## Cortex contract

[vault/cortex.mjs](../../vault/cortex.mjs): `openVault({ path })` (what the cortex calls for `{ kind: 'module', module, path }`) and `cortexVault(vault, { home })`. They implement ohm-cortex's `src/vault.mjs` contract (`OPERATIONS`: `shape`, `read`, `exists`, `changes`, `profile` and `search`).
- **Read-only, as cortex's rule 3 requires.** It never opens the index and writes no journal or cache. It walks the vault (only `.md` files and `_sources/*/source.json`) and each configured root itself, caching file text in memory by stat stamp. Reference-only roots are only `stat`ed. It does not depend on `node:sqlite`, and it loads on Node 22.12 without a flag.
- **Compatibility with cortex's `folderVault`:**
  - IDs are `id ?? 'path:<node path>'`.
  - A block's channel is `home || 'other'`, and a channel counts every block under it.
  - The cursor has the same shape, `{ [id]: { title, channel, hash } }`.
  - The hash is `sha256(text).hex.slice(0,16)` (identical to cortex), or `size:mtime` for files whose text is not read.
  - Legacy `label`/`sublabel` cursor entries are accepted.
- Only blocks are blocks. `shape().problems` includes config problems, unreadable roots and `readVault` problems.
- `search` ranks by distinct matched words, then weight: title, slug and tags count 2, body 1. It returns at most 50.
- `profile()` returns `[]`.
- **The cortex side** is `cortex/src/vault.mjs` in this repository (`moduleVault`).
  - `vaultFrom` accepts `{ kind: 'module', module: <absolute file>, path: <absolute folder> }`, and `moduleVault` imports the file on first use and checks the vault it returns with `checkVault`.
  - The CLI form is `cortex vault connect <folder> [dir] --module <file>`.
- Verified end to end: on a vault holding `writing/_channel.md`, one essay and `_entities/person/ada.md`, cortex's folder reader reported 4 channels and counted the channel file and the entity as blocks. This reader reported 2 channels and the single block, and created no `.vault/`.

## Friends layer (service)

[service/src/blocks.mjs](../../service/src/blocks.mjs), capability [Friends](../../service/src/capabilities/friends.mjs), tables `blocks` and `friends` ([schema.sql](../../service/schema.sql); existing databases need [migrations/0002_friends_layer.sql](../../service/migrations/0002_friends_layer.sql), not applied automatically).
- `friendsBlock({ id, path, text })` accepts only a non-post block whose `readNode` result has `visibility: 'friends'` and no problems.
  - It refuses (`InvalidBlock`) private and public blocks, post files, paths that are not block files, extra keys, a non-TID `id`, and a file whose `id` property differs from `id`.
  - Text over 600 KB is `TooLarge`.
- `blockStore(db)`:
  - `list`, `read`, `write` and `remove` mirror the post store: CAS on `replaces` inside the SQL statement, `Changed` with `current`, removals kept as version-null rows for `since`. A path taken by another block is `PathTaken`. Versions are `recordVersion({ path, text })`.
  - Friends: `friends`, `addFriend` (DID regex, not self) and `removeFriend`.
  - What a friend reads: `shared(owner, reader)` and `readShared(owner, reader, id)`. These return friends-only blocks plus friends-only posts (as `postFile` output), and only when `reader` is on `owner`'s list and is not `owner`. Otherwise they answer `NotFound`, identical whether or not the owner exists or has anything.
- Requests:
  - `listBlocks`, `getBlock`, `putBlock`, `deleteBlock`, `listFriends` and `removeFriend` are `member`.
  - `addFriend` is `ohm` (session only), so no token-holding agent can widen access.
  - `listShared` and `getShared` are `token`. The token path runs `admitMember`, so a friend must be admitted by `MEMBERS`.
- The Friends MCP tools use these requests. Editor and folder sync integration, channel-level groups and moving legacy private posts out of D1 remain future work.

## Use

```js
import { readVault, evidence, nodeFile } from './vault/node.mjs';
const vault = readVault(files);            // files: [{ path, text }] relative to the vault root
const edges = evidence(vault);
const { path, text } = nodeFile({ ...vault.blocks[0], channels: ['reading'] });
```

## Verification

From the repository root: `node --test test/node.test.mjs`, `node --experimental-sqlite --test test/indexer.test.mjs test/provenance.test.mjs`, then `npm test` for the whole suite (the post-file tests prove nothing about posts changed). Not verified: a real Google Drive mount; the reference-only path is tested with an unreadable file instead.

## Maintenance

When a field changes, update the lexicon, the `*_FIELDS` constant, the reader and writer in `node.mjs`, both guides, and the test. Keep evidence free of model output; anything inferred belongs in ohm-cortex.
