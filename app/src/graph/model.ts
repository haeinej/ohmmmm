// The graph's data: the home as it is filed, and how its parts connect.
//
// The graph follows the tree. The home has two roots, the vault and the cortex. Inside the vault,
// each block sits in its home channel (`photos/tokyo`) and nowhere else. Inside the cortex, each
// item sits in its category. Every folder is a group, drawn as an area around what is filed in it,
// so groups nest the way folders do and never overlap.
//
// A channel that only collects blocks filed elsewhere (`slowness`) has nothing filed in it. It is
// drawn as a small labelled point joined to the blocks it collects.
//
// The cortex follows cortex/docs/model.md. The profile is the person: the middle of the graph, not a
// node. Observations about the person, skills and tools are nodes in the cortex, each joined to the
// person. An observation about two or more blocks is not a node: it is an observed connection, a
// line between those blocks. One about a single block shows in that block's connections card.
//
// The lines are connections: a link written in the text (`[[slug]]`), a connection made between
// whole blocks, or one an agent observed.
import { blockKey, blocks, bySlug, channelsOf, cortex, docForEvidence, entityByHandle, evidenceKey, isBlock, locationOf, mentions, owner, sees, workspaceEvidence, type Audience, type Doc, type Entity } from "@/data/workspace-data"
import { outgoing as writtenLinks } from "@/data/workspace-model"
import type { VaultEvidence } from "@/data/source"

export type Root = "vault" | "cortex"

export type GraphNode = {
  id: string
  name: string
  doc: Doc
  root: Root
  /** The group it is filed in: `vault/photos/tokyo`, `cortex/observations`. */
  group: string
  /** Every channel a vault block is in, its home first. */
  channels: string[]
  degree: number
}

export type EdgeKind = VaultEvidence[number]["kind"]
/** One line per pair. `weight` is how strongly: each way they are joined, and each channel they share. */
export type GraphEdge = { source: string; target: string; kinds: EdgeKind[]; weight: number; wholeBlock?: boolean; why?: string
  /** The observations that saw these two as connected, when an agent did. */
  observed?: string[] }

/**
 * A folder: a root (`vault`), a channel or category in it (`vault/photos`), or one inside that
 * (`vault/photos/tokyo`). `members` is everything filed in it or below it. `collects` is set on a
 * channel that only gathers blocks filed elsewhere.
 */
export type GraphGroup = {
  id: string
  root: Root
  name: string
  depth: number
  parent?: string
  members: string[]
  collects?: string[]
}

export type Graph = { center: Entity; nodes: GraphNode[]; edges: GraphEdge[]; groups: GraphGroup[] }

export type GraphFilters = {
  /** Handle or DID. Defaults to the owner; anyone else shows the owner's blocks that mention them. */
  center?: string
  vault?: boolean
  cortex?: boolean
  /** The lines between things. */
  links?: boolean
  /** Who is looking: only what they can see is drawn. */
  audience?: Audience
  /** The home's filters, as a test each item must pass. */
  keep?: (d: Doc) => boolean
}
export const DEFAULT_FILTERS = { vault: true, cortex: true, links: true, audience: "private" as Audience }

const nodeId = (doc: Doc) => isBlock(doc) ? evidenceKey(doc.id) ?? blockKey(doc.id) : `cortex:${doc.id}`

