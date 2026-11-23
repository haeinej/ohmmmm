// The workspace's read projection of the member's home, for the synchronous render paths. The
// source (the vault service) owns every record; this holds what it last said, and each write goes
// to the source first and lands here only after it answered.
import { evidence, readVault } from "../../../vault/vault/node.mjs"
import { docOf } from "./block-document"
import { cortexDocOf } from "./cortex-document"
import { createJournal, isJournalEntry, type JournalEntry } from "./journal"
import type { Account, Agenda, BlockFile, BlockHead, BlockRef, CortexFile, HomeFile, HomeSource, Layer, VaultContents, VaultEvidence } from "./source"
import { INBOX } from "./source"
import { outgoing as describeOutgoing, type ChannelRecord, type Doc, type Outgoing, type Entity } from "./workspace-model"
export * from "./workspace-model"

/** Signed out shows sign-in; loading is blank; ready shows the home, empty or not. */
export type HomeStatus = "signed-out" | "loading" | "ready"
/** The private layer and the cortex open only on a device that unlocked this account's keys. */
export type Sealed = "open" | "locked" | "unavailable"

const defaultOwner: Entity = { did: "", handle: "", name: "" }
let source: HomeSource | null = null
let selection = 0

export let status: HomeStatus = "signed-out"
export let blocks: Doc[] = []
/** Blocks an agent proposed, waiting in the inbox channel. */
export let inbox: Doc[] = []
export let cortex: Doc[] = []
export let channelRecords: ChannelRecord[] = []
export let owner: Entity = defaultOwner
export let entities: Entity[] = []
export let agenda: Agenda | null = null
export let privateLayer: Sealed = "locked"
export let cortexState: Sealed = "locked"
/** Files the last read could not open, left out of the projection. */
export let unreadable = 0
let journal = createJournal([])
let vault: VaultContents = readVault([])
let edges: VaultEvidence = []
type Held = { ref: BlockRef; file: HomeFile; version: string }
let held = new Map<string, Held>()
let channelFiles = new Map<string, { text: string; version: string }>()
let cortexFiles = new Map<string, CortexFile>()
let byKey = new Map<string, Doc>()
let keys = new Map<string, string>()

const sealedState = (problem: unknown): Sealed => {
  const code = (problem as { code?: string })?.code
  return code === "PrivateLocked" ? "locked" : "unavailable"
}
/** Whole-block connections on a text block are a property; evidence reads them like a post's. */
const withConnections = (contents: VaultContents): VaultContents => ({
  ...contents,
  blocks: contents.blocks.map(block => "properties" in block && Array.isArray(block.properties.connect)
    ? { ...block, post: { connect: block.properties.connect } }
    : block),
}) as VaultContents

