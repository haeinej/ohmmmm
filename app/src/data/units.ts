// Units in the app (docs/plans/units.md): everything in the home, as one list, read a folder at a
// time. With a paired bridge the home folder answers (`/units?in=`); without one, the blocks, channels
// and agents' files already loaded are turned into the same units here, so the tree is the same view
// either way. The shape and the rules are the contract's (contract/unit.mjs), never redone here.
import { levelOf, sees as unitSees } from "../../../contract/unit.mjs"
import { bridgeFetch, currentBridge } from "./bridge"
import { blocks, byId, channelRecords, cortex } from "./workspace-data"
import type { Audience, Doc } from "./workspace-model"

export type UnitType = "block" | "channel" | "profile" | "wallet" | "observation" | "skill" | "tool" | "memory" | "artifact"
export type Unit = {
  key: string; type: UnitType; kind?: string; nsid: string; root: "collections" | "profile" | "agents" | "site"
  path: string; id?: string; title?: string; visibility: Audience; channels?: string[]
  by?: string; origin?: string; created?: string; updated?: string
}
export type UnitFolder = { path: string; title: string; count: number; unit?: Unit }
export type Level = { folder: string; folders: UnitFolder[]; units: Unit[] }

export const unitSeenBy = (audience: Audience, unit: Unit) => unitSees(audience, unit) as boolean

// ---- Without a bridge: the units of what is loaded ----

const UNIT = "com.ohmmmm.unit"
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
      channels: [...new Set([doc.homeChannel, ...(doc.channels ?? [])])], updated: doc.updated })
  }
  for (const doc of cortex) {
    const name = doc.id.replace(/^(observation|skill|tool)-/, "")
    const path = doc.kind === "profile" ? "agents/profile.md" : doc.kind === "observation" ? `agents/observations/${name}.md`
      : doc.kind === "skill" ? `agents/skills/${name}/SKILL.md` : `agents/tools/${name}.md`
    units.push({ key: `agents:${path.slice(7)}`, type: doc.kind === "profile" ? "memory" : doc.kind as UnitType, nsid: UNIT, root: "agents",
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

/** One folder of the home ('' for the top), from the bridge when one is paired. */
export async function readLevel(folder: string): Promise<Level> {
  if (currentBridge()) {
    const answer = await bridgeFetch(`/units?in=${encodeURIComponent(folder)}`)
    if (answer.ok) return (await answer.json()) as Level
    if (answer.status !== 404) throw new DOMException(((await answer.json().catch(() => ({}))) as { error?: string }).error ?? "The home did not answer.", "OperationError")
  }
  return levelOf(loadedUnits(), folder) as Level
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
