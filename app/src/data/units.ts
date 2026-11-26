// Units in the app (docs/plans/units.md): everything in the home, as one list, read a folder at a
// time. With a paired bridge the home folder answers (`/units?in=`); without one, the blocks, channels
// and agents' files already loaded are turned into the same units here, so the tree is the same view
// either way. The shape and the rules are the contract's (contract/unit.mjs), never redone here.
import { excerptOf, feed as feedOf, folderOf as unitFolder, levelOf, sees as unitSees } from "../../../contract/unit.mjs"
import { bridgeFetch, currentBridge } from "./bridge"
import { blocks, byId, channelRecords, cortex } from "./workspace-data"
import { locationOf, type Audience, type Doc } from "./workspace-model"

export type UnitType = "block" | "channel" | "profile" | "wallet" | "observation" | "skill" | "tool" | "memory" | "artifact"
export type Unit = {
  key: string; type: UnitType; kind?: string
  /** The lexicon of its record: com.ohmmmm.vault.block or .channel. A unit with no record of its own has none. */
  nsid?: string; root: "collections" | "profile" | "agents" | "site" | "tools"
  path: string; id?: string; title?: string; visibility: Audience; channels?: string[]
  /** For a kept website, its address. */
  by?: string; origin?: string; created?: string; updated?: string
  /** A block's opening words, for its post card. */
  excerpt?: string
  /** What its card shows: an address, `site:<path>` in the site, or `collections:<path>` beside the block. */
  cover?: string
  /** A channel's: how many blocks it holds, in it or in a channel inside it. */
  count?: number
  /** A kept website's: whether it lets itself be shown in a frame. */
  frameable?: boolean
}
export type UnitFolder = { path: string; title: string; count: number; unit?: Unit }
export type Level = { folder: string; folders: UnitFolder[]; units: Unit[] }

/** The folder a unit is shown in, as the contract says: a channel's own folder, a skill's skills/, any other its file's. */
export const folderOf = (unit: Unit) => unitFolder(unit) as string
export const unitSeenBy = (audience: Audience, unit: Unit) => unitSees(audience, unit) as boolean

// ---- Without a bridge: the units of what is loaded ----

