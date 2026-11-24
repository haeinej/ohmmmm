// Workspace state, and the handlers both the UI and the WebMCP tools call (AGENTS.md rule 2).
import { useSyncExternalStore } from "react"
import { blockVersion, byId, cortex, channelRecords, isCortexKind, channelsOf, demoJournal, inbox, inOrder, owner, blocks, bySlug, isBlock,
  refreshSample, sampleWorkspace, selectSource, type Audience, type ChannelRecord, type Doc, type Visibility,
} from "@/data/workspace-data"
import { docOf, fileOf } from "@/data/block-document"
import { inferKind, isChannelPath, newNodeId } from "../../../vault/vault/node.mjs"
import { createServiceSource, type ServiceOptions } from "@/data/service-source"
import type { BlockRef, HomeSource } from "@/data/source"
import { sampleSource } from "@/data/sample-source"
import type { Workspace } from "@/data/workspace-data"
import { buildGraph } from "@/graph/model"
import type { AgentState } from "@/components/agent-status"
import type { SettingsTab } from "./settings-tabs"
import { NO_FILTERS, passes, type Filters } from "./filters"
import { applySnapshot, snap, type DeadEnd, type Snapshot } from "@/data/journal"
import { assertDurable, embedsIn, mediaFile, resolveEmbed } from "@/media/embeds"
import { keep, makeSizes, measure } from "@/media/cache"

const editable = () => {
  const source: Workspace | undefined = sampleWorkspace()
  if (!source) throw new DOMException("Editing is available in the sample workspace.", "NotSupportedError")
  return source
}
const draftOf = (id: string) => {
  const doc = byId(id)
  return doc && structuredClone(doc)
}
const persist = (doc: Doc, change?: Parameters<HomeSource["saveBlock"]>[3]) => {
  const held = blockVersion(doc.id)
  if (!held && isCortexKind(doc.kind)) {
    editable().demo.saveCortex(doc, change)
    return
  }
  const ref: BlockRef = held?.ref ?? { id: doc.id, layer: "private", store: "sealed" }
  editable().saveBlock(ref, fileOf(doc), held?.version ?? null, change)
}
const updateChannels = (channels: ChannelRecord[]) => editable().saveChannels!(channels)
function ensureChannel(channels: ChannelRecord[], path: string) {
  const held = channels.find(channel => channel.path === path)
  if (held) return held
  const parent = path.split("/").slice(0, -1).join("/")
  if (parent) ensureChannel(channels, parent)
  const record = { id: newNodeId(), path, order: [], created: new Date().toISOString().slice(0, 10) }
  channels.push(record)
  return record
}

/** What the side panel shows. The rack chooses it. */
export type Side = "repo" | "visibility" | "inbox" | "profile" | null
export type View =
  | { kind: "empty" }
  | { kind: "doc"; id: string; mode: "read" | "edit" }
  | { kind: "inbox"; id: string }
  | { kind: "settings"; tab: SettingsTab }
export type Appearance = "system" | "light" | "dark"
/** How tight corners and menus are; src/theme.css holds the values. */
export type Density = "compact" | "comfortable" | "rounded"
const savedDensity = (): Density => {
  try { const d = localStorage.getItem("ohm-ux:density"); return d === "comfortable" || d === "rounded" ? d : "compact" } catch { return "compact" }
}
/** Which of the home's two parts are shown. "All" is both. */
export type RepoScope = { cortex: boolean; vault: boolean }
export const SIDE_WIDTH = { min: 220, max: 640, initial: 300 }
const savedWidth = () => {
  try { const w = Number(localStorage.getItem("ohm-ux:side-width")); return w >= SIDE_WIDTH.min && w <= SIDE_WIDTH.max ? w : SIDE_WIDTH.initial } catch { return SIDE_WIDTH.initial }
}
export type ToolName = "workspace.search" | "workspace.open" | "workspace.graph" | "workspace.create" | "workspace.save-draft" | "workspace.add-image"
  | "visibility.preview" | "visibility.move"
  | "history.list" | "history.save" | "history.session" | "history.revert" | "history.versions" | "history.restore"
  | "cortex.observe"

type State = {
  side: Side
  /** The home: as a tree, or as the graph. */
  repoMode: "tree" | "graph" | "history"
  /** Which of the home's two parts the side panel and the graph show. */
  scope: RepoScope
  /** The side panel's width, set with its handle. */
  sideWidth: number
  /** Who you are looking as: yourself, a friend, or anyone. */
  audience: Audience
  /** The home shows who each block is for, with a pill to change it. */
  showVisibility: boolean
  /** What the home's tree and graph are narrowed to. */
  filters: Filters
  graphCenter: string
  view: View
  searchOpen: boolean
  agent: { state: AgentState; label: string } | null
  rev: number
  /** The last block brought back by a restore or revert, so only its open editor re-reads it. */
  restored: { id: string; n: number } | null
  /** A change chosen in the home's timeline: its block's history card opens on it. */
  historyFocus: { id: string; line: string; n: number } | null
  appearance: Appearance
  density: Density
  /** Blocks opened, oldest first, and where we are in them: back and forward walk this. */
  history: string[]
  at: number
  /** Where to go back to when settings close. */
  returnTo: { view: View; side: Side } | null
  /** Ask the tree to show something (a block, channel or cortex category): it opens the way to it and scrolls to it. */
  reveal: { target: string; n: number } | null
  /** The panel last shown, for ⌘\ to bring back. */
  lastSide: Exclude<Side, null>
  agentsAllowed: boolean
  offered: Record<ToolName, boolean>
}

