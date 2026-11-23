import { nodeKey } from "../../../vault/vault/node.mjs"
import { isBlockKind, type BlockKind } from "./block-kind"

export type Visibility = "public" | "friends" | "private"
/** The cortex's four parts (cortex/docs/model.md): the profile, observations, skills and tools. */
export type CortexKind = "profile" | "observation" | "skill" | "tool"
export type Kind = BlockKind | CortexKind
export type Platform = "own" | "bluesky" | "instagram" | "x"

export type Doc = {
  /** How the source names it: a block's TID, a sealed file's opaque ID, or a cortex file's. */
  id: string
  /** A sealed block's own vault ID (a TID), which its opaque storage ID hides. */
  vaultId?: string
  /** `proposed` while an agent's capture waits in the inbox. */
  status?: "proposed" | "kept" | "archived"
  kind: Kind
  title: string
  slug: string
  /** A vault block's home channel. Cortex files are filed by kind. */
  homeChannel?: string
  visibility: Visibility
  body: string
  updated: string
  /** An emoji shown above the title. */
  icon?: string
  /** Where a post first appeared: "own" for nowhere else, or the platform it was brought in from. */
  platform?: Platform
  /** Channels the block is collected into besides its home channel, as `channel` or `channel/inner`. */
  channels?: string[]
  /**
   * Blocks this one connects to, made by you: each by slug, with an optional line on why. Inline
   * connections live in the body as `[[slug]]` or `[[slug|the words]]`; these are whole-block ones.
   */
  connect?: Connection[]
  /** What an observation is about: block IDs, or channels written channel:<path>. None is about the person. */
  about?: string[]
  /** Who wrote an observation or proposed a block: an agent by name, or "you". */
  by?: string
  /** The versions of the blocks an observation is about, as they were when it was written. */
  evidence?: { node: string; version: string }[]
}

export const isBlock = (doc?: Doc | null): doc is Doc & { kind: BlockKind; homeChannel: string } =>
  doc != null && isBlockKind(doc.kind) && doc.homeChannel !== undefined
/** Where the cortex keeps each part, as the tree names its folders. */
export const CORTEX_FOLDERS: Record<CortexKind, string> = { profile: "profile", observation: "observations", skill: "skills", tool: "tools" }
export const locationOf = (doc: Doc) => doc.homeChannel ?? CORTEX_FOLDERS[doc.kind as CortexKind] ?? doc.kind
export const blockKey = (id: string) => nodeKey({ type: "block", id })

export type Connection = { to: string; why?: string }

export type Entity = { did: string; handle: string; name: string }

/** Every channel a block is in, with its home channel first. */
export const channelsOf = (doc: Doc) => isBlock(doc) ? [...new Set([doc.homeChannel, ...(doc.channels ?? [])])] : []
/** A secondary tree row identifies both the block and the channel path. */
export const channelRowId = (id: string, path: string) => `${id}/${path}`
/**
 * A channel is a record of its own: it exists whether or not anything is in it, keeps its own order
 * of blocks (the same block can be first in one channel and last in another), and has an id that
 * stays the same when it is renamed or moved. Blocks still name the channels they are in by path in
 * their files; the store keeps the two in step.
 */
export type ChannelRecord = { id: string; path: string; description?: string; order: string[]; created: string; version?: string }
export const docIdOf = (rowId: string) => rowId.split("/", 1)[0]
export const placedIn = (rowId: string) => rowId.includes("/") ? rowId.slice(rowId.indexOf("/") + 1) : null
export const titleOf = (d: Doc) => d.title || "Untitled block"
/** `@handle` mentions in a body. */
export const mentions = (doc: Doc) => [...doc.body.matchAll(/@([a-z0-9.-]+\.[a-z]+)/gi)].map(m => m[1])
/** `[[slug]]` and `[[slug|the words]]` links in a body. */
export const LINK = /\[\[([a-z0-9-]+)(?:\|([^\]\n]+))?\]\]/gi
/**
 * Every block this one connects to, as evidence: the links in its text and the connections you made
 * on the whole block. Each says where it was read, so it can be checked.
 */
export type Outgoing = { slug: string; inText: boolean; why?: string; words?: string }
export function outgoing(doc: Doc): Outgoing[] {
  const out = new Map<string, Outgoing>()
  for (const m of doc.body.matchAll(LINK)) if (m[1] !== doc.slug && !out.has(m[1])) out.set(m[1], { slug: m[1], inText: true, words: m[2] })
  for (const c of doc.connect ?? []) out.set(c.to, { ...(out.get(c.to) ?? { slug: c.to, inText: false }), why: c.why, inText: out.get(c.to)?.inText ?? false })
  return [...out.values()]
}
export type Audience = "private" | "friends" | "public"
/** Who sees what: you see everything; friends see friends and public blocks; everyone sees public ones. */
export const sees = (audience: Audience, d: Doc) =>
  (audience === "private" || (isBlock(d) && (d.visibility === "public" || (audience === "friends" && d.visibility === "friends"))))
