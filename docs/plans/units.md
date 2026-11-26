# Plan: one unit for everything in a home

Status: plan, 27 November 2026. Branch `refactor/units`, off `canvas-tldraw`. Step 1 is built; the rest is not.

## Why

The workspace (the new UX: rack, Home tree, main viewer) shows one tree of things: the site, Agents, Collections. Underneath, each thing is read a different way: blocks and channels by `vault/vault/node.mjs`, the cortex's files by `cortex/src/folder.mjs`, the profile and its wallet by `home/site.mjs`, the site's files by the site routes. Every new view, tool and feed has to learn all of them. This plan gives them one shape, a **unit**, so everything downstream (the app, the bridge, MCP tools, the feed) reads one list.

## The rule

A unit is a file in the home's local checkout, with a path, a type and a lexicon. Nothing is copied to make it a unit: the file stays where it is, and its own reader still owns its rules (a block is still read by `node.mjs`, a skill by the cortex). The unit is the envelope every reader returns.

| Type | Root | On disk | Lexicon (`nsid`) |
|---|---|---|---|
| `block` | Collections | `collections/<channel>/<slug>.md` | `com.ohmmmm.vault.block` |
| `channel` | Collections | `collections/<path>/_channel.md`, or a folder | `com.ohmmmm.vault.channel` |
| `profile` | profile | `profile/profile.md` | `com.ohmmmm.unit` |
| `wallet` | profile | the `wallet` property of `profile/profile.md` | `com.ohmmmm.unit` |
| `observation` | Agents | `agents/observations/<id>.md` | `com.ohmmmm.unit` |
| `skill` | Agents | `agents/skills/<name>/SKILL.md` | `com.ohmmmm.unit` |
| `tool` | Agents | `agents/tools/<name>.md` | `com.ohmmmm.unit` |
| `memory` | Agents | `agents/profile.md`: what the agent knows about the person | `com.ohmmmm.unit` |
| `artifact` | Site | a content file in `site/`: a page, a post, an image, a document | `com.ohmmmm.unit` |

The envelope is `com.ohmmmm.unit` ([vault/lexicons/com/ohmmmm/unit.json](../../vault/lexicons/com/ohmmmm/unit.json)): `key`, `type`, `kind`, `nsid`, `root`, `path`, `id`, `title`, `visibility`, `channels`, `by`, `origin`, `created`, `updated`. Blocks and channels keep their own records; their unit names them by `nsid`.

- **Key:** blocks and channels keep their node keys (`block:<id>`, `channel:<id or path>`), so the graph, the evidence and the journal don't change. Every other unit is `<root>:<path>`; a wallet is `wallet:<address>`.
- **Path:** always from the top of the home, so one path opens a unit in the app, in the bridge and in an agent's file tools.
- **Visibility:** a block says its own. A channel is as visible as what it holds. The profile and the wallet are public (they are on the identity card). Agents' files are private. A site artifact is public, because the site is.

## Left out for now

- **Sources** (connected repositories, sites and feeds as channels with `source:`) and the **Mind** panel from [information-and-viewer.md](information-and-viewer.md). They come back later as unit types; nothing here stops them.
- The vault's `_entities/` and `_sources/` stay as they are and are not units.
- The cortex's code and tool names stay `cortex` ([docs/words.md](../words.md)); people see its units under **Agents**.

## The feed

The feed is the units, newest change first, filtered by who is looking (`feed(units, { audience })` in [contract/unit.mjs](../../contract/unit.mjs)): you see everything, a friend sees public and friends units, everyone sees public ones. In the app it is a main-screen view over the home. The same query over published units backs a public AT Proto feed later.

## Order of work

1. **The unit model.** *Built:* `contract/unit.mjs` (pure: a file in a home to a unit, and the feed), `home/units.mjs` (reads every unit in a home from disk), the `com.ohmmmm.unit` lexicon, tests in `test/units.test.mjs`.
2. **The bridge serves units.** *Built:* `GET /units`, `GET /units?in=<folder>` (one level, `levelOf`) and `GET /units/feed` in `home/serve.mjs`, for app keys only ([docs/serve.md](../serve.md)).
3. **The app reads units, and the tree is a channel view.** One `Unit` type in `app/src/data/`. The Home tree is the same view as a channel in Collections: folders and the units in them, over the home's folders (profile, Agents, Collections, Site). It loads **asynchronously, a level at a time**: a folder shows its row at once and asks `/units?in=` for what is inside only when it is opened, so a large site or channel never holds up the panel. Search and the breadcrumb read units too, and the breadcrumb names the root people see (Collections, not vault).
4. **Clear what is stale.** Remove the views and modules nothing in the new UX reaches (checked with a dead-code pass, not by eye), and the switches that only served them.
5. **MCP tools read units.** One read tool (`vault_units`) over the list, beside the existing ones.
6. **The feed in the app**, then the public feed of published units.