/** On a phone the side panel lies over the main panel, so it starts closed and closes when something opens. */
const narrow = () => typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches
const sideAfterOpen = (): Partial<State> => (narrow() ? { side: null } : {})

let state: State = {
  side: narrow() ? null : "repo", repoMode: "tree", scope: { cortex: true, vault: true }, sideWidth: savedWidth(), audience: "private", showVisibility: false, filters: NO_FILTERS,
  graphCenter: owner.handle, view: { kind: "empty" }, searchOpen: false, agent: null, rev: 0, restored: null, historyFocus: null,
  appearance: "system", density: savedDensity(), agentsAllowed: true,
  history: [], at: -1, returnTo: null, reveal: null, lastSide: "repo",
  offered: {
    "workspace.search": true, "workspace.open": true, "workspace.graph": true, "workspace.create": true, "workspace.save-draft": true, "workspace.add-image": true,
    "visibility.preview": true, "visibility.move": true,
    "history.list": true, "history.save": true, "history.session": true, "history.revert": true, "history.versions": true, "history.restore": true,
    "cortex.observe": true,
  },
}
const listeners = new Set<() => void>()
let walking = false
const set = (patch: Partial<State>) => {
  // The one place the open block changes: record it in history, and have the tree reveal it.
  const next = patch.view
  if (next?.kind === "doc" && !(state.view.kind === "doc" && state.view.id === next.id)) {
    if (!walking) {
      const history = [...state.history.slice(0, state.at + 1).filter(id => id !== next.id), next.id].slice(-50)
      patch = { ...patch, history, at: history.length - 1 }
    }
    patch = { ...patch, reveal: { target: next.id, n: (state.reveal?.n ?? 0) + 1 } }
  }
  if (patch.side) patch = { ...patch, lastSide: patch.side }
  state = { ...state, ...patch }
  listeners.forEach(l => l())
}
const bump = () => ({ rev: state.rev + 1 })
const refresh = () => {
  const sample = sampleWorkspace()
  if (sample) refreshSample(sample)
  return bump()
}

export async function setSource<Master, Sealed>(
  next: HomeSource | Workspace | { service: ServiceOptions<Master, Sealed> } = sampleSource,
) {
  if (!await selectSource("service" in next ? createServiceSource(next.service) : next)) return
  usedSlugs.clear()
  for (const doc of [...blocks, ...cortex]) usedSlugs.add(doc.slug)
  bodyReplacements.clear()
  sourceRevision = ++replacementSequence
  Object.values(marks).forEach(mark => mark.clear())
  const unreadFixture = sampleWorkspace() && bySlug("yanaka-dusk")
  if (unreadFixture) marks.unread.add(unreadFixture.id)
  set({ ...bump(), graphCenter: owner.handle, view: { kind: "empty" }, history: [], at: -1,
    reveal: null, returnTo: null, restored: null, historyFocus: null, searchOpen: false })
}

export const useWorkspace = () =>
  useSyncExternalStore(cb => (listeners.add(cb), () => listeners.delete(cb)), () => state)

// Rack
export const toggleSide = (side: Exclude<Side, null>) => {
  if (state.side === "profile" && state.view.kind === "settings") return closeSettings()
  set({ side: state.side === side ? null : side })
}
/** ⌘\: hide the side panel, or bring back the one last shown. The block stays as it is either way. */
export const togglePanel = () => set({ side: state.side ? null : state.lastSide })

// History
const existing = (id: string) => !!byId(id)
export const canGo = (dir: -1 | 1) => {
  for (let i = state.at + dir; i >= 0 && i < state.history.length; i += dir) if (existing(state.history[i])) return true
  return false
}
export function go(dir: -1 | 1) {
  for (let i = state.at + dir; i >= 0 && i < state.history.length; i += dir) {
    const id = state.history[i]
    if (!existing(id)) continue
    walking = true
    set({ view: { kind: "doc", id, mode: "read" }, at: i, ...sideAfterOpen() })
    walking = false
    return true
  }
  return false
}

/** Shows a folder in the tree: the panel opens on the home, and the way to it opens. */
export function revealFolder(prime: "vault" | "cortex", path: string) {
  set({
    side: "repo", repoMode: "tree",
    scope: { ...state.scope, [prime]: true },
    reveal: { target: `${prime}:${path}`, n: (state.reveal?.n ?? 0) + 1 },
  })
}
export const setSearchOpen = (searchOpen: boolean) => set({ searchOpen })
export const setAgent = (agent: State["agent"]) => set({ agent })

