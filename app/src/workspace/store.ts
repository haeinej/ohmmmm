// Workspace state, and the handlers both the UI and the WebMCP tools call (AGENTS.md rule 2).
// Every change goes to the home's source (the vault service) first, one at a time, and the
// workspace shows it once the source has answered.
import { useSyncExternalStore } from "react"
import { blockVersion, byId, heldBlock, privateLayer, channelByPath, channelRecords, channelsOf, cortex, dropBlock, dropChannel, getSource, heldChannel,
  inOrder, isBlock, isCortexKind, journalOf, landBlock, landChannel, landCortex, heldCortex, dropCortex, owner, blocks, selectSource,
  type Audience, type Doc, type Visibility,
} from "@/data/workspace-data"
import { fileOf } from "@/data/block-document"
import { cortexFileOf } from "@/data/cortex-document"
import { docOf } from "@/data/block-document"
import { postFile, setProperty, slugOf, writeNoteFile } from "../../../vault/vault/file.mjs"
import { inferKind, isChannelPath, newNodeId, readNode } from "../../../vault/vault/node.mjs"
import { createServiceSource, newOpaqueId, type ServiceOptions } from "@/data/service-source"
import { type BlockRef, type HomeSource, type MoveRecord, type MoveRequest, type MoveTarget } from "@/data/source"
import { blockAsPost, planMove } from "../../../vault/vault/visibility.mjs"
import { buildGraph } from "@/graph/model"
import type { AgentState } from "@/components/agent-status"
import type { SettingsTab } from "./settings-tabs"
import { NO_FILTERS, passes, type Filters } from "./filters"
import { applySnapshot, snap, versionOf, type DeadEnd, type Snapshot } from "@/data/journal"
import type { CortexWaiting } from "@/data/workspace-model"
import { assertDurable, embedsIn, mediaFile, resolveEmbed } from "@/media/embeds"
import { keep, makeSizes, measure } from "@/media/cache"

const live = () => {
  const source = getSource()
  if (!source) throw new DOMException("Sign in to change your home.", "InvalidStateError")
  return source
}
const draftOf = (id: string) => {
  const doc = byId(id)
  return doc && structuredClone(doc)
}
const today = () => new Date().toISOString().slice(0, 10)

/** Writes run one after another, so each names the version the one before it left. */
let queue: Promise<unknown> = Promise.resolve()
function serial<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task)
  queue = run.catch(() => undefined)
  return run
}
/** Something that failed after the UI moved on: the app shows it as a notice. */
const failureListeners = new Set<(problem: Error) => void>()
export const onFailure = (listener: (problem: Error) => void) => (failureListeners.add(listener), () => { failureListeners.delete(listener) })
/** For UI calls that don't wait: a failed write is reported, never swallowed. */
export function report<T>(work: Promise<T>) {
  work.catch((problem: Error) => failureListeners.forEach(listener => listener(problem)))
  return work
}

/** Saves one block or cortex file as it is now in `doc`. Runs inside `serial`. */
async function persist(doc: Doc, change?: Parameters<HomeSource["saveBlock"]>[3], why?: string) {
  const source = live()
  if (!isBlock(doc)) {
    const held = heldCortex(doc.id)
    const file = cortexFileOf(doc, held)
    // The sealed journal entry says who changed it and why, in the shape the journal reads back.
    const journal = journalOf()
    const before = journal.currentVersion(doc.id), after = versionOf(snap(doc))
    const line = {
      type: "change", owner: "cortex", node: doc.id, op: change?.op ?? (held ? "edit" : "create"), actor: journal.actor(),
      at: new Date().toISOString(), fields: [], before, after, summary: held ? "Edited it" : "Made it",
      ...(change?.reason ?? why ? { reason: change?.reason ?? why } : {}), seq: 0, id: `${Date.now().toString(36)}-${doc.id.slice(0, 6)}`,
    }
    const { version } = await source.cortex.save(doc.id, file, held?.version ?? null, { line, snapshots: { [after]: snap(doc) } })
    landCortex({ id: doc.id, ...file, version })
  } else {
    const held = blockVersion(doc.id)
    const ref: BlockRef = held?.ref ?? { id: doc.id, layer: "private", store: "sealed" }
    // From the file as the source gave it, so properties the workspace doesn't edit are kept.
    const file = fileOf(doc, heldBlock(doc.id)?.file)
    const { version } = await source.saveBlock(ref, file, held?.version ?? null, change)
    landBlock(ref, file, version)
  }
  journalOf().syncJournal(change)
}
/** Changes a block or cortex file as `change` says, from what the source last answered. */
function update<T>(id: string, change: (doc: Doc) => T | undefined, opts?: Parameters<HomeSource["saveBlock"]>[3]): Promise<T | undefined> {
  return serial(async () => {
    const doc = draftOf(id)
    if (!doc) throw new DOMException("There is no such block", "NotFoundError")
    const out = change(doc)
    if (out === undefined) return undefined
    await persist(doc, opts)
    set(bump())
    return out
  })
}
/** Saves a channel's `_channel.md` with one property changed. */
async function saveChannelProperty(path: string, key: string, value: unknown) {
  const held = heldChannel(path)
  const text = setProperty(held?.text ?? writeNoteFile({ properties: { id: newNodeId(), created: today() } }), key, value)
  const { version } = await live().channels.save({ path, text }, held?.version ?? null)
  landChannel(path, text, version)
}

