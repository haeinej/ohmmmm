import { evidence, nodeFile, readNode, readVault } from "../../../vault/vault/node.mjs"
import { isPostId, setProperty } from "../../../vault/vault/file.mjs"
import { planMove } from "../../../vault/vault/visibility.mjs"
import type { SearchInput, SearchProvider } from "./search"

export type Layer = "public" | "friends" | "private"
export type BlockRef = { id: string; layer: Layer; store: "post" | "block" | "sealed" }
/** `leaving`: hidden from friends on its way to private, for this device to seal. */
export type BlockHead = BlockRef & { path?: string; title?: string; version?: string; leaving?: string }
export type HomeFile = { path: string; text: string }
export type BlockFile = HomeFile & { version: string }
export type Account = { did: string | null; user: { name: string }; mirrored: boolean; service: string | null }
export type PublishPlan = {
  changes: number
  create: unknown[]
  replace: unknown[]
  remove: unknown[]
  unchanged: unknown[]
  cannot: unknown[]
  notInVault: unknown[]
  repository?: string
  pds?: string
  collection?: string
  writes?: unknown
  plan?: string
}
export type HistoryVersion = { rev: number | string; version: string; created: string }
export type VisibilityMove = {
  from: Layer
  to: Layer
  action: "publish" | "copy" | "copy-and-remove"
  warning: string
}
export type MoveResult = { ref: BlockRef; version: string; cleanupPending: boolean }
/** An agent's request for a move it may not finish, waiting for the member (vault.listMoveRequests). */
export type MoveRequest = {
  id: string; block: string; store: BlockRef["store"]; from: Layer; to: Layer; version?: string
  askedBy: string; reason?: string; asked: string; state: "waiting" | "approved" | "declined"
}
/** A coding agent that used ohm's tools (vault.listAgents): paused or disconnected only by the member. */
export type AgentAccess = "active" | "paused" | "disconnected"
export type AgentInfo = {
  agent: string; state: AgentAccess; firstSeen: string; lastSeen: string; lastTool?: string; waiting: number
  recent: { at: string; tool: string }[]
}
/** An action an agent's tool waits for the member to approve in ohm (vault.listApprovals). `shown` is its preview. */
export type AgentApproval = {
  id: string; agent: string; tool: string; shown: Record<string, unknown>; state: "waiting" | "approved" | "declined" | "used"; asked: string
}
/** A move the member made, for the journal (vault.recordMove). `moveId` names it, so sending it again journals nothing more. */
export type MoveRecord = { block: string; from: Layer; to: Layer; request?: string; sealedAs?: string; cleanupPending?: boolean; reason?: string; moveId?: string }
export type MoveTarget = { layer: "friends" } | { layer: "private"; opaqueId: string }
/** A channel's `_channel.md` on the vault service, with the version compare-and-set names. */
export type ChannelHead = { path: string; version: string; title?: string; kind?: string }
export type ChannelFile = HomeFile & { version: string }
/** `everything`: the source moved the sealed blocks too (one folder on this computer), so none is refiled on the device. */
export type ChannelMove = { from: string; to: string; channels: number; blocks: number; everything?: boolean }
/** A cortex file, opened on this device: `id` is its opaque storage ID, `path` where the cortex files it. */
export type CortexFile = HomeFile & { id: string; version: string }
export type CortexChange = { id: string; file: HomeFile; replaces: string | null } | { id: string; remove: true; replaces: string }
/** A cortex journal entry, opened on this device: who changed what, and why. */
export type CortexEntry = { seq: number; created: string; entry: Record<string, unknown> }
/** What waits for the member and their curator, counted by the service from the readable layers. */
export type Agenda = { unlabelled: number; mediaWithoutAlt: number; counted: string }
export type MediaWidth = 160 | 480 | 960 | 1600
export type VaultContents = ReturnType<typeof readVault>
export type VaultEvidence = ReturnType<typeof evidence>