// Personal repo
export const setRepoMode = (repoMode: State["repoMode"]) => set({ repoMode, side: "repo" })
export const setScope = (scope: RepoScope) => set({ scope })
export const setFilters = (filters: Filters) => set({ filters })
/** Whether a block shows in the home under the current filters. */
export const kept = (d: Doc) => passes(state.filters, d, marks)
export function setSideWidth(w: number) {
  const sideWidth = Math.round(Math.min(SIDE_WIDTH.max, Math.max(SIDE_WIDTH.min, w)))
  try { localStorage.setItem("ohm-ux:side-width", String(sideWidth)) } catch { /* a convenience only */ }
  set({ sideWidth })
}
/** The graph filters a scope stands for. */
export const scopeFolders = (scope: RepoScope) => scope

// Visibility
export const setAudience = (audience: Audience) => set({ audience })
export const setShowVisibility = (showVisibility: boolean) =>
  set({ showVisibility, side: "repo", repoMode: "tree", ...(showVisibility ? {} : { audience: "private" as Audience }) })
/** Marks who a block is for in the sample. The panel asks first when widening the audience. */
export function setVisibility(id: string, visibility: Visibility, why?: string) {
  const doc = byId(id)
  if (!isBlock(doc)) throw new DOMException("Only blocks have visibility", "DataError")
  const held = blockVersion(id)!
  editable().markVisibility!(held.ref, visibility, held.version, why)
  set(refresh())
}

// Inbox
export function openInbox(id: string) {
  const item = inbox.find(i => i.id === id)
  if (!item) throw new DOMException(`Nothing in the inbox with id ${id}`, "NotFoundError")
  sampleWorkspace()?.demo.markInboxRead(id)
  set({ view: item.ref ? { kind: "doc", id: item.ref, mode: "read" } : { kind: "inbox", id }, ...bump(), ...sideAfterOpen() })
}

// Profile and settings
export function openSettings(tab: SettingsTab = "profile") {
  // Remember where you were, once, so leaving settings goes back there.
  const returnTo = state.view.kind === "settings" ? state.returnTo : { view: state.view, side: state.side === "profile" ? state.lastSide : state.side }
  set({ side: narrow() && state.side === "profile" ? null : "profile", view: { kind: "settings", tab }, searchOpen: false, returnTo })
}
/** Leaving settings: back to the block and panel you came from. */
export function closeSettings() {
  const back = state.returnTo
  const view = back?.view.kind === "doc" && !byId(back.view.id) ? { kind: "empty" as const } : back?.view ?? { kind: "empty" as const }
  set({ view, side: back?.side === "profile" ? "repo" : back?.side ?? "repo", returnTo: null })
}
export function setAppearance(appearance: Appearance) {
  document.documentElement.dataset.theme = appearance
  set({ appearance })
}
export function setDensity(density: Density) {
  document.documentElement.dataset.density = density
  try { localStorage.setItem("ohm-ux:density", density) } catch { /* a convenience only */ }
  set({ density })
}
/** Applies the saved density before the first paint. */
export const applyDensity = () => { document.documentElement.dataset.density = state.density }
export const setAgentsAllowed = (agentsAllowed: boolean) => set({ agentsAllowed })
export const setOffered = (name: ToolName, on: boolean) => set({ offered: { ...state.offered, [name]: on } })

// Handlers shared by the UI and the tools.
export function open(id: string, mode: "read" | "edit" = "read") {
  const doc = byId(id)
  if (!doc) throw new DOMException(`Nothing with id ${id}`, "NotFoundError")
  if (mode === "edit") editable()
  marks.unread.delete(id)
  set({ view: { kind: "doc", id, mode }, searchOpen: false, ...sideAfterOpen() })
  return { id, title: doc.title, view: mode, next: mode === "edit" ? "workspace.save-draft" : "workspace.open" }
}

/** The graph lives in the side panel, in the home. */
export function showGraph(center?: string) {
  const g = buildGraph({ center, audience: state.audience, ...scopeFolders(state.scope), keep: kept })
  set({ side: "repo", repoMode: "graph", graphCenter: g.center.handle, searchOpen: false })
  return { center: g.center.handle, nodes: g.nodes.length, edges: g.edges.length }
}

const usedSlugs = new Set([...blocks, ...cortex].map(doc => doc.slug))
/** A slug no other block has, from a title. */
function freeSlug(title: string, fallback = "untitled") {
  const stem = slugify(title) || fallback
  let slug = stem
  for (let suffix = 2; usedSlugs.has(slug); suffix++) {
    slug = `${stem.slice(0, 59 - String(suffix).length)}-${suffix}`
  }
  return slug
}
export function createDraft(input: { homeChannel?: string; channels?: string[]; title?: string } = {}) {
  const homeChannel = input.homeChannel?.trim() || "other"
  validateChannel(homeChannel)
  const title = input.title?.trim() ?? ""
  const slug = freeSlug(title)
  // Everything about the new block is set here, before the one change that records it.
  const doc: Doc = {
    id: newNodeId(), kind: "text", slug, title, homeChannel,
    ...(input.channels?.length ? { channels: [...input.channels] } : {}), visibility: "private",
    updated: new Date().toISOString().slice(0, 10), body: "",
  }
  persist(doc)
  usedSlugs.add(slug)
  set({ view: { kind: "doc", id: doc.id, mode: "edit" }, ...refresh(), searchOpen: false, ...sideAfterOpen() })
  return { id: doc.id, slug, view: "edit", next: "workspace.save-draft" }
}