/** Rebuilds every projection from the files held, without asking the source again. */
function project() {
  const parsed = [...held.values()].flatMap(({ ref, file, version }) => {
    try { return [{ ...docOf(ref, file), ref, version }] } catch { return [] }
  })
  vault = readVault([
    ...parsed.map(({ ref }) => held.get(ref.id)!.file),
    ...[...channelFiles].map(([path, { text }]) => ({ path: `${path}/_channel.md`, text })),
  ])
  edges = evidence(withConnections(vault))
  const ids = new Map(parsed.map(({ doc }) => [doc.slug, doc.id]))
  channelRecords = vault.channels.map(channel => ({
    path: channel.path,
    id: typeof channel.id === "string" ? channel.id : typeof channel.properties.id === "string" ? channel.properties.id : channel.path,
    description: channel.description,
    created: String(channel.properties.created ?? ""),
    order: channel.order.map((slug: string) => ids.get(slug)).filter((id: string | undefined): id is string => id !== undefined),
    ...(channelFiles.has(channel.path) ? { version: channelFiles.get(channel.path)!.version } : {}),
  }))
  const docs = parsed.map(({ doc }) => doc)
  inbox = docs.filter(doc => doc.status === "proposed")
  blocks = docs.filter(doc => doc.status !== "proposed")
  cortex = [...cortexFiles.values()].flatMap(file => cortexDocOf(file) ?? [])
  entities = vault.entities.map(entity => {
    const did = String(entity.properties.uri ?? "").replace(/^at:\/\//, "")
    const handle = Array.isArray(entity.properties.aliases) ? String(entity.properties.aliases[0] ?? "") : ""
    return { did, handle: handle || entity.slug, name: String(entity.properties.name ?? entity.slug) }
  })
  byKey = new Map(parsed.map(({ key, doc }) => [key, doc]))
  keys = new Map(parsed.map(({ key, doc }) => [doc.id, key]))
}

export const getSource = () => source
export const homeStatus = () => status
export const journalOf = () => journal

/**
 * Chooses the home to show: the signed-in member's vault service, or nothing (signed out). Reads
 * every block once, the channels, the cortex and its journal; the private layer and the cortex
 * stay closed when this device has not unlocked them.
 */
export async function selectSource(given: HomeSource | HomeSource<"sync"> | null) {
  // A source may answer at once (tests give one); the workspace only ever awaits it.
  const next = given as HomeSource | null
  const attempt = ++selection
  if (!next) {
    source = null
    status = "signed-out"
    held = new Map(); channelFiles = new Map(); cortexFiles = new Map()
    owner = defaultOwner; agenda = null; journal = createJournal([])
    privateLayer = "locked"; cortexState = "locked"
    project()
    return true
  }
  const before = { source, status }
  // Reading the same home again keeps this device's timeline: the block changes made here live
  // only in it.
  const carried = next === source ? journal.historyLines().map(line => journal.entryOf(line)) : []
  source = next
  status = "loading"
  try {
    const [account, heads, channels, sealedCortex, entries, waiting] = await Promise.all([
      next.account(),
      Promise.resolve().then(() => next.listBlocks(["public", "friends", "private"])).then(
        list => ({ list, sealed: "open" as Sealed }),
        async problem => ({ list: await next.listBlocks(["public", "friends"]), sealed: sealedState(problem) })),
      next.channels.list().then(list => Promise.allSettled(list.map(head => next.channels.read(head.path)))),
      next.cortex.list().then(list => ({ list, sealed: "open" as Sealed }), problem => ({ list: [] as CortexFile[], sealed: sealedState(problem) })),
      next.cortex.journal().catch(() => []),
      next.agenda().catch(() => null),
    ])
    // One file that can't be read (it changed layer since the list, or its key isn't here) is left
    // out and counted; it doesn't keep the rest of the home from opening.
    const reads = await Promise.allSettled(heads.list.map(async ref => [ref, await next.readBlock(ref)] as [BlockHead, BlockFile]))
    if (attempt !== selection) return false
    const files = reads.flatMap(read => read.status === "fulfilled" ? [read.value] : [])
    const channelReads = channels.flatMap(read => read.status === "fulfilled" ? [read.value] : [])
    unreadable = reads.length - files.length + channels.length - channelReads.length
    held = new Map(files.map(([ref, { version, ...file }]) => [ref.id, { ref: { id: ref.id, layer: ref.layer, store: ref.store }, file, version }]))
    channelFiles = new Map(channelReads.map(channel => [channel.path.replace(/\/_channel\.md$/, ""), { text: channel.text, version: channel.version }]))
    cortexFiles = new Map(sealedCortex.list.map(file => [file.id, file]))
    privateLayer = heads.sealed
    cortexState = sealedCortex.sealed
    agenda = waiting
    owner = { did: account.did ?? "", handle: account.did ?? "", name: account.user.name }
    project()
    const kept = entries.map(each => each.entry).filter(isJournalEntry) as JournalEntry[]
    const seen = new Set(carried.map(entry => entry.line.id))
    journal = createJournal(() => [...blocks, ...inbox, ...cortex], [...kept.filter(entry => !seen.has(entry.line.id)), ...carried])
    status = "ready"
    return true
  } catch (problem) {
    // Nothing was replaced: the home stays as it was shown, and the caller hears why.
    if (attempt === selection) ({ source, status } = before)
    throw problem
  }
}

// ─── What a write changes here, once the source has answered ─────────────────

export function heldBlock(id: string) { return held.get(id) }
export function landBlock(ref: BlockRef, file: HomeFile, version: string) {
  held.set(ref.id, { ref, file, version })
  project()
}
export function dropBlock(id: string) {
  held.delete(id)
  project()
}
export const heldChannel = (path: string) => channelFiles.get(path)
export function landChannel(path: string, text: string, version: string) {
  channelFiles.set(path, { text, version })
  project()
}
export function dropChannel(path: string) {
  channelFiles.delete(path)
  project()
}
export const heldCortex = (id: string) => cortexFiles.get(id)
export function landCortex(file: CortexFile) {
  cortexFiles.set(file.id, file)
  project()
}
export function dropCortex(id: string) {
  cortexFiles.delete(id)
  project()
}

export const blockVersion = (id: string) => {
  const found = held.get(id)
  return found && { ref: found.ref, version: found.version }
}
export const byId = (id: string) => blocks.find(doc => doc.id === id) ?? inbox.find(doc => doc.id === id) ?? cortex.find(doc => doc.id === id)
export const bySlug = (slug: string) => blocks.find(doc => doc.slug === slug) ?? cortex.find(doc => doc.slug === slug)
export const channelByPath = (path: string) => channelRecords.find(channel => channel.path === path)
export const entityByHandle = (handle: string) => entities.find(person => person.handle === handle || person.did === handle)
export const isInboxChannel = (path: string) => path === INBOX
export function inOrder(path: string, docs: Doc[]) {
  const rank = new Map(vault.items(path).flatMap((node, index) => node.type === "block" ? [[node.slug, index] as const] : []))
  return [...docs].sort((a, b) => (rank.get(a.slug) ?? Infinity) - (rank.get(b.slug) ?? Infinity))
}
export const layersShown = (): Layer[] => privateLayer === "open" ? ["public", "friends", "private"] : ["public", "friends"]

export const workspaceEvidence = () => edges
export const docForEvidence = (key: string) => byKey.get(key)
export const evidenceKey = (id: string) => keys.get(id)

// Connection rows use the selected source to determine endpoints. Keep wording and the member's
// optional explanation from the projected text.
export function outgoing(doc: Doc): Outgoing[] {
  const hints = new Map(describeOutgoing(doc).map(out => [out.slug, out]))
  const targets = new Map<string, Outgoing>()
  for (const edge of edges) {
    if (edge.kind !== "links" || edge.from !== evidenceKey(doc.id) || edge.from === edge.to) continue
    const target = docForEvidence(edge.to)
    if (!target) continue
    targets.set(target.slug, {
      ...hints.get(target.slug), slug: target.slug,
      inText: edge.at !== "connect" || !!targets.get(target.slug)?.inText,
    })
  }
  return [...targets.values()]
}

export function incoming(doc: Doc) {
  const ids = new Set(edges.filter(edge => edge.kind === "links" && edge.to === evidenceKey(doc.id)).map(edge => edge.from))
  return blocks.filter(other => other.id !== doc.id && ids.has(evidenceKey(other.id) ?? ""))
}
