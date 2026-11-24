---
name: design-home
description: The curator's first job. Screen every source a person already has (site folders, feeds such as Substack, PDS records, local folders) read-only, report it with the fixed home report template, discuss it with the owner item by item, and apply only what they decided. Use when someone starts a home from what they have, connects a new site, feed or folder, or asks how their vault should be organised. Run it as the curator agent.
---

# Design a home

You are the [curator](../../agents/curator.md). A person has content in several places and no structure for it yet, or a structure that has drifted. You find out what is there, show them, ask, write down what they decide, and apply exactly that. Four steps, in order: **screen, report, discuss, apply**. Do not skip ahead: nothing is applied before the owner has decided it.

Read first: [docs/labels.md](../../docs/labels.md), [suggest-labels](../suggest-labels/SKILL.md), and the [home report template](../../docs/agents/home-report.md). The words (block, channel, connect, media record, PDS boundary, personal boundary) are the ones in the ohmmmm repository's `docs/words.md`.

## The rules for this skill

- **Read-only until the decisions log says otherwise.** Screening changes nothing anywhere: not a site's files, not its git repository (no `fetch`, no `pull`, no checkout), not the vault, not the PDS.
- **Labels are the owner's words.** In the report every name still to choose is `?`. You may quote names you found ("as found: writing/"), and offer the plain starting point from suggest-labels once. You never name a label, a sublabel or a channel.
- **Record in place.** Media and notes become records, path + metadata. No bytes are copied, moved or renamed.
- **Two boundaries.** PDS: public posts only, written only when the owner publishes. Personal: everything else, Private by default.
- **Counts, not content.** Private-looking material is reported by folder, kind and count. Never quote it, never send it to a model or service outside this session.

## 1. Screen

For each source, read only, and note how you read it so the owner can check.

| Source | How to read it | What to count |
| --- | --- | --- |
| A site folder | `find <dir> -type f` grouped by top folder and extension; `git -C <dir> ls-files` for what is tracked; the home page's and section pages' `href`s for the nav | pages, images, video, audio, data, code; what the nav links, what is only reachable by address, what is not in git |
| A feed (Substack, any RSS or Atom) | `WebFetch` or `curl` the feed address (`<name>.substack.com/feed`) | items, their slugs, which are also on the site |
| A PDS | Resolve the handle (`_atproto.<handle>` TXT, or `/.well-known/atproto-did`), read the DID document's PDS, then `com.atproto.repo.describeRepo` and `listRecords` per collection | collections, records per collection, whether they are `com.ohmmmm.post` and carry a label |
| A local folder of notes or media | `find`, grouped by subfolder and extension | files by kind, subfolders, sizes |
| Posts already in ohm | `npx github:haeinej/ohmmmm posts` | published posts, their labels |
| The vault, if there is one | `vault_index`, `vault_where`, `vault_lint` | roots, channels, blocks with no channel |

Mark as you go:

- **Drafts:** pages present but not linked, pages with no date, files named draft.
- **Private-looking:** notes, research, journals, correspondence, anything with personal context, third-party text the owner holds a copy of, folders kept out of git. These start personal and Private, and the report says why in one line.
- **Variants:** thumbnails and small copies of the same media (`thumb/`, `vidsm/`). They are one record with variants, not two.
- **Duplicates:** the same piece in two sources (a site essay that is also a Substack post).

### Traces of how they file things

Before proposing a structure, read the journals. They show the person's habits better than any default.

- `.vault/journal.jsonl`, read as a file: the vault-wide record. `moved`, `changed` and `added` events `by: me` are the person's own filing. (`vault_history` gives one file's events only, by its `path`; use it to follow one block.)
- The cortex journal (`cortex_history`): observations about channels, corrections, what was declined.
- `cortex_recall` with `needs: curator`: what working agents flagged.
- The **agenda**, when the person's vault service serves one (`com.ohmmmm.vault.getAgenda`): a list the service makes without a model, of flags waiting, blocks with no channel and records with no label. No local tool reads it yet; when it is not reachable, make the same list yourself from `vault_lint` and `cortex_recall` with `needs: curator`. Treat each entry as a candidate for the report, never as a decision.

When there is no vault or cortex yet, say so in the report: there are no traces to read.

## 2. Report

Fill the [home report template](../../docs/agents/home-report.md), every section in order, and show it to them in the conversation. Writing it is a change, so it waits like any other: keep it only if they say where (their first row in the decisions log), then save it as a **private block** through the vault's tools: `vault_write` where your grant allows, otherwise `vault_capture` into the Inbox as a proposal. Never in a site folder, and never with a plain file write.

Propose channels by **shape**, not by name: "one channel would hold the 19 essays; it is `?` (as found: writing/)". Put every naming question in Open label questions, one decision per row.

## 3. Discuss

Go through the report with the owner one item at a time, in the report's order: sources, then each part, then channels, then labels, then PDS or personal. Ask one or two questions at a time and wait. Use suggest-labels' questions for names.

After each answer, add a row to the **decisions log** in their words, with the date. Read it back when a section is done. An item they leave open stays open; do not settle it for them.

## 4. Apply

Only rows in the decisions log, and only within the grant `vault_where` shows. Each through the existing path:

| Decision | How |
| --- | --- |
| A folder becomes a root | The person adds it to `.vault/config.json` under `roots` (you may draft the entry): their name for it, the absolute path, `retain: text` for notes and `reference` for large media, `exclude` for what they kept out (`.DS_Store`, thumbnails if they said so), and a `note`. Then `vault_index`. This is the connect flow's "record in place": nothing is copied, and nothing is written in a root ([roots](../../docs/agents/vault-format.md#roots-and-the-index)). Do not use `ohm vault add` for a site's files: it copies Markdown into the vault |
| A channel for a root's files | The root's `channel` in `.vault/config.json`, in their words: every file in the root is filed under it, and its subfolders become sub-channels. To split a root across channels, make it two roots, or `exclude` what goes elsewhere. `vault_collect` refuses blocks in a root, and capturing a copy breaks "record in place", so never do either to file a root's files |
| A channel for a block in the canonical vault | `vault_collect({ block, channel })` per block, channel names in their words |
| Media records | Recorded by the root's scan; fill alt text and dimensions only from what the site says. Missing alt text stays missing |
| A label or sublabel for a post | Write it in the decisions log in their words, with [suggest-labels](../suggest-labels/SKILL.md) step 5. You do not publish: the owner uses it with the publish command's `--label` and `--sublabel` when they publish. There is no command yet to relabel a post already published; list those for them |
| A site moves onto records | [migrate-site](../migrate-site/SKILL.md), from its first step |
| PDS records under an old type | Report only. Moving them to `com.ohmmmm.post` is migrate-site's, with the owner's approval and a preview |

Write each change's ID into the decisions log. Then one `cortex_observe` per settled question, of your own, `about` the channels or blocks, with their decision as the text (and `settles` for any flag it answers). Finish with `cortex_session`.

Never publish in this skill. Publishing is the owner's, through the publish command or Publish in the workspace, after a preview.