/** Saves the open block as private. Never publishes. */
export function saveDraft(input: { title?: string; body?: string }) {
  const v = state.view
  if (v.kind !== "doc") throw new DOMException("No block is open in the editor", "InvalidStateError")
  const doc = draftOf(v.id)
  if (!isBlock(doc)) throw new DOMException("Only blocks are edited here", "DataError")
  // Changing a block other people can see needs the person's approval (AGENTS.md rule 11): its own flow.
  if (doc.visibility !== "private") throw new DOMException("This block is not private; changing it needs approval", "NotAllowedError")
  if (input.title !== undefined) doc.title = input.title.trim()
  if (input.body !== undefined) updateBody(doc, input.body)
  // The editor keeps the block open; saving changes nothing about what is on screen.
  doc.updated = new Date().toISOString().slice(0, 10)
  persist(doc)
  set(refresh())
  return { id: doc.id, slug: doc.slug, visibility: doc.visibility }
}

export const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60)
export { owner as me }

/** A block's icon: an emoji shown above its title. */
export function setIcon(id: string, icon: string | undefined) {
  const doc = draftOf(id)
  if (!doc) return
  doc.icon = icon
  persist(doc)
  set(refresh())
}
function updateBody(doc: Doc, body: string) {
  // Every save of a body, the editor's flush on leaving included, comes through here.
  assertDurable(body)
  doc.body = body
  if (doc.kind === "post" || doc.kind === "excerpt") return
  // A media block stays one while its body still embeds its file, a caption beside it or not.
  if (doc.media && embedsIn(body).some(target => /\.[A-Za-z0-9]{1,5}$/.test(target))) { doc.kind = "media"; return }
  const kind = inferKind(body) as Doc["kind"]
  // A text whose whole body embeds another block is still a text, not a file.
  const [only] = embedsIn(body)
  doc.kind = kind === "file" && only && resolveEmbed(only) ? "text" : kind
  if (doc.kind !== "media") delete doc.media
}

const IMAGE_TYPES: Record<string, string> = {
  "image/avif": "avif", "image/gif": "gif", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
}
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024

/**
 * Adds an image as a media block of its own, in a channel: its bytes kept by CID in the browser's
 * media cache, its block private. An image the vault already holds is not copied: its media block is
 * collected into the channel, as Are.na connects a block. Returns the media block's id and slug, for
 * an embed (`![[slug]]`). The editor's drop, paste and picker, and the `workspace.add-image` tool, call this.
 */
export async function addImage(input: { name: string; type: string; bytes: Uint8Array; channel: string; alt?: string }) {
  const ending = IMAGE_TYPES[input.type]
  if (!ending) throw new DOMException(`An image is one of: ${Object.keys(IMAGE_TYPES).join(", ")}`, "DataError")
  if (!input.bytes.length || input.bytes.length > MAX_IMAGE_BYTES) throw new DOMException("An image is up to 20 MB", "DataError")
  validateChannel(input.channel)
  editable()
  const hash = await keep(input.bytes, input.type)
  const held = blocks.find(doc => doc.media?.hash === hash)
  if (held) {
    if (isBlock(held) && !channelsOf(held).includes(input.channel)) collect(held.id, input.channel)
    return { id: held.id, slug: held.slug, created: false }
  }
  const stem = input.name.replace(/\.[^.]+$/, "").trim() || "image"
  const slug = freeSlug(stem, "image")
  // The file sits beside its block in the home folder, so its name is free in that channel.
  const taken = new Set(blocks.filter(doc => isBlock(doc) && doc.homeChannel === input.channel).map(doc => mediaFile(doc)))
  let file = `${slug}.${ending}`
  for (let n = 2; taken.has(file); n++) file = `${slug}-${n}.${ending}`
  const size = await measure(input.bytes, input.type)
  const alt = input.alt?.trim() || stem
  const doc: Doc = {
    id: newNodeId(), kind: "media", slug, title: stem, homeChannel: input.channel, visibility: "private",
    updated: new Date().toISOString().slice(0, 10), body: `![[${file}]]`,
    media: { hash, mime: input.type, ...size, alt },
  }
  persist(doc)
  usedSlugs.add(slug)
  set(refresh())
  void makeSizes(hash, input.bytes, input.type)
  return { id: doc.id, slug, created: true }
}

/** Saves as you type, for private blocks only. */
export function autosave(id: string, patch: { title?: string; body?: string }) {
  const doc = draftOf(id)
  if (!isBlock(doc) || doc.visibility !== "private") return
  if (patch.title !== undefined) doc.title = patch.title
  if (patch.body !== undefined) updateBody(doc, patch.body)
  doc.updated = new Date().toISOString().slice(0, 10)
  persist(doc)
  set(refresh())
}

