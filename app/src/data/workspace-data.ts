import { docOf } from "./block-document"
import { createJournal } from "./journal"
import { sampleSource, type SampleSource } from "./sample-source"
import type { Account, BlockFile, BlockHead, HomeSource, VaultContents, VaultEvidence } from "./source"
import { outgoing as describeOutgoing, type ChannelRecord, type Doc, type Outgoing, type Entity } from "./workspace-model"
export * from "./workspace-model"

/**
 * A source the workspace edits as it goes: the sample, or the home on this computer (local-source.ts).
 * It answers at once, and carries the workspace's own part (`demo`: owner, entities, cortex, inbox, history).
 */
export type Workspace = HomeSource<"sync"> & {
  demo: SampleSource["demo"]
  /** Renames or moves a channel as one folder, where the source can (the home on this computer). */
  moveChannel?(from: string, to: string): void
}
type Selection = HomeSource | Workspace
const emptyJournal = createJournal([])
const defaultOwner = { did: "", handle: "", name: "" }
let source: Selection = sampleSource
let selection = 0

// A read projection for the prototype's synchronous render paths. Only adapters own records.
export let blocks: Doc[] = []
export let cortex: SampleSource["demo"]["cortex"] = []
export let inbox: SampleSource["demo"]["inbox"] = []
export let channelRecords: ChannelRecord[] = []
export let owner: Entity = defaultOwner
export let entities: Entity[] = []
let vault: VaultContents
let edges: VaultEvidence = []
let versions = new Map<string, { ref: BlockHead; version: string }>()
let byKey = new Map<string, Doc>()
let keys = new Map<string, string>()

const publish = (next: Selection, account: Account, files: [BlockHead, BlockFile][], contents: VaultContents, evidence: VaultEvidence) => {
  const demo = "demo" in next ? next.demo : undefined
  const parsed = files.map(([ref, file]) => ({ ...docOf(ref, file), ref, version: file.version }))
  const ids = new Map(parsed.map(({ doc }) => [doc.slug, doc.id]))
  const channels = contents.channels.map(channel => ({
    path: channel.path,
    id: demo && typeof channel.properties.sampleId === "string" ? channel.properties.sampleId : channel.id ?? channel.path,
    description: channel.description,
    created: String(channel.properties.created ?? ""),
    order: channel.order.map((slug: string) => ids.get(slug)).filter((id: string | undefined): id is string => id !== undefined),
  }))

  source = next
  vault = contents
  edges = evidence
  owner = demo?.owner ?? { did: account.did ?? "", handle: account.did ?? "", name: account.user.name }
  entities = demo?.entities ?? []
  cortex = demo?.cortex ?? []
  inbox = demo?.inbox ?? []
  blocks = parsed.map(({ doc }) => doc)
  channelRecords = channels
  versions = new Map(parsed.map(({ doc, ref, version }) => [doc.id, { ref, version }]))
  byKey = new Map(parsed.map(({ key, doc }) => [key, doc]))
  keys = new Map(parsed.map(({ key, doc }) => [doc.id, key]))
}

export const getSource = () => source
export const sampleWorkspace = () => "demo" in source ? source : undefined

export function refreshSample(current: Workspace) {
  publish(current, current.account(), current.listBlocks().map(ref => [ref, current.readBlock(ref)]), current.vault(), current.connections())
}
refreshSample(sampleSource)

export async function selectSource(next: Selection) {
  const attempt = ++selection
  if ("demo" in next) { refreshSample(next); return true }
  const [account, heads, contents, evidence] = await Promise.all([next.account(), next.listBlocks(), next.vault(), next.connections()])
  const files = await Promise.all(heads.map(async ref => [ref, await next.readBlock(ref)] as [BlockHead, BlockFile]))
  if (attempt !== selection) return false
  publish(next, account, files, contents, evidence)
  return true
}

export const demoJournal = () => sampleWorkspace()?.demo.journal ?? emptyJournal
export const blockVersion = (id: string) => versions.get(id)
export const byId = (id: string) => blocks.find(doc => doc.id === id) ?? cortex.find(doc => doc.id === id)
export const bySlug = (slug: string) => blocks.find(doc => doc.slug === slug) ?? cortex.find(doc => doc.slug === slug)
export const channelByPath = (path: string) => channelRecords.find(channel => channel.path === path)
export const entityByHandle = (handle: string) => entities.find(person => person.handle === handle || person.did === handle)
export function inOrder(path: string, docs: Doc[]) {
  const rank = new Map(vault.items(path).flatMap((node, index) => node.type === "block" ? [[node.slug, index] as const] : []))
  return [...docs].sort((a, b) => (rank.get(a.slug) ?? Infinity) - (rank.get(b.slug) ?? Infinity))
}

export const workspaceEvidence = () => edges
export const docForEvidence = (key: string) => byKey.get(key)
export const evidenceKey = (id: string) => keys.get(id)

// Connection rows use the selected source to determine endpoints. Keep wording and the member's
// optional explanation from the projected text. An embed, `![[slug]]`, connects as a link in the text
// does, so a media block lists every block that shows it.
const joins = (kind: string) => kind === "links" || kind === "embeds"
export function outgoing(doc: Doc): Outgoing[] {
  const hints = new Map(describeOutgoing(doc).map(out => [out.slug, out]))
  const targets = new Map<string, Outgoing>()
  for (const edge of edges) {
    if (!joins(edge.kind) || edge.from !== evidenceKey(doc.id) || edge.from === edge.to) continue
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
  const ids = new Set(edges.filter(edge => joins(edge.kind) && edge.to === evidenceKey(doc.id)).map(edge => edge.from))
  return blocks.filter(other => other.id !== doc.id && ids.has(evidenceKey(other.id) ?? ""))
}
