// Synthetic data for tests only. No real person, no real records. The app never loads it.

import { newNodeId } from "../../../vault/vault/node.mjs"
import type { Doc, Entity } from "../../src/data/workspace-model"

export const owner: Entity = { did: "did:plc:example0wner", handle: "mira.example", name: "Mira" }

export const entities: Entity[] = [
  owner,
  { did: "did:plc:example0june", handle: "june.example", name: "June" },
  { did: "did:plc:example0theo", handle: "theo.example", name: "Theo" },
  { did: "did:plc:example0sana", handle: "sana.example", name: "Sana" },
]

const fixtureId = (index: number) => newNodeId(Date.UTC(2026, 7, 1) + index, 0)
export const fixtureIds = {
  garden: fixtureId(1), slow: fixtureId(2), address: fixtureId(3), monday: fixtureId(4), tokyo: fixtureId(5), tokyoTwo: fixtureId(6),
  scans: fixtureId(7), workspace: fixtureId(8), reading: fixtureId(9), sketches: fixtureId(10), dusk: fixtureId(11), paragraphs: fixtureId(12),
  privateFirst: fixtureId(13), captions: fixtureId(14), renameJournal: fixtureId(15), suggestChannels: fixtureId(16), search: fixtureId(17), slowness: fixtureId(18), byAgent: fixtureId(19),
}

export const blocks: Doc[] = [
  {
    id: fixtureIds.garden, kind: "post", title: "Why I keep a garden of notes", slug: "garden-of-notes", homeChannel: "writing/essays",
    visibility: "public", updated: "2026-11-02",
    body: "# Why I keep a garden of notes\n\nA note is a seed. Most stay small; a few grow into [[slow-software]].\n\nI learned this from @june.example, who writes everything twice.",
  },
  {
    id: fixtureIds.slow, kind: "post", platform: "x", title: "Slow software", slug: "slow-software", homeChannel: "writing/essays", channels: ["slowness"],
    visibility: "public", updated: "2026-10-21",
    body: "# Slow software\n\nTools that wait for you. A draft that is private until you say otherwise.\n\nSee [[garden-of-notes]] and the [[tokyo-walks]] series for the same idea in pictures.",
  },
  {
    id: fixtureIds.address, kind: "text", platform: "bluesky", title: "On owning your address", slug: "owning-your-address", homeChannel: "writing/essays",
    visibility: "friends", updated: "2026-11-09",
    body: "# On owning your address\n\nYour DID is the root. Everything else hangs from it.\n\n@theo.example disagrees, kindly.",
    connect: [{ to: "ohm-workspace", why: "The workspace is where owning your address gets built." }],
  },
  {
    id: fixtureIds.monday, kind: "text", title: "Monday, rain", slug: "monday-rain", homeChannel: "writing/journal", channels: ["slowness"],
    visibility: "private", updated: "2026-11-11",
    body: "# Monday, rain\n\nNothing shipped. Read for an hour. Thought about [[slow-software]] again.",
  },
  {
    id: fixtureIds.tokyo, kind: "post", platform: "instagram", title: "Tokyo walks, day one", slug: "tokyo-walks", homeChannel: "photos/tokyo",
    visibility: "public", updated: "2026-09-14",
    body: "# Tokyo walks, day one\n\nYanaka in the morning, with @sana.example.\n\n![A quiet street](https://example.com/street.jpg)",
  },
  {
    id: fixtureIds.tokyoTwo, kind: "post", platform: "instagram", title: "Tokyo walks, day two", slug: "tokyo-walks-2", homeChannel: "photos/tokyo",
    visibility: "public", updated: "2026-09-15",
    body: "# Tokyo walks, day two\n\nKiyosumi garden. Continues [[tokyo-walks]].",
  },
  {
    id: fixtureIds.scans, kind: "media", platform: "instagram", title: "Film scans", slug: "film-scans", homeChannel: "photos",
    visibility: "friends", updated: "2026-08-30",
    body: "# Film scans\n\nA roll from the summer. @june.example lent the camera.",
  },
  {
    id: fixtureIds.workspace, kind: "post", title: "ohm workspace", slug: "ohm-workspace", homeChannel: "projects/tools",
    visibility: "public", updated: "2026-11-14",
    body: "# ohm workspace\n\nA light place to read and write a vault. Built with @theo.example.\n\nStarted from [[slow-software]].",
  },
  {
    id: fixtureIds.sketches, kind: "text", title: "Graph sketches", slug: "graph-sketches", homeChannel: "projects/tools",
    visibility: "private", updated: "2026-11-12",
    body: "# Graph sketches\n\nA person in the middle, their memory around them, then the vault. Notes for [[ohm-workspace]], after [[garden-of-notes]].",
  },
  {
    id: fixtureIds.dusk, kind: "media", platform: "instagram", title: "Yanaka at dusk", slug: "yanaka-dusk", homeChannel: "photos/tokyo", channels: ["slowness"],
    visibility: "friends", updated: "2026-09-16",
    body: "# Yanaka at dusk\n\nThe same street as [[tokyo-walks]], later. Shot on the camera from [[film-scans]].",
  },
  {
    id: fixtureIds.reading, kind: "text", title: "Reading list", slug: "reading-list", homeChannel: "other", channels: ["projects/tools"],
    visibility: "private", updated: "2026-10-01",
    body: "# Reading list\n\n- A pattern language\n- Notes on the synthesis of form\n\nFor [[slow-software]] and [[ohm-workspace]].",
  },
]