/**
 * Collects a block into a channel, keeping every channel it is already in: a block can be in any
 * number of them. Its home channel changes when you move the home row.
 */
export function collect(id: string, path: string) {
  const doc = draftOf(id)
  if (!isBlock(doc)) throw new DOMException("Only blocks can be collected into channels", "DataError")
  validateChannel(path)
  if (doc.homeChannel === path || doc.channels?.includes(path)) return { added: false }
  doc.channels = [...(doc.channels ?? []), path]
  persist(doc)
  set(refresh())
  return { added: true }
}

/** Moves or adds a block's placement and updates the destination's order. */
export function moveBlock(id: string, from: string, to: string, opts: { before?: string; after?: string; keep?: boolean } = {}) {
  const doc = draftOf(id)
  if (!isBlock(doc)) throw new DOMException("Only blocks move between channels", "DataError")
  validateChannel(to)
  let homeChannelChanged = false
  if (from !== to) {
    if (opts.keep) {
      if (!channelsOf(doc).includes(to)) doc.channels = [...(doc.channels ?? []), to]
    } else if (doc.homeChannel === from) {
      doc.homeChannel = to
      doc.channels = doc.channels?.filter(c => c !== to)
      homeChannelChanged = true
    } else {
      doc.channels = (doc.channels ?? []).filter(c => c !== from)
      if (doc.homeChannel !== to && !doc.channels.includes(to)) doc.channels.push(to)
    }
    persist(doc)
  }
  if (opts.before || opts.after) {
    const records = structuredClone(channelRecords)
    const list = inOrder(to, blocks.filter(post => channelsOf(post).includes(to))).map(post => post.id).filter(x => x !== id)
    const index = opts.before ? list.indexOf(opts.before) : list.indexOf(opts.after!) + 1
    list.splice(index < 0 ? list.length : index, 0, id)
    ensureChannel(records, to).order = list
    updateChannels(records)
  }
  set(refresh())
  return { homeChannelChanged, published: homeChannelChanged && doc.visibility !== "private" }
}

/**
 * Moves a channel into another, or to the top with `into` null: what dragging a channel's row does.
 * Every block in it goes along, and keeps its order. A channel inside a channel holds no channels of
 * its own yet, so a channel that holds some cannot go inside another.
 */
export function moveChannel(path: string, into: string | null) {
  const name = path.split("/").at(-1)!
  const next = into ? `${into}/${name}` : name
  validateChannel(next)
  if (into && into.includes("/")) throw new DOMException("A channel inside a channel can't hold channels yet", "DataError")
  if (into && (into === path || into.startsWith(`${path}/`))) throw new DOMException("A channel can't go inside itself", "DataError")
  if (into && channelRecords.some(c => c.path.startsWith(`${path}/`))) throw new DOMException(`“${name}” holds channels of its own, so it can't go inside another yet`, "DataError")
  if (next === path) return { path, published: 0 }
  const whole = movedWhole(path, next)
  if (whole) return { path: next, published: whole.published }
  const records = structuredClone(channelRecords)
  const record = ensureChannel(records, path)
  const there = records.find(channel => channel.path === next)
  if (there) {
    there.order = [...there.order, ...record.order.filter(id => !there.order.includes(id))]
    records.splice(records.indexOf(record), 1)
  } else record.path = next
  if (into) ensureChannel(records, into)
  const published = refile(path, next, false)
  updateChannels(records)
  set(refresh())
  return { path: next, published }
}

/**
 * Makes a channel: at the top, or inside a top-level channel. It is empty until something is moved or
 * added into it, and stays when it is emptied again. Returns its path.
 */
export function createChannel(inside?: string) {
  if (inside?.includes("/")) throw new DOMException("A channel inside a channel can't hold channels yet", "DataError")
  let n = 1, path = inside ? `${inside}/untitled` : "untitled"
  while (channelRecords.some(channel => channel.path === path)) path = `${inside ? `${inside}/` : ""}untitled-${++n}`
  const records = structuredClone(channelRecords)
  ensureChannel(records, path)
  updateChannels(records)
  set(refresh())
  return path
}

/** Removes an empty channel. One with blocks or channels in it is refused: move them out first. */
export function deleteChannel(path: string) {
  if (blocks.some(p => channelsOf(p).some(c => c === path || c.startsWith(`${path}/`))) || channelRecords.some(c => c.path.startsWith(`${path}/`)))
    throw new DOMException(`“${path.replace("/", " › ")}” is not empty: move what is in it out first`, "DataError")
  updateChannels(channelRecords.filter(channel => channel.path !== path))
  set(refresh())
}

/** Takes a block out of a channel. Use moveBlock to change its home channel. */
export function uncollect(id: string, path: string) {
  const doc = draftOf(id)
  if (!doc?.channels?.includes(path)) return { removed: false }
  doc.channels = doc.channels.filter(c => c !== path)
  persist(doc)
  set(refresh())
  return { removed: true }
}

/**
 * Connects one block to another as a whole, with an optional line on why. Yours to make: it is
 * evidence, so no agent tool does it. Like the text, it changes only a private block here; a block
 * other people see is changed through the steps that ask first.
 */