function loadedUnits(): Unit[] {
  const units: Unit[] = []
  for (const channel of channelRecords) {
    const parent = channel.path.split("/").slice(0, -1).join("/")
    units.push({ key: `channel:${channel.id}`, type: "channel", kind: "collection", nsid: "com.ohmmmm.vault.channel", root: "collections",
      path: `collections/${channel.path}/_channel.md`, id: channel.id, title: channel.path.split("/").at(-1), visibility: "private", channels: parent ? [parent] : [] })
  }
  for (const doc of blocks) {
    if (!doc.homeChannel) continue
    units.push({ key: `block:${doc.vaultId ?? doc.id}`, type: "block", kind: doc.kind, nsid: "com.ohmmmm.vault.block", root: "collections",
      path: `collections/${doc.homeChannel}/${doc.slug}.md`, id: doc.vaultId ?? doc.id, title: doc.title, visibility: doc.visibility,
      channels: [...new Set([doc.homeChannel, ...(doc.channels ?? [])])], updated: doc.updated, excerpt: (doc.kind === "short" ? doc.body.trim() : excerptOf(doc.body)) || undefined, by: doc.by === "you" ? "me" : doc.by })
  }
  for (const doc of cortex) {
    const name = doc.id.replace(/^(observation|skill|tool)-/, "")
    const path = doc.kind === "profile" ? "agents/profile.md" : doc.kind === "observation" ? `agents/observations/${name}.md`
      : doc.kind === "skill" ? `agents/skills/${name}/SKILL.md` : `agents/tools/${name}.md`
    units.push({ key: `agents:${path.slice(7)}`, type: doc.kind === "profile" ? "memory" : doc.kind as UnitType, root: "agents",
      path, id: name, title: doc.title, visibility: "private", channels: [], updated: doc.updated })
  }
  // A channel is as open as the most open block in it, as the contract reads it from the folder.
  const open = { private: 0, friends: 1, public: 2 } as const
  for (const channel of units.filter(u => u.type === "channel")) {
    const at = channel.path.replace(/^collections\//, "").replace(/\/_channel\.md$/, "")
    const most = Math.max(0, ...units.filter(u => u.type === "block" && u.channels?.some(c => c === at || c.startsWith(`${at}/`))).map(u => open[u.visibility]))
    channel.visibility = (Object.keys(open) as Audience[])[most]
  }
  return units
}

// Every unit the app has read, by key, so `unit:<key>` opens the same way from a row, a search hit or a tool.
const known = new Map<string, Unit>()
const remember = <T extends Unit[]>(units: T) => { for (const unit of units) known.set(unit.key, unit); return units }
export const UNIT_ID = "unit:"
export const unitById = (id: string) => (id.startsWith(UNIT_ID) ? known.get(id.slice(UNIT_ID.length)) : undefined)

/** One folder of the home ('' for the top), from the bridge when one is paired. */
export async function readLevel(folder: string): Promise<Level> {
  const level = await fetchLevel(folder)
  remember(level.units)
  remember(level.folders.flatMap(f => (f.unit ? [f.unit] : [])))
  return level
}
async function fetchLevel(folder: string): Promise<Level> {
  if (currentBridge()) {
    const answer = await bridgeFetch(`/units?in=${encodeURIComponent(folder)}`)
    if (answer.ok) return (await answer.json()) as Level
    if (answer.status !== 404) throw new DOMException(((await answer.json().catch(() => ({}))) as { error?: string }).error ?? "The home did not answer.", "OperationError")
  }
  return levelOf(loadedUnits(), folder) as Level
}

/** Every unit of the home: the bridge's list, read again at most every few seconds; or what is loaded. */
let every: { at: number; units: Promise<Unit[]> } | null = null
export function readUnits(): Promise<Unit[]> {
  if (every && Date.now() - every.at < 5000) return every.units
  const units = (async () => {
    if (currentBridge()) {
      const answer = await bridgeFetch("/units").catch(() => null)
      if (answer?.ok) return remember(((await answer.json()) as { units: Unit[] }).units)
    }
    return remember(loadedUnits())
  })()
  every = { at: Date.now(), units }
  units.catch(() => { every = null })
  return units
}

/** Where a unit is, as people name the home's parts: `Site / src / content`. */
export function unitPlace(unit: Unit) {
  // A kept website is in the Artifacts channel, as the Site view shows it, not in the file that keeps it.
  if (unit.kind === "link") return "Artifacts"
  const [top, ...rest] = unit.path.split("/")
  const part = ({ collections: "Collections", vault: "Collections", agents: "Agents", cortex: "Agents", profile: "Profile", site: "Site", tools: "Tools" } as Record<string, string>)[top] ?? top
  return [part, ...rest.slice(0, -1)].join(" / ")
}

/**
 * The feed (app/flows/feed.md): the units `audience` sees, the latest change first. From the bridge when
 * one is paired and has /units/feed; otherwise from what is loaded, by the contract's own feed().
 */
export async function readFeed({ audience = "private", limit = 100, before, types }: { audience?: Audience; limit?: number; before?: string; types?: Unit["type"][] } = {}): Promise<Unit[]> {
  if (currentBridge()) {
    const query = new URLSearchParams({ audience, limit: String(limit), ...(before ? { before } : {}) })
    for (const type of types ?? []) query.append("type", type)
    const answer = await bridgeFetch(`/units/feed?${query}`).catch(() => null)
    if (answer?.ok) return remember(((await answer.json()) as { units: Unit[] }).units)
  }
  return remember(feedOf(loadedUnits(), { audience, limit, before, types }) as Unit[])
}

// ---- From a unit to what opens it ----

/** The workspace document a unit is, when it is one: a block, or an agent's file. */
export function docOfUnit(unit: Unit): Doc | undefined {
  if (unit.type === "block") {
    const found = unit.id ? blocks.find(d => (d.vaultId ?? d.id) === unit.id) : undefined
    if (found) return found
    const [, ...rest] = unit.path.split("/")
    const slug = rest.at(-1)?.replace(/\.md$/, "")
    const home = rest.slice(0, -1).join("/")
    return blocks.find(d => d.homeChannel === home && d.slug === slug)
  }
  if (unit.type === "memory") return cortex.find(d => d.kind === "profile")
  if (unit.type === "observation" || unit.type === "skill" || unit.type === "tool") return byId(`${unit.type}-${unit.id}`)
  return undefined
}

/** A folder's path from the top of the home, as the tree names its row: channels keep their vault ids. */
export function folderRowId(path: string) {
  const [top, ...rest] = path.split("/")
  if (!rest.length) return `root:${top}`
  if (top === "collections" || top === "vault") return `vault:${rest.join("/")}`
  if (top === "agents" || top === "cortex") return `cortex:${rest.join("/")}`
  return `dir:${path}`
}

// ---- Where a document is, as people name it ----

/** The home's parts by the names people see; the code keeps vault and cortex (docs/words.md). */
export const PART_NAMES = { vault: "Collections", cortex: "Agents" } as const
/**
 * Where a block or an agent's file is, as the tree shows it: its part, then its folders. A block's are its
 * home channel's; an agent's file is in its folder (observations, skills, tools), and the memory of you
 * sits right in Agents.
 */
export function placeOfDoc(doc: Doc): { prime: "vault" | "cortex"; folders: string[] } {
  if (doc.homeChannel !== undefined) return { prime: "vault", folders: doc.homeChannel.split("/").filter(Boolean) }
  return { prime: "cortex", folders: doc.kind === "profile" ? [] : [locationOf(doc)] }
}
/** The same place as one line: `Collections / essays`. */
export const placeLine = (doc: Doc) => { const { prime, folders } = placeOfDoc(doc); return [PART_NAMES[prime], ...folders].join(" / ") }
