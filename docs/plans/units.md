# Plan: one unit for everything in a home

Status: plan, 27 November 2026. Branch `refactor/units`, off `canvas-tldraw`. Step 1 is built; the rest is not.

## Why

The workspace (the new UX: rack, Home tree, main viewer) shows one tree of things: the site, Agents, Collections. Underneath, each thing is read a different way: blocks and channels by `vault/vault/node.mjs`, the cortex's files by `cortex/src/folder.mjs`, the profile and its wallet by `home/site.mjs`, the site's files by the site routes. Every new view, tool and feed has to learn all of them. This plan gives them one shape, a **unit**, so everything downstream (the app, the bridge, MCP tools, the feed) reads one list.

## The rule

A unit is a file in the home's local checkout, with a path and a type. Nothing is copied to make it a unit: the file stays where it is, and its own reader still owns its rules (a block is still read by `node.mjs`, a skill by the cortex). The unit is the shape every reader returns.

**No new lexicon.** A unit is never written to a PDS: it is a shape in code, a contract like the vault reader's ([contract/unit.mjs](../../contract/unit.mjs)), not a schema. What a unit holds keeps the lexicons ohm already has, and what goes on the network keeps the shared ones other apps read: `site.standard.document` (with `com.ohmmmm.post` inside) and `site.standard.publication` for long posts and the site, `app.bsky.feed.post` for short posts.

| Type | Root | On disk | Lexicon |
|---|---|---|---|
| `block` | Collections | `collections/<channel>/<slug>.md` | `com.ohmmmm.vault.block` |
| `channel` | Collections | `collections/<path>/_channel.md`, or a folder | `com.ohmmmm.vault.channel` |
| `profile` | profile | `profile/profile.md` | Bluesky's profile fields, as now |
| `wallet` | profile | the `wallet` property of `profile/profile.md` | a block kind, `wallet` |
| `artifact` | Site | a content file git tracks in `site/`: a page, a post, an image, a document | a block kind, `artifact` |
| `observation`, `skill`, `tool`, `memory` | Agents | `agents/observations/<id>.md`, `agents/skills/<name>/SKILL.md`, `agents/tools/<name>.md`, `agents/profile.md` | the cortex's own files, as now |

`wallet` and `artifact` join the block kinds in `com.ohmmmm.vault.block` (`knownValues`), so everything in Collections, the profile and the site reads as a block. A unit's fields: `key`, `type`, `kind`, `nsid` (its record's lexicon, when it has one), `root`, `path`, `id`, `title`, `visibility`, `channels`, `by`, `origin`, `created`, `updated`.

- **Key:** blocks and channels keep their node keys (`block:<id>`, `channel:<id or path>`), so the graph, the evidence and the journal don't change. Every other unit is `<root>:<path>`; a wallet is `wallet:<address>`.
- **Path:** always from the top of the home, so one path opens a unit in the app, in the bridge and in an agent's file tools.
- **Visibility:** a block says its own. A channel is as visible as what it holds. The profile and the wallet are public (they are on the identity card). Agents' files are private. A site artifact is public, because the site is.

## Left out for now

- **Sources** (connected repositories, sites and feeds as channels with `source:`) and the **Mind** panel from [information-and-viewer.md](information-and-viewer.md). They come back later as unit types; nothing here stops them.
- The vault's `_entities/` and `_sources/` stay as they are and are not units.
- The cortex's code and tool names stay `cortex` ([docs/words.md](../words.md)); people see its units under **Agents**.

## The feed

One feed in the main screen, newest first, from three places. Everything that goes on the network uses lexicons other apps already read; ohm adds none for the feed.

1. **Your home:** your units, filtered by who is looking (`feed(units, { audience })` in [contract/unit.mjs](../../contract/unit.mjs)): you see everything, a friend sees public and friends units, everyone sees public ones.
2. **What you published:** your `site.standard.document` posts (with `com.ohmmmm.post` inside) and your short posts, `app.bsky.feed.post`, read back from your PDS.
3. **The network, live:**
   - **Following, first:** posts from the accounts you follow (your `app.bsky.graph.follow` records) and your friends.
   - **Discover:** a second tab, wider than who you follow.

### Short posts

- A short post is a block in Collections, like everything else, of its own kind. Publishing it writes an **`app.bsky.feed.post`** to your PDS, so it shows on Bluesky, **and** it shows on your site, read from the PDS as your other posts are. A long piece still publishes as `site.standard.document`.
- Links, @mentions and #tags become Bluesky facets; images become its image embed; a reply or a quote names the other post by its AT URI.
- It goes through Publish like any post: a preview, then your confirm, written by the bridge with the app password, which never reaches the browser. An agent may draft a short post; it never publishes one or takes one down.

### Live from the network

- The bridge (`ohm serve`) connects out to **Jetstream**, Bluesky's JSON firehose, with `wantedDids` set to who you follow and your friends, and keeps a short cache on your computer. The app reads it from a new `/feed/live` route, behind the same app key as every route. Connecting out does not change the rule that the bridge answers only this machine.
- **Discover** is read from a Bluesky feed generator (`app.bsky.feed.getFeed`) rather than the whole firehose, which is far more than one computer should take in.
- Posts from the network are other people's words: the app shows them as untrusted content, and any agent tool that reads the feed says so (`untrustedContentHint`).

### Rendering

One post card for every post in the feed, yours or anyone's: text with its facets, images, a link card, a quoted post, and its place in a reply thread. A long post shows as a card with its title and opening, and opens full size in the main viewer. Your own units show as their tile.

## Order of work

1. **The unit model.** *Built:* `contract/unit.mjs` (pure: a file in a home to a unit, and the feed), `home/units.mjs` (reads every unit in a home from disk), tests in `test/units.test.mjs`. *Changed 27 November:* no unit lexicon (`unit.json` and `UNIT_NSID` are gone); `wallet` and `artifact` are block kinds (the block lexicon's `knownValues`, `BLOCK_KINDS`, the app's `BlockKind`); a unit with no record of its own carries no `nsid`.
2. **The bridge serves units.** *Built:* `GET /units`, `GET /units?in=<folder>` (one level, `levelOf`) and `GET /units/feed` in `home/serve.mjs`, for app keys only ([docs/serve.md](../serve.md)).
3. **The app reads units, and the tree is a channel view.** *Built for the Home tree* (`app/src/data/units.ts`, `app/src/workspace/UnitTree.tsx`; with no bridge, or one older than `/units`, the same units come from what is loaded). One `Unit` type in `app/src/data/`. The Home tree is the same view as a channel in Collections: folders and the units in them, over the home's folders (profile, Agents, Collections, Site). It loads **asynchronously, a level at a time**: a folder shows its row at once and asks `/units?in=` for what is inside only when it is opened, so a large site or channel never holds up the panel. *Built:* search finds the profile, the wallet and the site's files as units (`workspace.search` scopes `profile` and `site`; `workspace.open` opens a `unit:` id), and the breadcrumb names the part people see (Collections or Agents, not vault or cortex).
4. **Clear what is stale.** Remove the views and modules nothing in the new UX reaches (checked with a dead-code pass, not by eye), and the switches that only served them.
5. **MCP tools read units.** One read tool (`vault_units`) over the list, beside the existing ones.
6. **The feed in the app:** your units and what you published, with the post card.
7. **Short posts:** the block kind, its Publish to `app.bsky.feed.post`, and showing them on the site.
8. **Following, live:** Jetstream in the bridge for who you follow and friends, `/feed/live`, merged into the feed.
9. **Discover:** a second tab, from a feed generator.