export function connectDocs(id: string, toId: string, why?: string) {
  const doc = draftOf(id), target = byId(toId)
  if (!isBlock(doc) || !isBlock(target)) throw new DOMException("Only blocks connect to blocks", "DataError")
  if (doc.id === target.id) throw new DOMException("A block does not connect to itself", "DataError")
  if (doc.visibility !== "private") throw new DOMException("Connecting changes what others see; it is not part of this wireframe yet", "NotAllowedError")
  if (doc.connect?.some(c => c.to === target.slug)) return { added: false }
  doc.connect = [...(doc.connect ?? []), { to: target.slug, ...(why?.trim() ? { why: why.trim() } : {}) }]
  doc.updated = new Date().toISOString().slice(0, 10)
  persist(doc)
  set(refresh())
  return { added: true }
}

/** Says why a connection is there, or clears it. */
export function setWhy(id: string, toSlug: string, why: string) {
  const doc = draftOf(id)
  const c = doc?.connect?.find(c => c.to === toSlug)
  if (!doc || !c || doc.visibility !== "private") return
  if (why.trim()) c.why = why.trim(); else delete c.why
  persist(doc)
  set(refresh())
}

/** Takes a whole-block connection away. A link in the text is removed by editing the text. */
export function disconnect(id: string, toSlug: string) {
  const doc = draftOf(id)
  if (!doc?.connect || doc.visibility !== "private") return
  doc.connect = doc.connect.filter(c => c.to !== toSlug)
  persist(doc)
  set(refresh())
}

// ─── The cortex: what the person changes in it (cortex/docs/model.md, "Who may change what") ───

const cortexDoc = (id: string) => {
  const doc = draftOf(id)
  if (!doc || isBlock(doc) || !isCortexKind(doc.kind)) throw new DOMException("There is no such part of your cortex.", "NotFoundError")
  return doc
}
const today = () => new Date().toISOString().slice(0, 10)

/** The person edits the text of a cortex part: the profile, an observation, a skill or a tool. Saved as they type. */
export function editCortex(id: string, body: string) {
  const doc = cortexDoc(id)
  if (doc.body === body) return
  doc.body = body
  doc.updated = today()
  persist(doc)
  set(refresh())
}

const OBSERVATION_LIMIT = 2000
/**
 * Writes an observation: the person's own, or an agent's in the page once the person approved it
 * (the cortex.observe tool). `about` is what it is about: block IDs, or channels as channel:<path>.
 * Returns its id and title.
 */
export function writeObservation(input: { text: string; about?: string[] }, why?: string) {
  const text = input.text.trim()
  if (!text || [...text].length > OBSERVATION_LIMIT) throw new DOMException(`An observation is what was seen, at most ${OBSERVATION_LIMIT} characters`, "DataError")
  const about = [...new Set(input.about ?? [])]
  if (about.length > 20 || about.some(item => item.startsWith("channel:") ? !channelRecords.some(c => `channel:${c.path}` === item) && !blocks.some(b => channelsOf(b).includes(item.slice(8))) : !isBlock(byId(item)))) {
    throw new DOMException("about is up to 20 blocks in this home, by id, or channels as channel:<path>", "DataError")
  }
  const doc: Doc = {
    id: `observation-${newNodeId()}`, kind: "observation", title: text.split("\n")[0].slice(0, 80), slug: "", body: text,
    visibility: "private", updated: today(), ...(about.length ? { about } : {}),
  }
  doc.slug = doc.id
  editable().demo.saveCortex(doc, undefined, why)
  usedSlugs.add(doc.slug)
  set(refresh())
  const made = byId(doc.id)!
  return { id: made.id, title: made.title, about }
}

/** Pins an observation, so every agent session is handed it, or unpins it. Only the person does this. */
export function pinObservation(id: string, pin: boolean) {
  const doc = cortexDoc(id)
  if (doc.kind !== "observation") throw new DOMException("Only an observation is pinned", "DataError")
  if (!!doc.pin === pin) return
  if (pin) doc.pin = true; else delete doc.pin
  persist(doc)
  set(refresh())
}

/** Switches a tool on, so agents may use it, or off. Only the person does this. */
export function switchTool(id: string, on: boolean) {
  const doc = cortexDoc(id)
  if (doc.kind !== "tool") throw new DOMException("Only a tool is switched on or off", "DataError")
  if (!!doc.on === on) return
  doc.on = on
  persist(doc)
  set(refresh())
}

/** Forgets an observation, or removes a skill. The cortex keeps it, so it can be restored. */
export function forgetCortex(id: string) {
  const doc = cortexDoc(id)
  if (doc.kind !== "observation" && doc.kind !== "skill") throw new DOMException("Only an observation or a skill is removed", "DataError")
  editable().demo.removeCortex(id)
  for (const s of Object.values(marks)) s.delete(id)
  const wasOpen = state.view.kind === "doc" && state.view.id === id
  set({ ...refresh(), history: state.history.filter(h => h !== id), ...(wasOpen ? { view: { kind: "empty" } as View } : {}) })
}