/** What the side panel shows. The rack chooses it. */
export type Side = "repo" | "visibility" | "profile" | null
export type View =
  | { kind: "empty" }
  | { kind: "doc"; id: string; mode: "read" | "edit" }
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
  | "cortex.observe"
  | "history.list" | "history.save" | "history.session" | "history.revert" | "history.versions" | "history.restore"

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
  /** The cortex drawn around the person in the graph. Off unless turned on. */
  graphCortex: boolean
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
  graphCenter: owner.handle, graphCortex: false, view: { kind: "empty" }, searchOpen: false, agent: null, rev: 0, restored: null, historyFocus: null,
  appearance: "system", density: savedDensity(), agentsAllowed: true,
  history: [], at: -1, returnTo: null, reveal: null, lastSide: "repo",
  offered: {
    "workspace.search": true, "workspace.open": true, "workspace.graph": true, "workspace.create": true, "workspace.save-draft": true, "workspace.add-image": true,
    "visibility.preview": true, "visibility.move": true,
    "cortex.observe": true,
    "history.list": true, "history.save": true, "history.session": true, "history.revert": true, "history.versions": true, "history.restore": true,
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

/**
 * Chooses the home: the vault service (the default, once signed in), a source given directly (tests
 * give a fixture), or null for signed out.
 */
export async function setSource<Master, Sealed>(
  next: HomeSource | HomeSource<"sync"> | { service: ServiceOptions<Master, Sealed> } | null = null,
  { keepView = false } = {},
) {
  set(bump())
  if (!await selectSource(next && "service" in next ? createServiceSource(next.service) : next)) return
  usedSlugs.clear()
  for (const doc of [...blocks, ...cortex]) usedSlugs.add(doc.slug)
  await movesOnOpen()
  if (keepView) { set(bump()); return }
  bodyReplacements.clear()
  sourceRevision = ++replacementSequence
  Object.values(marks).forEach(mark => mark.clear())
  set({ ...bump(), graphCenter: owner.handle, view: { kind: "empty" }, history: [], at: -1,
    reveal: null, returnTo: null, restored: null, historyFocus: null, searchOpen: false })
}

/** Ends the ohm session (ohm's sign-in, Better Auth, on this address) and shows sign-in. */
export async function signOut() {
  const response = await fetch(new URL("/api/auth/sign-out", location.origin), {
    method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: "{}",
  })
  if (!response.ok) throw new DOMException("Signing out failed. Try again.", "OperationError")
  await setSource(null)
}

/** Reads the whole home again from its source, keeping what is open. */
export const reload = () => serial(async () => {
  const source = getSource()
  if (source) await setSource(source, { keepView: true })
})

/**
 * Finds who is signed in on this origin and opens their vault service. Signed out, or with no
 * service here, the workspace shows sign-in. The private layer and the cortex open once this device
 * has unlocked the account's keys (`privateSession`, from the account app's packages/keys).
 */
/** The source changed what it holds by itself (the home's bridge answered): read it again, keeping the view. */
export const sourceChanged = () => { const source = getSource(); return source ? report(setSource(source, { keepView: true })) : Promise.resolve() }

export async function connectHome<Master, Sealed>(options: Pick<ServiceOptions<Master, Sealed>, "privateSession" | "fetch"> = {}) {
  const send = options.fetch ?? fetch
  try {
    const response = await send(new URL("/vault/xrpc/com.ohmmmm.account.get", location.origin), { credentials: "same-origin", redirect: "error" })
    const account = response.ok ? await response.json() as { did?: string | null } : null
    if (!account?.did) return setSource(null)
    await setSource({ service: { origin: location.origin, did: account.did, ...options } })
  } catch {
    await setSource(null)
  }
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

// Visibility
export const setAudience = (audience: Audience) => set({ audience })
export const setShowVisibility = (showVisibility: boolean) =>
  set({ showVisibility, side: "repo", repoMode: "tree", ...(showVisibility ? {} : { audience: "private" as Audience }) })
/** What moving a block would do, by the shared rules (vault/vault/visibility.mjs): the preview both the panel and `visibility.preview` show. */
export function previewMove(id: string, to: Visibility) {
  const doc = byId(id)
  if (!isBlock(doc)) throw new DOMException("Only blocks have visibility", "DataError")
  try {
    return { id, title: doc.title, ...planMove({ from: doc.visibility, to, title: doc.title }) }
  } catch (err) {
    throw new DOMException((err as Error).message, "DataError")
  }
}

/**
 * Moves a block to another layer: the one handler the visibility control, an approved agent request
 * and the `visibility.move` tool all call, after the person approved what `previewMove` showed.
 * Friends ↔ private moves between stores here; a post to or from public is changed in place and
 * finished on the Publish page, which previews that one post. Every move is journalled.
 */
export function setVisibility(id: string, visibility: Visibility, { request, reason }: { request?: string; reason?: string } = {}) {
  // A move to private that sealed its copy before failing: moving it again finishes only what is left.
  const pending = pendingSeals.get(id)
  if (pending && visibility === "private") return serial(() => finishSeal(id, pending))
  const preview = previewMove(id, visibility)
  // The home on this computer publishes only through its own Publish dialog, which the person runs.
  if (preview.via === "publish" && "planPublish" in (getSource() ?? {})) {
    return Promise.reject(new DOMException("Showing a block to everyone, or taking a public one back, goes through Publish: choose Everyone on the block, and approve the plan.", "NotSupportedError"))
  }
  if (preview.needs?.includes("title")) return Promise.reject(new DOMException("Give it a title before it is published.", "DataError"))
  return serial(async () => {
    const held = blockVersion(id)
    if (!held) throw new DOMException("There is no such block", "NotFoundError")
    const { from } = preview
    if (preview.via === "publish") {
      // Public is the PDS's. A post is marked here, then published or taken down on the Publish page.
      if (visibility === "private") throw new DOMException("Move it to friends first; Publish then takes it down.", "NotSupportedError")
      // Every block is a post once it is public: one that is not yet is made one, at the address its
      // home channel gives, and the old copy removed (copy, then remove, as between the other layers).
      if (held.ref.store !== "post") return publishBlock(held, doc(id), { request, reason })
      const file = await live().readBlock(held.ref)
      if (file.version !== held.version) throw new DOMException("The block changed. Review it again before moving it.", "InvalidStateError")
      const ref = { ...held.ref, layer: visibility }
      const marked = { path: file.path, text: setProperty(file.text, "visibility", visibility) }
      const saved = await live().saveBlock(ref, marked, held.version)
      dropBlock(id)
      landBlock(ref, marked, saved.version)
      await live().moves.record({ block: id, from, to: visibility, ...(request ? { request } : {}), ...(reason ? { reason } : {}) })
      set(bump())
      return { id, visibility, cleanupPending: false, publish: live().moves.publishPage(id) }
    }
    // Not public: that went to Publish above.
    const target: MoveTarget = visibility === "private" ? { layer: "private", opaqueId: newOpaqueId() } : { layer: "friends" }
    const moved = await live().moveVisibility(held.ref, target, held.version)
    const file = await live().readBlock(moved.ref)
    if (target.layer === "private") {
      // Sealed: from here on, a retry finishes this move rather than sealing another copy.
      const seal: PendingSeal = {
        from: held.ref, version: held.version, sealed: moved.ref, removed: !moved.cleanupPending, journalled: null,
        record: { block: id, from, to: "private", sealedAs: moved.ref.id, moveId: newMoveId(), ...(request ? { request } : {}), ...(reason ? { reason } : {}) },
      }
      pendingSeals.set(id, seal)
      // A friends copy that could not be removed stays in the tree, where moving it again removes it.
      if (seal.removed) dropBlock(id)
      landBlock(moved.ref, { path: file.path, text: file.text }, file.version)
      return finishSeal(id, seal, { remove: false })
    }
    if (moved.ref.id !== id || held.ref.layer !== moved.ref.layer) dropBlock(id)
    landBlock(moved.ref, { path: file.path, text: file.text }, file.version)
    await live().moves.record({
      block: id, from, to: visibility, ...(visibility === "private" ? { sealedAs: moved.ref.id } : {}),
      ...(moved.cleanupPending ? { cleanupPending: true } : {}), ...(request ? { request } : {}), ...(reason ? { reason } : {}),
    })
    set(bump())
    return { id: moved.ref.id, visibility, cleanupPending: moved.cleanupPending }
  })
}

/**
 * A move to private that sealed its copy but did not finish: the friends copy is still to be removed
 * (cleanup pending), or the move is still to be journalled. Keyed by the block's ID before the move.
 * Moving the block to private again runs `finishSeal`, which does only what is left, so a retry never
 * seals a second private copy, and the journal hears of the move once (by its `moveId`).
 *
 * Remembered here rather than worked out from the opaque ID: an opaque ID derived from the vault ID
 * would let the service tie a sealed block to the block it came from, which is what an opaque ID is
 * for not doing. Nor is a sealed copy with the same vault ID proof of an unfinished move: sharing a
 * block keeps its private copy, an older one. It lasts while the home is open; after a reload, a
 * friends copy left behind is moved like any other block.
 */
type PendingSeal = {
  from: BlockRef; version: string; sealed: BlockRef; removed: boolean
  /** What the journal has been told: nothing yet, the move with its old copy left, or the move done. */
  journalled: null | "cleanup-pending" | "done"
  record: MoveRecord & { moveId: string }
}
const pendingSeals = new Map<string, PendingSeal>()
const newMoveId = () => `m${crypto.randomUUID().replaceAll("-", "")}`
/** Removes the friends copy if it is still there (unless `remove` is false), then journals what is new. Runs inside `serial`. */
async function finishSeal(id: string, seal: PendingSeal, { remove = true } = {}): Promise<{ id: string; visibility: Visibility; cleanupPending: boolean; publish?: string }> {
  if (remove && !seal.removed) {
    try {
      await live().deleteBlock(seal.from, seal.version)
      seal.removed = true
      dropBlock(id)
    } catch { /* still there: the move stays cleanup-pending, and moving it again tries once more */ }
  }
  if (seal.journalled === null) {
    await live().moves.record({ ...seal.record, ...(seal.removed ? {} : { cleanupPending: true }) })
    seal.journalled = seal.removed ? "done" : "cleanup-pending"
  } else if (seal.journalled === "cleanup-pending" && seal.removed) {
    // The old copy is gone now: a second line says the move is done. The request was answered by the first.
    const { request: _answered, reason: _given, ...move } = seal.record
    await live().moves.record({ ...move, moveId: `${seal.record.moveId}-done` })
    seal.journalled = "done"
  }
  if (seal.journalled === "done") pendingSeals.delete(id)
  set(bump())
  return { id: seal.sealed.id, visibility: "private", cleanupPending: !seal.removed }
}

const doc = (id: string) => { const found = byId(id); if (!isBlock(found)) throw new DOMException("Only blocks have visibility", "DataError"); return found }
/** A friends-only or private block made a post marked public, ready for the Publish page. Runs inside `serial`. */
async function publishBlock(held: { ref: BlockRef; version: string }, block: Doc, { request, reason }: { request?: string; reason?: string }) {
  const file = await live().readBlock(held.ref)
  if (file.version !== held.version) throw new DOMException("The block changed. Review it again before moving it.", "InvalidStateError")
  const node = readNode(file.path, file.text)?.node
  const vaultId = held.ref.store === "sealed" ? block.vaultId ?? node?.id : held.ref.id
  if (!vaultId) throw new DOMException("Only a block with a vault ID can be published.", "DataError")
  let post
  try { post = blockAsPost(node, { id: vaultId, slugOf }) } catch (err) { throw new DOMException((err as Error).message, "DataError") }
  const ref: BlockRef = { id: vaultId, layer: "public", store: "post" }
  const made = postFile(post)
  const saved = await live().saveBlock(ref, made, null)
  // Separate stores have no joint transaction: a failed removal leaves both copies, and says so.
  let cleanupPending = false
  try { await live().deleteBlock(held.ref, held.version) } catch { cleanupPending = true }
  if (!cleanupPending) dropBlock(block.id)
  landBlock(ref, made, saved.version)
  await live().moves.record({ block: held.ref.id, from: block.visibility, to: "public", ...(cleanupPending ? { cleanupPending: true } : {}), ...(request ? { request } : {}), ...(reason ? { reason } : {}) })
  set(bump())
  return { id: vaultId, visibility: "public" as const, cleanupPending, publish: live().moves.publishPage(vaultId) }
}

// Agents' requests for moves they may not finish, waiting for the member.
let moveRequests: MoveRequest[] = []
/** When the home opens: what agents asked for, and sealing what they hid. Neither keeps the home from opening. */
async function movesOnOpen() {
  moveRequests = []
  pendingSeals.clear()
  try {
    await loadMoveRequests()
    await sealHidden()
  } catch (problem) {
    failureListeners.forEach(listener => listener(problem as Error))
  }
}
export const waitingRequests = () => moveRequests
/** Reads the requests waiting for the member. */
export async function loadMoveRequests() {
  moveRequests = await live().moves.requests()
  set(bump())
  return moveRequests
}
/** Approves an agent's request: the same move, by the same handler, recorded as answering it. Consequential: the person approves first. */
export async function approveMoveRequest(requestId: string) {
  const request = moveRequests.find(each => each.id === requestId)
  if (!request) throw new DOMException("That request is no longer waiting", "NotFoundError")
  // Approved before, but the move did not finish: finish it, without checking a copy that may be gone.
  if (request.to === "private" && pendingSeals.has(request.block)) {
    const moved = await setVisibility(request.block, request.to, { request: request.id })
    await loadMoveRequests()
    return moved
  }
  const held = blockVersion(request.block)
  if (!held) throw new DOMException("The block it asks about is not here, or is locked on this device", "NotFoundError")
  // Pinned to what the agent read: a block changed since then is reviewed again.
  if (request.version && held.ref.store !== "sealed" && request.version !== held.version) {
    throw new DOMException("The block changed since the agent asked. Review it again, and move it yourself if you still want to.", "InvalidStateError")
  }
  const moved = await setVisibility(request.block, request.to, { request: request.id })
  await loadMoveRequests()
  return moved
}
export async function declineMoveRequest(requestId: string, reason?: string) {
  await live().moves.decline(requestId, reason)
  await loadMoveRequests()
  return { id: requestId, declined: true }
}
/**
 * Seals what an agent hid on its way to private: friends stopped reading it when it was hidden,
 * and this device, with the private layer open, finishes the move. Runs when the home opens.
 */
export async function sealHidden() {
  if (privateLayer !== "open") return []
  const heads = await live().listBlocks(["public", "friends"])
  const sealed: string[] = []
  for (const head of heads.filter(each => each.leaving && each.layer === "friends")) {
    if (!byId(head.id)) continue
    await setVisibility(head.id, "private")
    sealed.push(head.id)
  }
  return sealed
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
  if (mode === "edit") live()
  marks.unread.delete(id)
  set({ view: { kind: "doc", id, mode }, searchOpen: false, ...sideAfterOpen() })
  return { id, title: doc.title, view: mode, next: mode === "edit" ? "workspace.save-draft" : "workspace.open" }
}

/** The graph lives in the side panel, in the home. */
export const setGraphCortex = (graphCortex: boolean) => set({ graphCortex })
export function showGraph(center?: string) {
  const g = buildGraph({ center, audience: state.audience, vault: state.scope.vault, cortex: state.graphCortex, keep: kept })
  set({ side: "repo", repoMode: "graph", graphCenter: g.center.handle, searchOpen: false })
  return { center: g.center.handle, nodes: g.nodes.length, edges: g.edges.length }
}

const usedSlugs = new Set<string>()
/** A slug no other block has, from a title. */
function freeSlug(title: string, fallback = "untitled") {
  const stem = slugify(title) || fallback
  let slug = stem
  for (let suffix = 2; usedSlugs.has(slug); suffix++) {
    slug = `${stem.slice(0, 59 - String(suffix).length)}-${suffix}`
  }
  return slug
}
export async function createDraft(input: { homeChannel?: string; channels?: string[]; title?: string } = {}) {
  const homeChannel = input.homeChannel?.trim() || "other"
  validateChannel(homeChannel)
  const title = input.title?.trim() ?? ""
  const slug = freeSlug(title)
  // Everything about the new block is set here, before the one change that records it.
  // A new block is private: sealed on this device under an opaque ID, carrying its own vault ID.
  const doc: Doc = {
    id: newOpaqueId(), vaultId: newNodeId(), kind: "text", slug, title, homeChannel,
    ...(input.channels?.length ? { channels: [...input.channels] } : {}), visibility: "private",
    updated: today(), body: "",
  }
  usedSlugs.add(slug)
  try { await serial(() => persist(doc)) } catch (problem) { usedSlugs.delete(slug); throw problem }
  set({ view: { kind: "doc", id: doc.id, mode: "edit" }, ...bump(), searchOpen: false, ...sideAfterOpen() })
  return { id: doc.id, slug, view: "edit", next: "workspace.save-draft" }
}

/** Saves the open block as private. Never publishes. */
export async function saveDraft(input: { title?: string; body?: string }) {
  const v = state.view
  if (v.kind !== "doc") throw new DOMException("No block is open in the editor", "InvalidStateError")
  const open = byId(v.id)
  if (!isBlock(open)) throw new DOMException("Only blocks are edited here", "DataError")
  // Changing a block other people can see needs the person's approval (AGENTS.md rule 11): its own flow.
  if (open.visibility !== "private") throw new DOMException("This block is not private; changing it needs approval", "NotAllowedError")
  // The editor keeps the block open; saving changes nothing about what is on screen.
  const saved = await update(v.id, doc => {
    if (input.title !== undefined) doc.title = input.title.trim()
    if (input.body !== undefined) updateBody(doc, input.body)
    doc.updated = today()
    return { id: doc.id, slug: doc.slug, visibility: doc.visibility }
  })
  return saved!
}

export const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60)
export { owner as me }

/** A block's icon: an emoji shown above its title. */
export function setIcon(id: string, icon: string | undefined) {
  return update(id, doc => { doc.icon = icon; return true })
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
 * media cache and sent to the home's media store, its block private. An image the vault already
 * holds is not copied: its media block is collected into the channel, as Are.na connects a block.
 * Returns the media block's id and slug, for an embed (`![[slug]]`). The editor's drop, paste and
 * picker, and the `workspace.add-image` tool, call this. Adding the same image twice is one block.
 */
export async function addImage(input: { name: string; type: string; bytes: Uint8Array; channel: string; alt?: string }) {
  const ending = IMAGE_TYPES[input.type]
  if (!ending) throw new DOMException(`An image is one of: ${Object.keys(IMAGE_TYPES).join(", ")}`, "DataError")
  if (!input.bytes.length || input.bytes.length > MAX_IMAGE_BYTES) throw new DOMException("An image is up to 20 MB", "DataError")
  validateChannel(input.channel)
  const source = live()
  const hash = await keep(input.bytes, input.type)
  const held = blocks.find(doc => doc.media?.hash === hash)
  if (held) {
    if (isBlock(held) && !channelsOf(held).includes(input.channel)) await collect(held.id, input.channel)
    return { id: held.id, slug: held.slug, created: false }
  }
  // The bytes first: a block is never saved pointing at bytes the home does not have.
  await source.media.put(input.bytes.slice() as Uint8Array<ArrayBuffer>, input.type)
  const stem = input.name.replace(/\.[^.]+$/, "").trim() || "image"
  const slug = freeSlug(stem, "image")
  // The file sits beside its block in the home folder, so its name is free in that channel.
  const taken = new Set(blocks.filter(doc => isBlock(doc) && doc.homeChannel === input.channel).map(doc => mediaFile(doc)))
  let file = `${slug}.${ending}`
  for (let n = 2; taken.has(file); n++) file = `${slug}-${n}.${ending}`
  const size = await measure(input.bytes, input.type)
  const alt = input.alt?.trim() || stem
  const doc: Doc = {
    id: newOpaqueId(), vaultId: newNodeId(), kind: "media", slug, title: stem, homeChannel: input.channel, visibility: "private",
    updated: today(), body: `![[${file}]]`,
    media: { hash, mime: input.type, ...size, alt },
  }
  usedSlugs.add(slug)
  try { await serial(() => persist(doc)) } catch (problem) { usedSlugs.delete(slug); throw problem }
  set(bump())
  void makeSizes(hash, input.bytes, input.type)
  return { id: doc.id, slug, created: true }
}

/** Saves as you type, for private blocks only. */
export function autosave(id: string, patch: { title?: string; body?: string }) {
  return update(id, doc => {
    if (!isBlock(doc) || doc.visibility !== "private") return undefined
    if (patch.title !== undefined) doc.title = patch.title
    if (patch.body !== undefined) updateBody(doc, patch.body)
    doc.updated = today()
    return true
  })
}

/**
 * Collects a block into a channel, keeping every channel it is already in: a block can be in any
 * number of them. Its home channel changes when you move the home row.
 */
export async function collect(id: string, path: string) {
  if (!isBlock(byId(id))) throw new DOMException("Only blocks can be collected into channels", "DataError")
  validateChannel(path)
  const added = await update(id, doc => {
    if (!isBlock(doc) || doc.homeChannel === path || doc.channels?.includes(path)) return undefined
    doc.channels = [...(doc.channels ?? []), path]
    return true
  })
  return { added: !!added }
}

/** Moves or adds a block's placement and updates the destination's order. */
export async function moveBlock(id: string, from: string, to: string, opts: { before?: string; after?: string; keep?: boolean } = {}) {
  if (!isBlock(byId(id))) throw new DOMException("Only blocks move between channels", "DataError")
  validateChannel(to)
  let homeChannelChanged = false, visibility: Visibility = "private"
  if (from !== to) {
    await update(id, doc => {
      if (!isBlock(doc)) return undefined
      visibility = doc.visibility
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
      return true
    })
  }
  let ordered = false
  // A channel's order names its blocks by slug in its own _channel.md, which the service keeps
  // readable. So it lists only readable blocks: a private block's slug never goes there, and a
  // private block's place in an order waits for the sealed private overlay.
  if ((opts.before || opts.after) && byId(id)?.visibility !== "private") {
    await serial(async () => {
      const readable = blocks.filter(post => post.visibility !== "private" && channelsOf(post).includes(to))
      const list = inOrder(to, readable).map(post => post.id).filter(x => x !== id)
      const index = opts.before ? list.indexOf(opts.before) : opts.after ? list.indexOf(opts.after) + 1 : -1
      list.splice(index < 0 ? list.length : index, 0, id)
      await saveChannelProperty(to, "order", list.map(each => byId(each)?.slug).filter(Boolean))
      ordered = true
      set(bump())
    })
  }
  return { homeChannelChanged, ordered, published: homeChannelChanged && visibility !== "private" }
}

/**
 * Refiles every sealed block in `from` (and, with `descendants`, in the channels inside it) to `to`.
 * The service moves the readable blocks itself; sealed ones are refiled on this device.
 */
async function refileSealed(from: string, to: string, descendants: boolean) {
  for (const doc of blocks) {
    if (!isBlock(doc) || doc.visibility !== "private") continue
    const home = replacePath(doc.homeChannel, from, to, descendants)
    const channels = doc.channels?.map(path => replacePath(path, from, to, descendants))
    if (home === doc.homeChannel && !channels?.some((path, index) => path !== doc.channels?.[index])) continue
    await persist({ ...structuredClone(doc), homeChannel: home, channels })
  }
}

/**
 * Changing a channel's path or removing it reaches sealed blocks only on a device that can open
 * them; the service moves only what it can read. Locked, it would leave private blocks filed
 * under a channel that is gone, so it is refused.
 */
function needsPrivateLayer(what: string) {
  if (privateLayer !== "open") throw new DOMException(`${what} needs your private blocks: unlock them on this device first.`, "InvalidStateError")
}

/** Moves a channel with everything in it, at the service, then the sealed blocks here, then reads the home again. */
function relocateChannel(from: string, to: string) {
  needsPrivateLayer("Moving a channel")
  return serial(async () => {
    try {
      const moved = await live().channels.move(from, to, heldChannel(from)?.version ?? null)
      if (!moved.everything) await refileSealed(from, to, true)
      return moved
    } finally {
      // Whatever happened, show the home as the service now holds it.
      await setSource(live(), { keepView: true })
    }
  })
}

/**
 * Moves a channel into another, or to the top with `into` null: what dragging a channel's row does.
 * Every block in it goes along, and keeps its order. A channel inside a channel holds no channels of
 * its own yet, so a channel that holds some cannot go inside another.
 */
export async function moveChannel(path: string, into: string | null) {
  const name = path.split("/").at(-1)!
  const next = into ? `${into}/${name}` : name
  validateChannel(next)
  if (into && into.includes("/")) throw new DOMException("A channel inside a channel can't hold channels yet", "DataError")
  if (into && (into === path || into.startsWith(`${path}/`))) throw new DOMException("A channel can't go inside itself", "DataError")
  if (into && channelRecords.some(c => c.path.startsWith(`${path}/`))) throw new DOMException(`“${name}” holds channels of its own, so it can't go inside another yet`, "DataError")
  if (next === path) return { path, moved: 0 }
  if (channelByPath(next)) throw new DOMException(`There is already a channel “${next.replace("/", " › ")}”`, "DataError")
  const moved = await relocateChannel(path, next)
  return { path: next, moved: moved.blocks }
}

/**
 * Makes a channel: at the top, or inside a top-level channel. It is empty until something is moved or
 * added into it, and stays when it is emptied again. Returns its path.
 */
export async function createChannel(inside?: string) {
  if (inside?.includes("/")) throw new DOMException("A channel inside a channel can't hold channels yet", "DataError")
  let n = 1, path = inside ? `${inside}/untitled` : "untitled"
  while (channelRecords.some(channel => channel.path === path)) path = `${inside ? `${inside}/` : ""}untitled-${++n}`
  await serial(async () => {
    const text = writeNoteFile({ properties: { id: newNodeId(), created: today() } })
    const { version } = await live().channels.save({ path, text }, null)
    landChannel(path, text, version)
    set(bump())
  })
  return path
}

/** Removes an empty channel. One with blocks or channels in it is refused: move them out first. */
export async function deleteChannel(path: string) {
  needsPrivateLayer("Removing a channel")
  if (blocks.some(p => channelsOf(p).some(c => c === path || c.startsWith(`${path}/`))) || channelRecords.some(c => c.path.startsWith(`${path}/`)))
    throw new DOMException(`“${path.replace("/", " › ")}” is not empty: move what is in it out first`, "DataError")
  await serial(async () => {
    const held = heldChannel(path)
    // A folder with no _channel.md of its own is gone once it is empty.
    if (held) await live().channels.remove(path, held.version)
    dropChannel(path)
    set(bump())
  })
}

/** Takes a block out of a channel. Use moveBlock to change its home channel. */
export async function uncollect(id: string, path: string) {
  const removed = await update(id, doc => {
    if (!doc.channels?.includes(path)) return undefined
    doc.channels = doc.channels.filter(c => c !== path)
    return true
  })
  return { removed: !!removed }
}

/**
 * Connects one block to another as a whole, with an optional line on why. Yours to make: it is
 * evidence, so no agent tool does it. Like the text, it changes only a private block here; a block
 * other people see is changed through the steps that ask first.
 */
export async function connectDocs(id: string, toId: string, why?: string) {
  const open = byId(id), target = byId(toId)
  if (!isBlock(open) || !isBlock(target)) throw new DOMException("Only blocks connect to blocks", "DataError")
  if (open.id === target.id) throw new DOMException("A block does not connect to itself", "DataError")
  if (open.visibility !== "private") throw new DOMException("Connecting changes what others see; it asks first, which is not built yet", "NotAllowedError")
  const added = await update(id, doc => {
    if (doc.connect?.some(c => c.to === target.slug)) return undefined
    doc.connect = [...(doc.connect ?? []), { to: target.slug, ...(why?.trim() ? { why: why.trim() } : {}) }]
    doc.updated = today()
    return true
  })
  return { added: !!added }
}

/** Says why a connection is there, or clears it. */
export function setWhy(id: string, toSlug: string, why: string) {
  return update(id, doc => {
    const c = doc.connect?.find(c => c.to === toSlug)
    if (!c || doc.visibility !== "private") return undefined
    if (why.trim()) c.why = why.trim(); else delete c.why
    return true
  })
}

/** Takes a whole-block connection away. A link in the text is removed by editing the text. */
export function disconnect(id: string, toSlug: string) {
  return update(id, doc => {
    if (!doc.connect || doc.visibility !== "private") return undefined
    doc.connect = doc.connect.filter(c => c.to !== toSlug)
    return true
  })
}

// ─── The cortex: what the person changes in it (cortex/docs/model.md, "Who may change what") ───

const cortexDoc = (id: string) => {
  const doc = byId(id)
  if (!doc || isBlock(doc) || !isCortexKind(doc.kind)) throw new DOMException("There is no such part of your cortex.", "NotFoundError")
  return doc
}

/** The person edits the text of a cortex part: the profile, an observation, a skill or a tool. Saved as they type. */
export function editCortex(id: string, body: string) {
  cortexDoc(id)
  return update(id, doc => {
    if (doc.body === body) return undefined
    doc.body = body
    doc.updated = today()
    return true
  })
}

const OBSERVATION_LIMIT = 2000
/**
 * Writes an observation: the person's own, or an agent's in the page once the person approved it
 * (the cortex.observe tool; `why` is its reason, journaled with it). `about` is what it is about:
 * block IDs, or channels as channel:<path>. Returns its id and title.
 */
export async function writeObservation(input: { text: string; about?: string[] }, why?: string) {
  const text = input.text.trim()
  if (!text || [...text].length > OBSERVATION_LIMIT) throw new DOMException(`An observation is what was seen, at most ${OBSERVATION_LIMIT} characters`, "DataError")
  const about = [...new Set(input.about ?? [])]
  if (about.length > 20 || about.some(item => item.startsWith("channel:") ? !channelRecords.some(c => `channel:${c.path}` === item) && !blocks.some(b => channelsOf(b).includes(item.slice(8))) : !isBlock(byId(item)))) {
    throw new DOMException("about is up to 20 blocks in this home, by id, or channels as channel:<path>", "DataError")
  }
  const who = journalOf().actor()
  const doc: Doc = {
    id: newOpaqueId(), kind: "observation", title: text.split("\n")[0].slice(0, 80), slug: `observation-${newNodeId()}`, body: text,
    visibility: "private", updated: today(), by: who.kind === "agent" ? who.name : "you", ...(about.length ? { about } : {}),
  }
  usedSlugs.add(doc.slug)
  try { await serial(() => persist(doc, undefined, why)) } catch (problem) { usedSlugs.delete(doc.slug); throw problem }
  set(bump())
  const made = byId(doc.id) ?? doc
  return { id: made.id, title: made.title, about }
}

/** Pins an observation, so every agent session is handed it, or unpins it. Only the person does this. */
export function pinObservation(id: string, pin: boolean) {
  if (cortexDoc(id).kind !== "observation") return Promise.reject(new DOMException("Only an observation is pinned", "DataError"))
  return update(id, doc => {
    if (!!doc.pin === pin) return undefined
    if (pin) doc.pin = true; else delete doc.pin
    return true
  })
}

/** Switches a tool on, so agents may use it, or off. Only the person does this. */
export function switchTool(id: string, on: boolean) {
  if (cortexDoc(id).kind !== "tool") return Promise.reject(new DOMException("Only a tool is switched on or off", "DataError"))
  return update(id, doc => {
    if (!!doc.on === on) return undefined
    doc.on = on
    return true
  })
}

/** Forgets an observation, or removes a skill. The cortex keeps it, so it can be restored. */
export function forgetCortex(id: string) {
  const kind = cortexDoc(id).kind
  if (kind !== "observation" && kind !== "skill") return Promise.reject(new DOMException("Only an observation or a skill is removed", "DataError"))
  return serial(async () => {
    const held = heldCortex(id)
    if (held) await live().cortex.remove(id, held.version)
    dropCortex(id)
    journalOf().syncJournal()
    for (const s of Object.values(marks)) s.delete(id)
    const wasOpen = state.view.kind === "doc" && state.view.id === id
    set({ ...bump(), history: state.history.filter(h => h !== id), ...(wasOpen ? { view: { kind: "empty" } as View } : {}) })
  })
}

/** What agents proposed and asked for, waiting for the person: kept by the home on this computer. */
const NOTHING_WAITING: CortexWaiting = { profile: [], skills: [], tools: [] }
type Proposals = { cortexWaiting(): CortexWaiting; answerCortex(kind: "profile" | "skill", id: string, yes: boolean): Promise<void> }
const proposals = () => { const source = getSource(); return source && "answerCortex" in source ? source as unknown as Proposals : null }
export const cortexWaiting = () => proposals()?.cortexWaiting() ?? NOTHING_WAITING

/** The person's answer: a profile line accepted or declined, a skill approved or declined. The home is read again after. */
export async function answerCortex(kind: "profile" | "skill", id: string, yes: boolean) {
  const held = proposals()
  if (!held) throw new DOMException("Proposals are answered in your home on this computer.", "NotSupportedError")
  await serial(() => held.answerCortex(kind, id, yes))
  await setSource(live(), { keepView: true })
}

/** Opens a Markdown or text file as a new private block. */
export async function openFile(name: string, text: string) {
  const title = name.replace(/\.(md|markdown|txt)$/i, "")
  const draft = await createDraft({ title })
  await autosave(draft.id, { body: text })
  return draft
}

// ─── Row actions: the ⋯ menu on a block in the home ──────────────────────

/** Pinned blocks show on top of the home; unread ones show in weight until opened; archived ones leave the tree. */
export const marks = { pinned: new Set<string>(), unread: new Set<string>(), archived: new Set<string>() }
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
  return update(id, doc => {
    doc.title = title.trim()
    doc.updated = today()
    return true
  })
}

/** Removes a block from the vault. Taking a published one down from the home is its own step. */
export async function deleteDoc(id: string) {
  const removed = await serial(async () => {
    const held = blockVersion(id)
    if (!held) return false
    await live().deleteBlock(held.ref, held.version)
    dropBlock(id)
    journalOf().syncJournal()
    return true
  })
  if (!removed) return
  bodyReplacements.delete(id)
  for (const s of Object.values(marks)) s.delete(id)
  const wasOpen = state.view.kind === "doc" && state.view.id === id
  // Take it out of history; the position moves back one if it was at or before where we are.
  const idx = state.history.indexOf(id)
  const history = state.history.filter(h => h !== id)
  const at = idx >= 0 && idx <= state.at ? state.at - 1 : state.at
  set({ ...bump(), history, at, ...(state.reveal?.target === id ? { reveal: null } : {}) })
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
export async function renameChannel(path: string, name: string) {
  const next = name.trim().toLowerCase().replace(/\s+/g, "-")
  const to = [...path.split("/").slice(0, -1), next].join("/")
  validateChannel(to)
  if (to === path) return { moved: 0 }
  if (channelRecords.some(channel => channel.path === to)) throw new DOMException(`There is already a channel “${to.replace("/", " › ")}”`, "DataError")
  const moved = await relocateChannel(path, to)
  return { moved: moved.blocks }
}

function validateChannel(path: string) {
  if (!isChannelPath(path) || path.length > 120 || path.split("/").length > 2) {
    throw new DOMException("Choose a channel path with one or two levels.", "DataError")
  }
}

const replacePath = (value: string, from: string, to: string, descendants: boolean) =>
  value === from || (descendants && value.startsWith(`${from}/`)) ? to + value.slice(from.length) : value

// ─── History: restore, revert, save, sessions (flows/history.md) ─────────────────────────────

const bodyReplacements = new Map<string, number>()
let replacementSequence = 0
let sourceRevision = 0
export const bodyRevision = (doc: Doc) => bodyReplacements.get(doc.id) ?? sourceRevision

function markRestored(doc: Doc) {
  bodyReplacements.set(doc.id, ++replacementSequence)
  set({ ...bump(), restored: { id: doc.id, n: bodyRevision(doc) } })
}

/**
 * Brings a private block back to an earlier version. History is never rewritten: the restore is a
 * new change, by whoever restored it, so it can itself be undone the same way. A block other people
 * see changes only through the steps that ask first, so it is refused here.
 */
export async function restoreVersion(id: string, version: string, reason?: string) {
  const open = byId(id)
  if (!open) throw new DOMException("There is no such block", "NotFoundError")
  if (open.visibility !== "private") throw new DOMException("Restoring changes what others see; it asks first, which is not built yet", "NotAllowedError")
  const source = live()
  const held = blockVersion(id)
  // A kept version at the service first; a version this device saw in the journal otherwise.
  const kept = held ? (await source.history(held.ref)).find(entry => entry.version === version) : undefined
  const snapshot: Snapshot | undefined = kept && held
    ? snap(docOf(held.ref, { ...await source.readVersion(held.ref, kept.rev) }).doc)
    : journalOf().snapshotAt(version) || undefined
  if (!snapshot) throw new DOMException("There is no such version", "NotFoundError")
  const by = journalOf().actor().name
  await update(id, doc => {
    applySnapshot(doc, snapshot)
    doc.updated = today()
    return true
  }, { op: "restore", reason: reason?.trim() || `Restored version ${version}` })
  markRestored(byId(id)!)
  return { id, version, by }
}

/**
 * Undoes one change, as `git revert` does: only the parts of the block that change touched go back,
 * and later changes to other parts stay. If a later change touched the same part, it is refused, and
 * restoring a whole version is the way. Like a restore, it is a new change, so it can be undone too.
 */
export async function revertChange(lineId: string) {
  const { changeById, snapshotAt } = journalOf()
  const line = changeById(lineId)
  if (!line) throw new DOMException("There is no such change", "NotFoundError")
  const doc = draftOf(line.node)
  if (!doc) throw new DOMException("That block is gone and cannot be reverted", "NotFoundError")
  if (doc.visibility !== "private") throw new DOMException("Reverting changes what others see; it asks first, which is not built yet", "NotAllowedError")
  if (!line.before || line.op === "create") throw new DOMException("This change created the block. Delete the block to undo it.", "DataError")
  const before = snapshotAt(line.before), after = snapshotAt(line.after), now = snap(doc)
  if (!before || !after) throw new DOMException("This device doesn't hold that change's versions: restore a kept version instead", "NotFoundError")
  const fields = line.fields as (keyof Snapshot)[]
  if (!fields.length) throw new DOMException("This change changed nothing to revert", "DataError")
  const later = fields.filter(f => JSON.stringify(now[f]) !== JSON.stringify(after[f]))
  const named = [...new Set(later.map(f => ({ body: "text", homeChannel: "home channel", connect: "connections" } as Record<string, string>)[f] ?? f))]
  if (later.length) throw new DOMException(`A later change also touched its ${named.join(" and ")}: restore a whole version instead`, "DataError")
  await update(doc.id, next => {
    applySnapshot(next, { ...snap(next), ...Object.fromEntries(fields.map(f => [f, before[f]])) } as Snapshot)
    next.updated = today()
    return true
  }, { op: "revert", reason: `Reverted “${line.summary}” (${new Date(line.at).toLocaleDateString(undefined, { month: "short", day: "numeric" })})` })
  markRestored(byId(doc.id)!)
  return { id: doc.id, reverted: line.id, fields }
}

/** Opens the open block's history card on one change. */
export const focusHistory = (id: string, line: string) => set({ historyFocus: { id, line, n: (state.historyFocus?.n ?? 0) + 1 } })

/** Names the home as it is now, so you or an agent can come back to it. It changes nothing. */
export function saveNow(name: string, note?: string) {
  if (!name.trim()) throw new DOMException("A save needs a name", "DataError")
  live()
  const line = journalOf().save(name, note)
  set(bump())
  return { name: line.name, seq: line.seq }
}

/** An agent finishing a task: what it did, and the dead ends a later agent should not retry. */
export function finishSession(done: string, deadEnds: DeadEnd[] = []) {
  const who = journalOf().actor()
  if (who.kind !== "agent") throw new DOMException("Sessions are written by agents, when they finish a task", "NotAllowedError")
  if (!done.trim()) throw new DOMException("Say in one line what was done", "DataError")
  const line = journalOf().recordSession(who, done, deadEnds)
  set(bump())
  return { session: line.id, changes: line.changes.length, deadEnds: line.deadEnds.length }
}
