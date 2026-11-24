// The graph's data (docs/words.md › In the graph).
//
// A node is a block. Channels are not nodes: a block is coloured by its label, the top channel of
// its home (`photos` for `photos/tokyo`), and blocks with one label gather in one direction.
//
// An edge is a connect: a block links to, embeds or mentions another block in its text, or is
// connected to it whole (`links`, `embeds`, `mentions`, a whole-block `connect`). The vault's
// `contains` and `from` stay evidence and are not drawn, and neither are people a block mentions.
//
// An edge an agent only observed (an observation in the cortex about two or more blocks) is drawn
// apart from the ones the person made: its own line, dashed. A node is sized by its backlinks: the
// connects the person made that point at it.
//
// The person is the middle. The cortex is a toggle, off by default: on, the profile is the person,
// and observations about the person, skills and tools gather around them.
import { blockKey, blocks, bySlug, cortex, docForEvidence, entityByHandle, evidenceKey, isBlock, locationOf, mentions, owner, sees, workspaceEvidence, type Audience, type Doc, type Entity } from "@/data/workspace-data"
import { outgoing as writtenLinks } from "@/data/workspace-model"
import type { VaultEvidence } from "@/data/source"

export type Root = "vault" | "cortex"

export type GraphNode = {
  id: string
  name: string
  doc: Doc
  root: Root
  /** What colours it: a block's label (its home's top channel), or a cortex item's part. */
  label: string
  /** Connects the person made that point at it. */
  backlinks: number
  degree: number
}

/** The connects that are drawn. */
export const CONNECT_KINDS = ["links", "embeds", "mentions"] as const
export type EdgeKind = Extract<VaultEvidence[number]["kind"], (typeof CONNECT_KINDS)[number]>
/**
 * One line per pair and maker: what the person made, and, apart, what agents observed. `weight` is
 * how many ways the person joined them.
 */
export type GraphEdge = {
  source: string
  target: string
  kinds: EdgeKind[]
  weight: number
  wholeBlock?: boolean
  why?: string
  /** Set on an edge an agent observed: the observations that saw these two as connected. */
  observed?: string[]
}

/** A label: its blocks, and its place in the palette (labels sorted by name, "other" last). */
export type GraphLabel = { name: string; root: Root; members: string[]; swatch: number }

export type Graph = { center: Entity; nodes: GraphNode[]; edges: GraphEdge[]; labels: GraphLabel[] }

export type GraphFilters = {
  /** Handle or DID. Defaults to the owner; anyone else shows the owner's blocks that mention them. */
  center?: string
  vault?: boolean
  /** The cortex around the person. Off unless asked for. */
  cortex?: boolean
  /** The lines between blocks. */
  links?: boolean
  /** Who is looking: only what they can see is drawn. */
  audience?: Audience
  /** The home's filters, as a test each item must pass. */
  keep?: (d: Doc) => boolean
}
export const DEFAULT_FILTERS = { vault: true, cortex: false, links: true, audience: "private" as Audience }

export const SWATCHES = 8
const nodeId = (doc: Doc) => isBlock(doc) ? evidenceKey(doc.id) ?? blockKey(doc.id) : `cortex:${doc.id}`
export const labelOf = (doc: Doc) => isBlock(doc) ? doc.homeChannel.split("/", 1)[0] : locationOf(doc)
const byName = (a: string, b: string) => (a === "other" ? 1 : 0) - (b === "other" ? 1 : 0) || a.localeCompare(b)