/** What agents proposed and asked for, waiting for the person. */
export const cortexWaiting = () => sampleWorkspace()?.demo.waiting() ?? { profile: [], skills: [], tools: [] }

/** The person's answer: a profile line accepted or declined, a skill approved or declined. */
export async function answerCortex(kind: "profile" | "skill", id: string, yes: boolean) {
  await editable().demo.answer(kind, id, yes)
  set(refresh())
}

/** Opens a Markdown or text file as a new private block. */
export function openFile(name: string, text: string) {
  const title = name.replace(/\.(md|markdown|txt)$/i, "")
  const draft = createDraft({ title })
  autosave(draft.id, { body: text })
  return draft
}

// ─── Row actions: the ⋯ menu on a block in the home ──────────────────────

/** Pinned blocks show on top of the home; unread ones show in weight until opened; archived ones leave the tree. */
export const marks = { pinned: new Set<string>(), unread: new Set<string>(blocks.filter(doc => doc.slug === "yanaka-dusk").map(doc => doc.id)), archived: new Set<string>() }
const flip = (set: Set<string>, id: string, on = !set.has(id)) => { if (on) set.add(id); else set.delete(id); set_(bump()) }
const set_ = (patch: Partial<State>) => set(patch)

export const togglePin = (id: string) => flip(marks.pinned, id)
export const toggleUnread = (id: string) => flip(marks.unread, id)
export const toggleArchive = (id: string) => {
  flip(marks.archived, id)
  if (marks.archived.has(id)) marks.pinned.delete(id)
}

/** Renames a block and keeps its slug so links and connections still resolve. */
export function renameDoc(id: string, title: string) {
  const doc = draftOf(id)
  if (!doc) return
  doc.title = title.trim()
  doc.updated = new Date().toISOString().slice(0, 10)
  persist(doc)
  set(refresh())
}

/** Removes a block from the vault. Taking a published one down from the home is its own step. */
export function deleteDoc(id: string) {
  const held = blockVersion(id)
  if (!held) return
  editable().deleteBlock(held.ref, held.version)
  bodyReplacements.delete(id)
  for (const s of Object.values(marks)) s.delete(id)
  const wasOpen = state.view.kind === "doc" && state.view.id === id
  // Take it out of history; the position moves back one if it was at or before where we are.
  const idx = state.history.indexOf(id)
  const history = state.history.filter(h => h !== id)
  const at = idx >= 0 && idx <= state.at ? state.at - 1 : state.at
  set({ ...refresh(), history, at, ...(state.reveal?.target === id ? { reveal: null } : {}) })
  if (!wasOpen) return
  // Deleting the open block lands on the block before it (or after it), never a blank editor.
  const landing = history[at] ?? history[at + 1]
  if (landing && byId(landing)) {
    walking = true
    set({ view: { kind: "doc", id: landing, mode: "read" }, at: history.indexOf(landing) })
    walking = false
  } else set({ view: { kind: "empty" } })
}

/**
 * Renames a channel and refiles its blocks. A post’s address follows on its next publish.
 */
export function renameChannel(path: string, name: string) {
  const next = name.trim().toLowerCase().replace(/\s+/g, "-")
  const to = [...path.split("/").slice(0, -1), next].join("/")
  validateChannel(to)
  if (to === path) return { published: 0 }
  if (channelRecords.some(channel => channel.path === to)) throw new DOMException(`There is already a channel “${to.replace("/", " › ")}”`, "DataError")
  const whole = movedWhole(path, to)
  if (whole) return whole
  const records = channelRecords.map(channel => ({ ...channel, path: replacePath(channel.path, path, to, true) }))
  const published = refile(path, to, true)
  updateChannels(records)
  set(refresh())
  return { published }
}

/**
 * A channel moved as one folder by a source that can (the home on this computer), in place of moving
 * each block: what used its old path is rewritten there. Null when the source moves block by block.
 */
function movedWhole(from: string, to: string) {
  const source = editable()
  if (!source.moveChannel) return null
  const inside = (path?: string) => !!path && (path === from || path.startsWith(`${from}/`))
  const published = blocks.filter(doc => isBlock(doc) && inside(doc.homeChannel) && doc.visibility !== "private").length
  source.moveChannel(from, to)
  set(refresh())
  return { published }
}

/** The source changed what it holds by itself (the home's bridge answered): read it again. */
export const sourceChanged = () => set(refresh())

function validateChannel(path: string) {
  if (!isChannelPath(path) || path.length > 120 || path.split("/").length > 2) {
    throw new DOMException("Choose a channel path with one or two levels.", "DataError")
  }
}

const replacePath = (value: string, from: string, to: string, descendants: boolean) =>
  value === from || (descendants && value.startsWith(`${from}/`)) ? to + value.slice(from.length) : value