export function buildGraph(filters: GraphFilters = {}): Graph {
  const f = { ...DEFAULT_FILTERS, ...filters }
  const center = (f.center && entityByHandle(f.center)) || owner
  const isOwner = center.did === owner.did
  const visible = (d: Doc) => sees(f.audience, d) && (!filters.keep || filters.keep(d))

  const vaultDocs = !f.vault ? [] : (isOwner ? blocks : blocks.filter(p => mentions(p).includes(center.handle))).filter(visible)
  // The cortex is the owner's own memory: it shows only to the owner, looking as themselves.
  const cortexAll = f.cortex && isOwner ? cortex.filter(visible) : []
  const blocksAbout = (doc: Doc) => (doc.about ?? []).filter(item => !item.startsWith("channel:"))
  // The profile is the middle; an observation about blocks is drawn as their connection.
  const cortexDocs = cortexAll.filter(doc => doc.kind !== "profile" && !(doc.kind === "observation" && blocksAbout(doc).length))

  const groups = new Map<string, GraphGroup>()
  const group = (root: Root, path: string) => {
    const parts = [root, ...path.split("/").filter(Boolean)]
    for (let at = 1; at <= parts.length; at++) {
      const id = parts.slice(0, at).join("/")
      if (!groups.has(id)) groups.set(id, { id, root, name: parts[at - 1], depth: at - 1, parent: at > 1 ? parts.slice(0, at - 1).join("/") : undefined, members: [] })
    }
    return groups.get(parts.join("/"))!
  }
  const file = (n: GraphNode) => {
    // Filed in a folder is filed in every folder around it too, so the outer area holds it.
    for (let g: GraphGroup | undefined = groups.get(n.group); g; g = g.parent ? groups.get(g.parent) : undefined) g.members.push(n.id)
  }

  const nodes = new Map<string, GraphNode>()
  for (const doc of vaultDocs) {
    const channels = channelsOf(doc)
    const n: GraphNode = { id: nodeId(doc), name: doc.title || "Untitled", doc, root: "vault", group: group("vault", channels[0] ?? "").id, channels, degree: 0 }
    nodes.set(n.id, n)
  }
  for (const doc of cortexDocs) {
    const n: GraphNode = { id: nodeId(doc), name: doc.title || "Untitled", doc, root: "cortex", group: group("cortex", locationOf(doc)).id, channels: [], degree: 0 }
    nodes.set(n.id, n)
  }
  for (const n of nodes.values()) file(n)

  // Channels a block is collected into besides its home. One with nothing filed in it is drawn as a
  // point that gathers them; in one that has its own blocks, the block stays where it is filed.
  for (const n of nodes.values()) {
    for (const path of n.channels.slice(1)) {
      const id = `vault/${path}`
      if (groups.get(id)?.members.length) continue
      const g = group("vault", path)
      g.collects = [...(g.collects ?? []), n.id]
    }
  }

  // Lines: what each item points at, merged into one per pair.
  const edges = new Map<string, GraphEdge>()
  const join = (a: string, b: string, kind: EdgeKind, wholeBlock = false, why?: string) => {
    if (a === b || !nodes.has(a) || !nodes.has(b)) return
    const key = [a, b].sort().join("|")
    const held = edges.get(key) ?? { source: a, target: b, kinds: [], weight: 0 }
    if (!held.kinds.includes(kind)) held.kinds.push(kind)
    if (wholeBlock) held.wholeBlock = true
    if (why && !held.why) held.why = why
    edges.set(key, held)
  }
  if (f.links) {
    for (const edge of workspaceEvidence()) {
      const wholeBlock = edge.kind === "links" && edge.at === "connect"
      const target = docForEvidence(edge.to)
      const why = wholeBlock && target ? nodes.get(edge.from)?.doc.connect?.find(each => each.to === target.slug)?.why : undefined
      join(edge.from, edge.to, edge.kind, wholeBlock, why)
    }
    // A cortex item points at the blocks it names.
    for (const doc of cortexDocs) {
      for (const out of writtenLinks(doc)) {
        const target = bySlug(out.slug)
        if (target) join(nodeId(doc), nodeId(target), "links")
      }
    }
    // An observation about two or more blocks connects each pair of them, as an agent saw it.
    for (const doc of cortexAll.filter(each => each.kind === "observation")) {
      const ids = blocksAbout(doc).map(id => evidenceKey(id) ?? blockKey(id)).filter(id => nodes.has(id))
      for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
        join(ids[i], ids[j], "links")
        const held = edges.get([ids[i], ids[j]].sort().join("|"))!
        held.observed = [...(held.observed ?? []), doc.title]
      }
    }
  }
  for (const e of edges.values()) {
    const a = nodes.get(e.source)!, b = nodes.get(e.target)!
    e.weight = e.kinds.length + a.channels.filter(c => b.channels.includes(c)).length
    a.degree++
    b.degree++
  }

  return {
    center,
    nodes: [...nodes.values()],
    edges: [...edges.values()],
    // Roots first, then outer folders before inner ones, so inner areas draw on top.
    groups: [...groups.values()].sort((a, b) => a.depth - b.depth || (a.root === b.root ? 0 : a.root === "vault" ? -1 : 1) || a.id.localeCompare(b.id)),
  }
}