export function buildGraph(filters: GraphFilters = {}): Graph {
  const f = { ...DEFAULT_FILTERS, ...filters }
  const center = (f.center && entityByHandle(f.center)) || owner
  const isOwner = center.did === owner.did
  const visible = (d: Doc) => sees(f.audience, d) && (!filters.keep || filters.keep(d))

  const vaultDocs = !f.vault ? [] : (isOwner ? blocks : blocks.filter(p => mentions(p).includes(center.handle))).filter(visible)
  // The cortex is the owner's own: it shows only to the owner, looking as themselves.
  const ownCortex = isOwner && f.audience === "private" ? cortex.filter(visible) : []
  const blocksAbout = (doc: Doc) => (doc.about ?? []).filter(item => !item.startsWith("channel:"))
  // Drawn as items only with the cortex on; the profile is the middle, and an observation about
  // blocks is an observed edge between them.
  const cortexDocs = f.cortex ? ownCortex.filter(doc => doc.kind !== "profile" && !(doc.kind === "observation" && blocksAbout(doc).length)) : []

  const nodes = new Map<string, GraphNode>()
  for (const doc of vaultDocs) nodes.set(nodeId(doc), { id: nodeId(doc), name: doc.title || "Untitled", doc, root: "vault", label: labelOf(doc), backlinks: 0, degree: 0 })
  for (const doc of cortexDocs) nodes.set(nodeId(doc), { id: nodeId(doc), name: doc.title || "Untitled", doc, root: "cortex", label: labelOf(doc), backlinks: 0, degree: 0 })

  const edges = new Map<string, GraphEdge>()
  const join = (from: string, to: string, kind: EdgeKind, opts: { wholeBlock?: boolean; why?: string; observed?: string } = {}) => {
    if (from === to || !nodes.has(from) || !nodes.has(to)) return
    const key = `${[from, to].sort().join("|")}${opts.observed ? "|observed" : ""}`
    const held = edges.get(key) ?? { source: from, target: to, kinds: [], weight: 0 }
    if (!held.kinds.includes(kind)) held.kinds.push(kind)
    if (opts.wholeBlock) held.wholeBlock = true
    if (opts.why && !held.why) held.why = opts.why
    if (opts.observed) held.observed = [...(held.observed ?? []), opts.observed]
    else nodes.get(to)!.backlinks++
    edges.set(key, held)
  }
  if (f.links) {
    for (const edge of workspaceEvidence()) {
      if (!(CONNECT_KINDS as readonly string[]).includes(edge.kind)) continue
      const wholeBlock = edge.kind === "links" && edge.at === "connect"
      const target = docForEvidence(edge.to)
      const why = wholeBlock && target ? nodes.get(edge.from)?.doc.connect?.find(each => each.to === target.slug)?.why : undefined
      join(edge.from, edge.to, edge.kind as EdgeKind, { wholeBlock, why })
    }
    // A cortex item points at the blocks it names.
    for (const doc of cortexDocs) {
      for (const out of writtenLinks(doc)) {
        const target = bySlug(out.slug)
        if (target) join(nodeId(doc), nodeId(target), "links")
      }
    }
    // An observation about two or more blocks connects each pair of them, as an agent saw it.
    for (const doc of ownCortex.filter(each => each.kind === "observation")) {
      const ids = blocksAbout(doc).map(id => evidenceKey(id) ?? blockKey(id)).filter(id => nodes.has(id))
      for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) join(ids[i], ids[j], "links", { observed: doc.title })
    }
  }
  for (const e of edges.values()) {
    e.weight = e.observed ? 1 : e.kinds.length + (e.wholeBlock ? 1 : 0)
    nodes.get(e.source)!.degree++
    nodes.get(e.target)!.degree++
  }

  const labels = new Map<string, GraphLabel>()
  for (const n of nodes.values()) {
    const key = `${n.root}:${n.label}`
    const held = labels.get(key) ?? { name: n.label, root: n.root, members: [], swatch: 0 }
    held.members.push(n.id)
    labels.set(key, held)
  }
  const sorted = [...labels.values()].sort((a, b) => (a.root === b.root ? 0 : a.root === "vault" ? -1 : 1) || byName(a.name, b.name))
  sorted.filter(label => label.root === "vault").forEach((label, index) => { label.swatch = index % SWATCHES })

  return { center, nodes: [...nodes.values()], edges: [...edges.values()], labels: sorted }
}
