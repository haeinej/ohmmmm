import { evidence, nodeFile, readNode, readVault } from "../../../vault/vault/node.mjs"
import { isPostId, setProperty } from "../../../vault/vault/file.mjs"
import type { SearchInput, SearchProvider } from "./search"
import type { ChannelRecord } from "./workspace-model"

export type Layer = "public" | "friends" | "private"
export type BlockRef = { id: string; layer: Layer; store: "post" | "block" | "sealed" }
export type BlockHead = BlockRef & { path?: string; title?: string; version?: string }
export type HomeFile = { path: string; text: string }
export type BlockFile = HomeFile & { version: string }
export type Account = { did: string | null; user: { name: string }; mirrored: boolean; service: string | null }
export type Friend = { did: string; added: string }
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
export type MoveTarget = { layer: "friends" } | { layer: "private"; opaqueId: string }
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
  /** Channel records are editable in the sample workspace. The service has no channel write API. */
  saveChannels?(channels: readonly ChannelRecord[]): Result<Mode, void>
  /** Changes the sample's visibility marker for previewing the audiences. */
  /** `why`: the reason an agent gave, when the move was its request (the person approved it). */
  markVisibility?(ref: BlockRef, layer: Layer, replaces: string, why?: string): Result<Mode, void>
  search: SearchProvider
  history(ref: BlockRef): Result<Mode, HistoryVersion[]>
  readVersion(ref: BlockRef, rev: HistoryVersion["rev"]): Result<Mode, HomeFile>
  visibilityMove(ref: BlockRef, to: Layer): VisibilityMove
  moveVisibility(ref: BlockRef, to: MoveTarget, version: string): Promise<MoveResult>
  listFriends(): Promise<Friend[]>
  removeFriend(did: string): Promise<void>
  listShared(owner: string): Promise<BlockHead[]>
  readShared(owner: string, id: string): Promise<BlockFile>
  publishPlan(prepare?: boolean): Promise<PublishPlan>
}

type Result<Mode, Value> = Mode extends "sync" ? Value : Promise<Value>

export const emptyPlan = (): PublishPlan => ({
  changes: 0, create: [], replace: [], remove: [], unchanged: [], cannot: [], notInVault: [],
})

/** Explicitly describe the move so the UI can ask before calling any write. */
export function visibilityMove(ref: BlockRef, to: Layer): VisibilityMove {
  if (ref.layer === to || ref.layer === "public") {
    throw new DOMException("Choose another layer. A published copy is taken down through publishing.", "NotSupportedError")
  }
  const move = { from: ref.layer, to }
  if (to === "public") return { ...move, action: "publish", warning: "Publishing makes a public copy and keeps the original." }
  if (to === "friends") return { ...move, action: "copy", warning: "The vault service and your friends can read the shared copy." }
  return { ...move, action: "copy-and-remove", warning: "Backups made while the block was shared may still hold a readable copy." }
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