function refile(from: string, to: string, descendants: boolean) {
  let published = 0
  for (const doc of blocks) {
    if (!isBlock(doc)) continue
    const home = doc.homeChannel
    const next = replacePath(home, from, to, descendants)
    const channels = doc.channels?.map(path => replacePath(path, from, to, descendants))
    if (next === home && !channels?.some((path, index) => path !== doc.channels?.[index])) continue
    persist({ ...doc, homeChannel: next, channels })
    if (next !== home && doc.visibility !== "private") published++
  }
  return published
}

// ─── History: restore, revert, save, sessions (flows/history.md) ─────────────────────────────

const bodyReplacements = new Map<string, number>()
let replacementSequence = 0
let sourceRevision = 0
export const bodyRevision = (doc: Doc) => bodyReplacements.get(doc.id) ?? sourceRevision

function markRestored(doc: Doc) {
  bodyReplacements.set(doc.id, ++replacementSequence)
  set({ ...refresh(), restored: { id: doc.id, n: bodyRevision(doc) } })
}

/**
 * Brings a private block back to an earlier version. History is never rewritten: the restore is a
 * new change, by whoever restored it, so it can itself be undone the same way. A block other people
 * see changes only through the steps that ask first, so it is refused here.
 */
export function restoreVersion(id: string, version: string, reason?: string) {
  const doc = draftOf(id)
  const held = blockVersion(id)
  if (!doc) throw new DOMException("There is no such block", "NotFoundError")
  if (doc.visibility !== "private") throw new DOMException("Restoring changes what others see; it asks first, which is not part of this wireframe yet", "NotAllowedError")
  const source = editable()
  const entry = held && source.history(held.ref).find(entry => entry.version === version)
  const snapshot = held
    ? entry && snap(docOf(held.ref, source.readVersion(held.ref, entry.rev)).doc)
    : demoJournal().linesFor(id).some(change => change.after === version) && demoJournal().snapshotAt(version)
  if (!snapshot) throw new DOMException("There is no such version", "NotFoundError")
  applySnapshot(doc, snapshot)
  doc.updated = new Date().toISOString().slice(0, 10)
  persist(doc, { op: "restore", reason: reason?.trim() || `Restored version ${version}` })
  markRestored(doc)
  return { id: doc.id, version, by: demoJournal().actor().name }
}

/**
 * Undoes one change, as `git revert` does: only the parts of the block that change touched go back,
 * and later changes to other parts stay. If a later change touched the same part, it is refused, and
 * restoring a whole version is the way. Like a restore, it is a new change, so it can be undone too.
 */
export function revertChange(lineId: string) {
  const { changeById, snapshotAt } = demoJournal()
  const line = changeById(lineId)
  if (!line) throw new DOMException("There is no such change", "NotFoundError")
  const doc = draftOf(line.node)
  if (!doc) throw new DOMException("That block is gone and cannot be reverted", "NotFoundError")
  if (doc.visibility !== "private") throw new DOMException("Reverting changes what others see; it asks first, which is not part of this wireframe yet", "NotAllowedError")
  if (!line.before || line.op === "create") throw new DOMException("This change created the block. Delete the block to undo it.", "DataError")
  const before = snapshotAt(line.before)!, after = snapshotAt(line.after)!, now = snap(doc)
  const fields = line.fields as (keyof Snapshot)[]
  if (!fields.length) throw new DOMException("This change changed nothing to revert", "DataError")
  const later = fields.filter(f => JSON.stringify(now[f]) !== JSON.stringify(after[f]))
  const named = [...new Set(later.map(f => ({ body: "text", homeChannel: "home channel", connect: "connections" } as Record<string, string>)[f] ?? f))]
  if (later.length) throw new DOMException(`A later change also touched its ${named.join(" and ")}: restore a whole version instead`, "DataError")
  applySnapshot(doc, { ...now, ...Object.fromEntries(fields.map(f => [f, before[f]])) } as Snapshot)
  doc.updated = new Date().toISOString().slice(0, 10)
  persist(doc, { op: "revert", reason: `Reverted “${line.summary}” (${new Date(line.at).toLocaleDateString(undefined, { month: "short", day: "numeric" })})` })
  markRestored(doc)
  return { id: doc.id, reverted: line.id, fields }
}

/** Opens the open block's history card on one change. */
export const focusHistory = (id: string, line: string) => set({ historyFocus: { id, line, n: (state.historyFocus?.n ?? 0) + 1 } })

/** Names the home as it is now, so you or an agent can come back to it. It changes nothing. */
export function saveNow(name: string, note?: string) {
  if (!name.trim()) throw new DOMException("A save needs a name", "DataError")
  editable()
  const line = demoJournal().save(name, note)
  set(bump())
  return { name: line.name, seq: line.seq }
}

/** An agent finishing a task: what it did, and the dead ends a later agent should not retry. */
export function finishSession(done: string, deadEnds: DeadEnd[] = []) {
  const who = demoJournal().actor()
  if (who.kind !== "agent") throw new DOMException("Sessions are written by agents, when they finish a task", "NotAllowedError")
  if (!done.trim()) throw new DOMException("Say in one line what was done", "DataError")
  const line = demoJournal().recordSession(who, done, deadEnds)
  set(bump())
  return { session: line.id, changes: line.changes.length, deadEnds: line.deadEnds.length }
}