// The cortex (cortex/docs/model.md): the profile, what agents observed working with Mira, a skill and a tool.
export const cortex: Doc[] = [
  { id: fixtureIds.paragraphs, kind: "profile", title: "Profile", slug: "profile", visibility: "private", updated: "2026-11-01",
    body: "# Profile\n\n## Preferences\n\n- Keep drafts to short paragraphs; no headings inside a post under 300 words.\n- New things start private.\n\n## Goals\n\n- Ship the ohm workspace this winter.\n\n## Notes\n\n- Writes in the morning, edits at night." },
  { id: fixtureIds.privateFirst, kind: "observation", by: "claude-code", title: "Starts everything private", slug: "private-first", visibility: "private", updated: "2026-10-12",
    body: "# Starts everything private\n\nIn three sessions, new blocks started private and were shared days later." },
  { id: fixtureIds.captions, kind: "observation", by: "claude-code", about: ["channel:photos"], title: "Photo captions are one line", slug: "photo-captions", visibility: "private", updated: "2026-09-20",
    body: "# Photo captions are one line\n\nSeen in two sessions, on the photos channel." },
  { id: fixtureIds.renameJournal, kind: "observation", by: "codex", about: ["channel:writing/journal"], title: "Asked to rename 'journal'", slug: "rename-journal", visibility: "private", updated: "2026-11-13",
    body: "# Asked to rename 'journal'\n\nOne session. Might want 'diary'." },
  { id: fixtureIds.suggestChannels, kind: "skill", title: "Suggest channels", slug: "suggest-channels", visibility: "private", updated: "2026-10-30",
    body: "# Suggest channels\n\nOffer the plain default and ask." },
  { id: fixtureIds.search, kind: "tool", title: "vault_search", slug: "vault-search", visibility: "private", updated: "2026-10-30",
    body: "# vault_search\n\nSearches the vault by text." },
  { id: fixtureIds.slowness, kind: "observation", by: "claude-code", about: [fixtureIds.slow, fixtureIds.tokyo, fixtureIds.dusk], title: "Slowness ties the essays to the photos", slug: "slowness-thread", visibility: "private", updated: "2026-11-15",
    body: "# Slowness ties the essays to the photos\n\nNoticed, not said. [[slow-software]] links to [[tokyo-walks]]; [[yanaka-dusk]] returns to the same street later; all three were collected into the slowness channel. The essays and the walks argue the same thing in two forms." },
]

// A block an agent brought into a channel it was granted. It says who made it and starts private.
export const byAgent: Doc[] = [
  { id: fixtureIds.byAgent, kind: "link", title: "A pattern language, online", slug: "pattern-language-online", homeChannel: "reading",
    by: "agent:claude-code", visibility: "private", updated: "2026-11-20",
    body: "# A pattern language, online\n\nhttps://example.com/pattern-language\n\nFound while you were reading; it is on your [[reading-list]]." },
]