/** The member-side data boundary. Calling a mutation presupposes consent in its UI flow. */
export interface HomeSource<Mode extends "async" | "sync" = "async"> {
  account(): Result<Mode, Account>
  listBlocks(layers?: readonly Layer[]): Result<Mode, BlockHead[]>
  readBlock(ref: BlockRef): Result<Mode, BlockFile>
  saveBlock(ref: BlockRef, file: HomeFile, replaces: string | null, change?: { op: "restore" | "revert"; reason: string }): Result<Mode, { version: string }>
  deleteBlock(ref: BlockRef, replaces: string): Result<Mode, void>
  vault(layers?: readonly Layer[]): Result<Mode, VaultContents>
  connections(layers?: readonly Layer[]): Result<Mode, VaultEvidence>
  /** Channels as files (`_channel.md`), each with its own version. Private channels stay sealed in the private layer. */
  channels: {
    list(): Promise<ChannelHead[]>
    read(path: string): Promise<ChannelFile>
    save(file: HomeFile, replaces: string | null): Promise<{ version: string }>
    /** Moves the channel, every channel inside it and every readable block filed in it, all or none. */
    move(from: string, to: string, replaces: string | null): Promise<ChannelMove>
    remove(path: string, replaces: string): Promise<void>
  }
  /** The sealed cortex: opened and sealed on this device, under `ohm-vault/cortex/v1`. */
  cortex: {
    list(): Promise<CortexFile[]>
    read(id: string): Promise<CortexFile>
    save(id: string, file: HomeFile, replaces: string | null, journal?: Record<string, unknown>): Promise<{ version: string }>
    saveMany(changes: readonly CortexChange[], journal?: Record<string, unknown>): Promise<{ id: string; version?: string; removed?: boolean }[]>
    remove(id: string, replaces: string, journal?: Record<string, unknown>): Promise<void>
    history(id: string): Promise<HistoryVersion[]>
    readVersion(id: string, rev: HistoryVersion["rev"]): Promise<HomeFile>
    journal(): Promise<CortexEntry[]>
  }
  /** The media cache: a media block keeps where its file is; only the bytes are sent here. */
  media: {
    has(names: readonly string[]): Promise<string[]>
    /** Sends readable bytes under their content address (sha256-<hex>), which it returns. */
    put(bytes: Uint8Array<ArrayBuffer>, type: string): Promise<{ name: string; size: number }>
    get(name: string): Promise<Blob>
    rendition(name: string, width: MediaWidth): Promise<Blob>
  }
  /** Visibility moves: agents' requests waiting for the member, and the journal of moves. */
  moves: {
    requests(): Promise<MoveRequest[]>
    decline(id: string, reason?: string): Promise<void>
    record(move: MoveRecord): Promise<{ state: string }>
    /** The Publish page, showing one post alone: where a move to or from public is finished. */
    publishPage(postId: string): string
  }
  /** The member's coding agents, and the actions they wait for the member to approve. */
  agents: {
    list(): Promise<AgentInfo[]>
    approvals(): Promise<AgentApproval[]>
    answer(id: string, approve: boolean): Promise<void>
    setState(agent: string, state: AgentAccess): Promise<void>
  }
  agenda(): Promise<Agenda>
  search: SearchProvider
  history(ref: BlockRef): Result<Mode, HistoryVersion[]>
  readVersion(ref: BlockRef, rev: HistoryVersion["rev"]): Result<Mode, HomeFile>
  visibilityMove(ref: BlockRef, to: Layer): VisibilityMove
  moveVisibility(ref: BlockRef, to: MoveTarget, version: string): Promise<MoveResult>
  publishPlan(prepare?: boolean): Promise<PublishPlan>
}

type Result<Mode, Value> = Mode extends "sync" ? Value : Promise<Value>

export const CORTEX_CONTEXT = "ohm-vault/cortex/v1"

/** sha256-<hex>: the content address the media cache names readable bytes by. */
export async function mediaName(bytes: Uint8Array<ArrayBuffer>) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))
  return `sha256-${[...digest].map(byte => byte.toString(16).padStart(2, "0")).join("")}`
}

export const emptyPlan = (): PublishPlan => ({
  changes: 0, create: [], replace: [], remove: [], unchanged: [], cannot: [], notInVault: [],
})

/** Explicitly describe the move so the UI can ask before calling any write. */
/** A move between the friends and private layers, worded by the shared rules (vault/vault/visibility.mjs). */
export function visibilityMove(ref: BlockRef, to: Layer): VisibilityMove {
  if (ref.layer === to || ref.layer === "public") {
    throw new DOMException("Choose another layer. A published copy is taken down through publishing.", "NotSupportedError")
  }
  const plan = planMove({ from: ref.layer, to, title: "checked by the caller" })
  const action = plan.action === "publish" ? "publish" : plan.action === "share" ? "copy" : "copy-and-remove"
  return { from: ref.layer, to, action, warning: plan.warning }
}

/** The caller confirms disclosure or removal before invoking this operation. */
export async function moveVisibility(
  source: Pick<HomeSource, "readBlock" | "saveBlock" | "deleteBlock">,
  from: BlockRef,
  target: MoveTarget,
  version: string,
): Promise<MoveResult> {
  const { layer } = target
  const move = visibilityMove(from, layer)
  const file = await source.readBlock(from)
  if (file.version !== version) throw new DOMException("The block changed. Review it again before moving it.", "InvalidStateError")
  let block = blockOf(file)
  // A Friends file may get its TID from the service envelope. A private storage ID is opaque.
  if (block && !block.id && from.layer === "friends" && isPostId(from.id)) {
    block = blockOf({ ...file, text: setProperty(file.text, "id", from.id) })
  }
  if (!block?.id) throw new DOMException("Only a block with a vault ID can move between layers.", "DataError")
  const next = "post" in block
    ? { ...block, visibility: layer, post: { ...block.post, visibility: layer } }
    : { ...block, visibility: layer, visibilityGiven: true }
  const ref: BlockRef = {
    id: target.layer === "private" ? target.opaqueId : block.id, layer,
    store: layer === "private" ? "sealed" : "post" in next ? "post" : "block",
  }
  const result = { ref, ...await source.saveBlock(ref, nodeFile(next), null) }
  if (move.action === "copy-and-remove") {
    // Separate stores have no joint transaction. A failed deletion leaves both versions intact.
    try { await source.deleteBlock(from, version) }
    catch { return { ...result, cleanupPending: true } }
  }
  return { ...result, cleanupPending: false }
}

export async function loadVault(source: Pick<HomeSource, "listBlocks" | "readBlock">, layers?: readonly Layer[]) {
  const heads = await source.listBlocks(layers)
  return readVault(await Promise.all(heads.map(head => source.readBlock(head))))
}

export const readEvidence = async (source: Pick<HomeSource, "vault">, layers?: readonly Layer[]) => evidence(await source.vault(layers))

export function blockOf(file: HomeFile) {
  const node = readNode(file.path, file.text)?.node
  return node?.type === "block" && "visibility" in node ? node : undefined
}

export const searchInput = ({ query, limit = 20 }: SearchInput) => {
  if (!query || query.length > 200 || !Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new DOMException("Give up to 200 characters of search text and a limit from 1 to 50.", "DataError")
  }
  return { query: query.trim(), limit }
}
