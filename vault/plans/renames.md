# Renaming breaks nothing

**Status:** decided by the owner, 24 November 2026. Steps 1 and 2 are built (`vault/vault/names.mjs`, `vault/vault/rename.mjs`). This settles decision 5 in the [app handoff](../../docs/handoff/devin-ohmmmm-app.md): channels get stable IDs, and renaming a block or a channel breaks nothing, as on Are.na.

## Why

On Are.na you can rename a channel or a block and every connection holds, because everything is joined by ID. Blocks here have IDs, but most things point at them by name:

| What points | By | Read in |
| --- | --- | --- |
| A block's `channels` list | Channel path | `readBlock`, `vault/vault/node.mjs` |
| A channel's `order` | Block slug; a child channel's path | `items` in `readVault` |
| `[[links]]` and `![[embeds]]` | Slug, path, file name or title | `evidence` |
| The cortex's reader | Channel path | `contract/vault-reader.mjs` |
| Coming: a site's Astro config, `com.ohmmmm.channel` records, links into the app | Channel | [content-layer.md](content-layer.md), [standard-site.md](standard-site.md) |

Renaming a folder, a file, a slug or a title can break any of these. A channel may already carry an `id` in `_channel.md` (`readChannel`; the channel lexicon says a folder without one has "no ID yet"), but nothing points at it.

## The rules

1. **Every block and every channel has an ID.** Blocks already do. A channel gets one the first time ohm writes its `_channel.md`, and ohm writes that file whenever the channel is renamed, ordered or described, or something outside the vault points at it. A folder no one has touched stays a channel with no ID yet, as now.
2. **People write names; everything outside the files holds IDs.** In files, people keep writing paths and slugs (`channels: [essays]`, `[[on-rain]]`), so the folder stays readable in Obsidian or any editor. Site configs, `com.ohmmmm.channel` records (keyed by the channel's ID), links into the app, cortex memories and the journal hold IDs.
3. **An old name keeps working.** Every name a node has had (path, slug and title) is kept in the journal, as `moved` and `renamed` events, and the index reads it from there, so deleting the index loses none. A reference written with an old name resolves to the same node, and is listed as something to tidy, not as a break. A current name always wins over a former one. The scan learns former names however the rename happened:
   - **A node with an ID** that turns up under a new path, slug or title: its file still carries its `id`.
   - **A file moved outside ohm** (Finder, Obsidian, `git mv`): the scan already finds moves by hash and inode, and writes `moved` with `from`.
   - **A folder with no ID:** when every block in it turns up in one new folder, the scan records the channel's move.
4. **A rename through ohm also rewrites what used the old name,** in one journaled change, as Obsidian does: `channels` lists, `order` entries, `[[links]]` and `![[embeds]]`. Each file is written with its version check. A file that changed in the meantime is left to rule 3 and listed. Private blocks are rewritten on the device, like every private write.
5. **Published addresses redirect.** A channel's move changes no label (labels are its `site` property), so no address changes. Changing a published block's slug or label changes its address (`/posts/<label>/<sublabel>/<slug>`), so the loader gives the site the former addresses to redirect.

## What changes

| Where | Change |
| --- | --- |
| `vault/vault/names.mjs` (new, built) | `formerNames(events)` reads old names from the journal; `renamesBetween` finds what a scan saw renamed |
| `vault/vault/node.mjs` | Built: `readVault` (`former`) and `evidence` resolve `channels`, `order` and links through former names. Still to come: `order` may also hold IDs |
| `vault/vault/indexer.mjs` | Built: `scan` writes `renamed` events and reads the vault through former names; `inspect` finds a node by an old name. No table of names, and no new `INDEX_VERSION`: the journal is the record |
| `vault/vault/journal.mjs` | Built: `op: 'renamed'`, and `via: 'rename'` for renames made through ohm. Path changes stay `moved` with `from`. The scan journals a tool's rename once |
| `vault/vault/rename.mjs` (new, built) | Rename or move a block or a channel: move the files, give a channel its ID, rewrite references and journal it, under the collect lock |
| `vault/mcp/local.mjs`, `vault/scripts/vault.mjs` | Built: `vault_rename` (needs `write` where the node is and where it goes; references in files without a grant are left, listed, and keep working) and `ohm vault rename` |
| `contract/vault-reader.mjs`, `vault/vault/cortex.mjs`, `cortex/src/vault.mjs` | Channels carry their `id` when they have one. Nothing is removed; `test/home.test.mjs` keeps the three together |
| Lexicon `com.ohmmmm.vault.channel` | `order` items may be IDs |
| `app/` | `ChannelRecord.id` stays and comes from `_channel.md`; the tree, the graph and links key channels by ID; a rename in the app goes through the same handler as the agent tool |
| `docs/words.md` | Channel: named by its path, known by its ID. A new word, **former name** |
| `vault/docs/vault-format.md` and `vault/docs/agents/vault-format.md` | These rules |

## Order

1. **Former names,** with moves of files and folders detected. Built: from here on nothing breaks, even after renames made outside ohm (`vault/test/renames.test.mjs`).
2. **`ohm vault rename` and `vault_rename`,** which rewrite references. Built (`vault/test/rename.test.mjs`). Only the renamed channel gets an ID; channels inside it move without one, and their old paths are journaled.
3. **Channel IDs through the contract,** the app and `com.ohmmmm.channel` records.
4. **Former addresses in the loader** ([content-layer split](../../docs/handoff/content-layer-split.md), D1), so sites redirect.

## Open

- Whether a reference that resolves through a former name is rewritten by the next `ohm vault index`, or only listed. Proposed: only listed, because the scan never writes files.
