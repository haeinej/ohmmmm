// Your home on this computer, through `ohmmmm serve` (docs/serve.md). The vault's Markdown is read
// once through the bridge into a working copy, which the workspace reads and edits at once, as it
// does the sample; each change is then written back to the home folder in the background, only over
// the version that was read (If-Match), so nothing on disk is written over unseen.
//
// What the workspace writes is merged into the file as it is on disk: only the properties the
// workspace knows are set, and every other property, the order of the properties and the file's name
// stay as they were. Moving a block or a channel to another folder goes through the bridge's rename
// (vault/vault/rename.mjs), which rewrites what used the old path. History starts from the vault's
// own journal. Who sees a block moves between Only you and Friends in its file, once the person has
// approved; an agent's request for a move waits for them (/vault/requests). Public is Publish's: the
// person approves a plan (planPublish), and the bridge writes the post to their PDS with the app
// password kept on this computer, then marks the file (publishBlock; unpublishBlock takes it down).
// What this source cannot do yet is said, and the file left as it is: the cortex.
import { isPostId, readProperties, setProperty, splitFile } from "../../../vault/vault/file.mjs"
import { evidence, newNodeId, nodeFile, readNode, readVault } from "../../../vault/vault/node.mjs"
import { heldNow, original } from "@/media/cache"
import { docOf, fileOf } from "./block-document"
import { bridgeFetch, type Bridge } from "./bridge"
import { createJournal, snap, YOU, type Actor, type PastChange } from "./journal"
import { createSampleSearch } from "./sample-search"
import {
  emptyPlan, visibilityMove, type BlockHead, type BlockRef, type HomeFile, type HomeSource, type Layer, type VaultEvidence,
} from "./source"
import type { ChannelRecord, Doc, Entity, InboxItem } from "./workspace-model"

const visibleLayers: readonly Layer[] = ["public", "friends", "private"]
const stale = () => new DOMException("The block changed. Read it again before saving.", "InvalidStateError")
const missing = () => new DOMException("There is no such block in your home.", "NotFoundError")
const CHANNEL_FILE = "_channel.md"

/** The properties the workspace writes (block-document.ts `fileOf`); every other one is left as it is. */
const MANAGED = ["title", "channels", "updated", "connect", "icon", "connectionNotes", "alt", "hash", "mime", "width", "height"] as const

type Node = { type: string; kind?: string; home?: string; slug?: string; visibility?: string; id?: string; channels?: string[] }
const nodeOf = (path: string, text: string) => readNode(path, text)?.node as Node | undefined
const props = (text: string) => readProperties(splitFile(text).head).properties as Record<string, unknown>
// An empty list or text is no property at all.
const value = (v: unknown) => (v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length) ? undefined : v)
const same = (a: unknown, b: unknown) => JSON.stringify(value(a) ?? null) === JSON.stringify(value(b) ?? null)

/**
 * The file on disk with what the workspace changed: its body, and the properties it manages when they
 * differ. `kind` and `visibility` are written only when the file would not already say them.
 */
export function mergeFile(original: string, path: string, written: string, layer: Layer): string {
  const { body: oldBody } = splitFile(original)
  const head = original.slice(0, original.length - oldBody.length)
  const body = splitFile(written).body
  let text = head + (head.replace(/^﻿/, "") ? body : body.replace(/^\n+/, ""))
  const was = props(original)
  const now = props(written)
  for (const key of MANAGED) if (!same(was[key], now[key])) text = setProperty(text, key, value(now[key]))
  if (now.id !== undefined && was.id === undefined && isPostId(String(now.id))) text = setProperty(text, "id", now.id)
  // Visibility first: on a plain note it alone would make the file read as a post, which `kind` then corrects.
  if (nodeOf(path, text)?.visibility !== layer) text = setProperty(text, "visibility", layer === "private" ? undefined : layer)
  const kind = nodeOf(path, written)?.kind
  if (kind && nodeOf(path, text)?.kind !== kind) text = setProperty(text, "kind", kind)
  return text
}

type Held = { text: string; version: string | null; sent?: string }
/** `onProblem`: what could not be done, for the person. `onChange`: files changed after the bridge answered, for the workspace to read again. */
export type LocalOptions = { onProblem?: (message: string) => void; onChange?: () => void }

const folderOf = (path: string) => path.split("/").slice(0, -1).join("/")
/**
 * The workspace's ID for a block whose file has no `id`: `file-` and a hash of the path it was read at,
 * the same on every load. It has no "/" or ":", which the tree's row IDs use, and is never a TID, so
 * it is never written into the file.
 */
export function fileId(path: string) {
  let a = 0x811c9dc5, b = 0x01000193
  for (let i = 0; i < path.length; i++) {
    a = Math.imul(a ^ path.charCodeAt(i), 0x01000193) >>> 0
    b = Math.imul(b ^ path.charCodeAt(i), 0x5bd1e995) >>> 0
  }
  return `file-${a.toString(36)}${b.toString(36)}`
}
const refOf = (path: string, node: Node): BlockRef => {
  const layer = (node.visibility ?? "private") as Layer
  return { id: node.id ?? fileId(path), layer, store: layer === "private" ? "sealed" : node.kind === "post" ? "post" : "block" }
}
const snapOf = (path: string, text: string) => {
  const node = nodeOf(path, text)
  return node?.type === "block" ? snap(docOf(refOf(path, node), { path, text }).doc) : undefined
}

/** An agent's request to change who sees a block (vault/vault/visibility.mjs). */
export type VisibilityRequest = { id: string; at: string; by: string; path: string; from: Layer; to: Layer; why?: string; status: "waiting" | "approved" | "declined"; note?: string }

/** What publishing a block would do, as the bridge plans it (POST /vault/publish/plan, docs/serve.md). */
export type PublishDraft = {
  path: string; version: string; layer: Layer; update: boolean
  title?: string; slug: string; label: string; sublabel: string; labelSaved: boolean
  address?: string; form?: string; publishedAt?: string
  attachments: { id: string; path: string; mime: string; size: number }[]
  notes: string[]; problems: string[]; needs: { what: "site" | "password"; say: string }[]
  ready: boolean; confirm?: string
}
/** Where a post is filed on the site: a label, and a sublabel inside it. */
export type PostLabel = { label: string; sublabel?: string }

export type JournalEvent = { at: string; op: string; path: string; from?: string; by: string; via?: string; before?: string; hash?: string }
const actorOf = (by: string): Actor => (by === "me" ? YOU : by.startsWith("agent:") ? { kind: "agent", name: by.slice(6) } : { kind: "human", name: "outside ohm" })

/**
 * The vault journal's changes as history lines (`/vault/journal`): each on the block it is now, by
 * its ID, or by following its file's moves to where it is. A change whose version was never kept is
 * left out, since there is nothing to show of it; a move and a removal carry the last version known.
 */
export function pastChanges({ events, texts }: { events: readonly JournalEvent[]; texts: Record<string, string> }, nodeAt: (path: string) => string | undefined): PastChange[] {
  const forward = new Map<string, string>()
  for (const event of events) if (event.op === "moved" && event.from) forward.set(event.from, event.path)
  const nodeFor = (path: string) => {
    let at = path
    for (const seen = new Set([at]); forward.has(at) && !seen.has(forward.get(at)!);) { at = forward.get(at)!; seen.add(at) }
    return nodeAt(at) ?? fileId(at)
  }
  const last = new Map<string, NonNullable<ReturnType<typeof snapOf>>>()
  const out: PastChange[] = []
  for (const event of events) {
    const text = event.hash ? texts[event.hash] : undefined
    const node = (text && nodeOf(event.path, text)?.id) || nodeFor(event.path)
    const known = last.get(node)
    const actor = actorOf(event.by)
    if (event.op === "added" || event.op === "changed") {
      const after = text === undefined ? undefined : snapOf(event.path, text)
      if (!after) continue
      const before = (event.before && texts[event.before] !== undefined ? snapOf(event.path, texts[event.before]) : undefined) ?? known
      if (before && JSON.stringify(before) === JSON.stringify(after)) continue
      out.push({ at: event.at, node, actor, ...(before ? { before } : { op: "create" as const }), after })
      last.set(node, after)
    } else if (event.op === "moved" && known) {
      const after = { ...known, homeChannel: folderOf(event.path) }
      out.push({ at: event.at, node, actor, op: "move", before: known, after })
      last.set(node, after)
    } else if (event.op === "removed" && known) {
      out.push({ at: event.at, node, actor, op: "remove", before: known, after: known })
      last.delete(node)
    }
  }
  return out
}

/** What the person reads when the bridge no longer takes this browser's key. */
export const UNPAIRED = "This browser's key no longer opens your home, so this is the sample. In your home, run ohmmmm pair and open the link it prints."

/** Reads the home through the bridge, and gives the workspace its working copy. */
export async function createLocalSource(bridge: Bridge, { onProblem = () => {}, onChange = () => {} }: LocalOptions = {}) {
  const answer = await bridgeFetch("/vault/files", {}, bridge)
  // A key the bridge does not take (replaced, or the agent key) opens nothing of the person's.
  if (answer.status === 401 || answer.status === 403) throw new DOMException(UNPAIRED, "NotAllowedError")
  if (!answer.ok) throw new DOMException(`Your home did not answer (HTTP ${answer.status}).`, "NetworkError")
  const listed = await answer.json() as { home: string; files: { path: string; text: string; version: string }[] }
  // The vault's own history; without it the workspace still opens, with history from now.
  const journaled = await bridgeFetch("/vault/journal?limit=500", {}, bridge)
    .then(response => (response.ok ? response.json() : undefined)).catch(() => undefined) as { events: JournalEvent[]; texts: Record<string, string> } | undefined
  const files = new Map<string, Held>(listed.files.map(file => [file.path, { text: file.text, version: file.version, sent: file.text }]))

  // Blocks as the workspace knows them. A block with no ID is known by the path it was read at (fileId).
  const pathOf = new Map<string, string>()
  const blocks: Doc[] = []
  for (const [path, held] of files) {
    const node = nodeOf(path, held.text)
    if (node?.type !== "block") continue
    const ref = refOf(path, node)
    pathOf.set(ref.id, path)
    blocks.push(docOf(ref, { path, text: held.text }).doc)
  }
  const all: Doc[] = [...blocks]
  const contents = () => readVault([...files].map(([path, held]) => ({ path, text: held.text })))
  const entities: Entity[] = contents().entities.map(entity => ({
    did: typeof entity.uri === "string" ? entity.uri.replace(/^at:\/\//, "") : "",
    handle: entity.aliases?.[0] ?? entity.slug, name: entity.name ?? entity.slug,
  }))
  const owner: Entity = { did: "", handle: listed.home, name: listed.home }
  const idAt = (path: string) => [...pathOf].find(([, at]) => at === path)?.[0]
  const journal = createJournal(all, undefined, { baseline: true, past: journaled ? pastChanges(journaled, idAt) : [] })
  const versions = new Map<string, number>()
  let sequence = 0
  const versionOf = (id: string) => `local-${versions.get(id) ?? 0}`
  const touch = (id: string) => versions.set(id, ++sequence)

  // ---- Writing back, one change at a time, in order ----
  const refused = new Set<string>()
  let queue: Promise<void> = Promise.resolve()
  const later = (path: string, work: () => Promise<void>) => {
    queue = queue.then(() => (refused.has(path) ? undefined : work())).catch(problem => {
      refused.add(path)
      onProblem(`${path} was not saved to your home: ${problem instanceof Error ? problem.message : String(problem)}`)
    })
  }
  const failed = async (response: Response) => {
    const said = await response.json().catch(() => ({})) as { error?: string }
    if (response.status === 412) return new Error("it changed on disk since it was read. Open your home again to see it")
    return new Error(said.error ?? `HTTP ${response.status}`)
  }
  const writeBack = (path: string) => later(path, async () => {
    const held = files.get(path)
    if (!held || held.text === held.sent) return
    const text = held.text
    const response = await bridgeFetch(`/vault/file?path=${encodeURIComponent(path)}`, {
      method: "PUT", body: text,
      headers: { "Content-Type": "text/markdown", ...(held.version ? { "If-Match": `"${held.version}"` } : { "If-None-Match": "*" }) },
    }, bridge)
    if (!response.ok) throw await failed(response)
    held.version = ((await response.json()) as { version: string }).version
    held.sent = text
  })
  const removeBack = (path: string, held: Held) => later(path, async () => {
    if (!held.version) return
    const response = await bridgeFetch(`/vault/file?path=${encodeURIComponent(path)}`, { method: "DELETE", headers: { "If-Match": `"${held.version}"` } }, bridge)
    if (!response.ok) throw await failed(response)
  })
  // A new media block: its image goes to the home first, and the bridge writes the file and its block together.
  const mediaBack = (path: string, doc: Doc) => later(path, async () => {
    const media = doc.media!
    const bytes = heldNow(media.hash)?.bytes ?? (await original(media.hash, media.mime))?.bytes
    if (!bytes) throw new Error("its image is not in this browser any more")
    const file = /!\[\[([^\]|#\n]+)/.exec(doc.body)?.[1]?.trim()
    const query = new URLSearchParams({
      channel: doc.homeChannel!, slug: doc.slug, title: doc.title, ...(file ? { name: file } : {}), ...(isPostId(doc.id) ? { id: doc.id } : {}),
      ...(media.alt ? { alt: media.alt } : {}), ...(media.width && media.height ? { width: String(media.width), height: String(media.height) } : {}),
    })
    const response = await bridgeFetch(`/media/${media.hash}?${query}`, { method: "PUT", body: bytes.slice(), headers: { "Content-Type": media.mime } }, bridge)
    if (!response.ok) throw await failed(response)
    const made = await response.json() as { path: string; text: string; version: string }
    if (made.path !== path) throw new Error(`your home already keeps this image as ${made.path}. Open your home again to see it`)
    const held = files.get(path)!
    // What is on disk now is what the bridge wrote; the workspace's later changes merge into it.
    const edited = held.text !== held.sent ? held.text : undefined
    held.version = made.version
    held.sent = made.text
    held.text = edited ? mergeFile(made.text, path, edited, "private") : made.text
    if (edited) writeBack(path)
  })

  // What the bridge says is on disk now, after a rename: each file's text and version, with any change
  // the workspace made meanwhile merged onto it; then the workspace reads its blocks again.
  const settle = (changed: { path: string; text: string; version: string }[]) => {
    for (const file of changed) {
      const held = files.get(file.path)
      if (!held) { files.set(file.path, { text: file.text, version: file.version, sent: file.text }); continue }
      const edited = held.text !== held.sent
      const layer = (nodeOf(file.path, held.text)?.visibility ?? "private") as Layer
      held.version = file.version
      held.sent = file.text
      held.text = edited ? mergeFile(file.text, file.path, held.text, layer) : file.text
      const id = idAt(file.path)
      const doc = id && blocks.find(each => each.id === id)
      if (doc) { Object.assign(doc, docOf({ ...refOf(file.path, nodeOf(file.path, held.text)!), id: doc.id }, { path: file.path, text: held.text }).doc); touch(doc.id) }
      if (edited) writeBack(file.path)
    }
    onChange()
  }
  const renameBack = (path: string, change: Record<string, string>) => later(path, async () => {
    const response = await bridgeFetch("/vault/rename", { method: "POST", body: JSON.stringify(change), headers: { "Content-Type": "application/json" } }, bridge)
    if (!response.ok) throw await failed(response)
    const done = await response.json() as { files: { path: string; text: string; version: string }[]; left?: { path: string }[] }
    if (done.left?.length) onProblem(`${done.left.length === 1 ? "One file" : `${done.left.length} files`} still use the old name, and go on working through it: ${done.left.map(each => each.path).join(", ")}`)
    settle(done.files)
  })
  // Moves a file in the working copy, keeping what was read of it, so the rename's answer settles it.
  const moveHeld = (from: string, to: string) => {
    const held = files.get(from)!
    files.delete(from)
    files.set(to, held)
    const id = idAt(from)
    if (id) pathOf.set(id, to)
  }

  // A move between layers, sent as the person's (via: visibility); the bridge writes it and answers the file.
  const visibilityBack = (path: string, to: Layer, asked?: { by: string; why?: string }) => later(path, async () => {
    const held = files.get(path)
    if (!held?.version) return
    const response = await bridgeFetch("/vault/visibility", {
      method: "POST", body: JSON.stringify({ path, to, ...(asked ? { asked: asked.by, ...(asked.why ? { why: asked.why } : {}) } : {}) }),
      headers: { "Content-Type": "application/json", "If-Match": `"${held.version}"` },
    }, bridge)
    if (!response.ok) throw await failed(response)
    const done = await response.json() as { path: string; text: string; version: string }
    settle([done])
  })
  const PUBLISH = "Showing a block to everyone, or taking a public one back, goes through Publish: choose Everyone on the block, and approve the plan."
  const asJson = (body: unknown, version?: string) => ({
    method: "POST", body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", ...(version ? { "If-Match": `"${version}"` } : {}) },
  })
  // The block's file, once every change before it has reached the disk, as publishing reads it.
  const onDisk = async (ref: BlockRef) => {
    await queue
    const path = pathOf.get(findDoc(ref).id)!
    const held = files.get(path)!
    if (refused.has(path)) throw new DOMException(`${path} has changes your home did not take. Open your home again first.`, "InvalidStateError")
    return { path, held }
  }

  const findDoc = (ref: BlockRef) => {
    const doc = blocks.find(each => each.id === ref.id)
    if (!doc) throw missing()
    return doc
  }

  const source = {
    // The workspace's own part: this home has no inbox or sample cortex; history starts from now.
    demo: {
      cortex: [] as Doc[], owner, entities, inbox: [] as InboxItem[], journal,
      markInboxRead() {},
      saveCortex() { throw new DOMException("The cortex is not read through the bridge yet.", "NotSupportedError") },
    },
    /** Where this home is: its handle, and the bridge it is read through. */
    home: { handle: listed.home, url: bridge.url },
    /** Every change written back so far, for tests. */
    settled: () => queue,
    /** Whether a change is not on disk yet, so leaving the page would lose it. */
    unsent: () => [...files].some(([path, held]) => held.text !== held.sent && !refused.has(path)),
    account() { return { did: null, user: { name: listed.home }, mirrored: false, service: null } },
    listBlocks(layers: readonly Layer[] = visibleLayers) {
      return blocks.filter(doc => layers.includes(doc.visibility)).map((doc): BlockHead => {
        const path = pathOf.get(doc.id)!
        return { ...refOf(path, nodeOf(path, files.get(path)!.text)!), id: doc.id, path, title: doc.title, version: versionOf(doc.id) }
      })
    },
    readBlock(ref: BlockRef) {
      const doc = findDoc(ref)
      const path = pathOf.get(doc.id)!
      return { path, text: files.get(path)!.text, version: versionOf(doc.id) }
    },
    saveBlock(ref: BlockRef, file: HomeFile, replaces: string | null, change?: Parameters<HomeSource["saveBlock"]>[3]) {
      const path = pathOf.get(ref.id)
      const written = nodeOf(file.path, file.text)
      if (!written || written.type !== "block") throw new DOMException("Give a vault block file.", "DataError")
      if (path) {
        if (versionOf(ref.id) !== replaces) throw stale()
        const held = files.get(path)!
        const was = nodeOf(path, held.text)!
        // Another home channel moves the file, through the bridge's rename, which rewrites what used its old path.
        if (written.home !== was.home) {
          const to = `${written.home ? `${written.home}/` : ""}${path.split("/").at(-1)}`
          if (files.has(to)) {
            onProblem(`There is already a file at ${to}, so the block stays where it is.`)
            return { version: versionOf(ref.id) }
          }
          const text = mergeFile(held.text, to, file.text, ref.layer)
          moveHeld(path, to)
          files.get(to)!.text = text
          touch(ref.id)
          Object.assign(blocks.find(each => each.id === ref.id)!, docOf(ref, { path: to, text }).doc)
          renameBack(path, { block: path, home: written.home ?? "" })
          journal.syncJournal(change)
          return { version: versionOf(ref.id) }
        }
        if ((written.visibility ?? "private") !== (was.visibility ?? "private")) {
          onProblem("Who sees a block is changed with its visibility control, which asks you first.")
          return { version: versionOf(ref.id) }
        }
        const text = mergeFile(held.text, path, file.text, ref.layer)
        const read = readNode(path, text)
        if (!read || read.problems.length) throw new DOMException(`The block would not read: ${read?.problems.join(" ")}`, "DataError")
        if (text !== held.text) {
          held.text = text
          touch(ref.id)
          const doc = blocks.find(each => each.id === ref.id)!
          Object.assign(doc, docOf(ref, { path, text }).doc)
          writeBack(path)
        }
      } else {
        if (replaces !== null) throw stale()
        if (files.has(file.path)) throw new DOMException(`There is already a file at ${file.path}.`, "DataError")
        const text = ref.layer === "private" ? setProperty(file.text, "visibility", undefined) : file.text
        const doc = docOf(ref, { path: file.path, text }).doc
        files.set(file.path, { text, version: null })
        pathOf.set(ref.id, file.path)
        blocks.push(doc)
        all.push(doc)
        touch(ref.id)
        if (doc.media) mediaBack(file.path, doc)
        else writeBack(file.path)
      }
      journal.syncJournal(change)
      return { version: versionOf(ref.id) }
    },
    deleteBlock(ref: BlockRef, replaces: string) {
      const doc = findDoc(ref)
      if (versionOf(ref.id) !== replaces) throw stale()
      const path = pathOf.get(doc.id)!
      const held = files.get(path)!
      files.delete(path)
      pathOf.delete(doc.id)
      blocks.splice(blocks.indexOf(doc), 1)
      all.splice(all.indexOf(doc), 1)
      removeBack(path, held)
      journal.syncJournal()
    },
    /** Each channel's order, and new channels, written to their _channel.md. A channel moved elsewhere is not built here yet. */
    saveChannels(records: readonly ChannelRecord[]) {
      const now = contents().channels
      const idOf = (channel: (typeof now)[number]) => channel.id ?? channel.path
      const slugOf = (id: string) => blocks.find(doc => doc.id === id)?.slug
      for (const record of records) {
        const held = now.find(channel => idOf(channel) === record.id)
        if (held && held.path !== record.path) {
          onProblem(`Moving or renaming a channel in your home is not built here yet. Run: ohmmmm vault rename ${held.path} ${record.path}`)
          continue
        }
        const path = `${record.path}/${CHANNEL_FILE}`
        const order = record.order.map(slugOf).filter((slug): slug is string => !!slug)
        const file = files.get(path)
        if (file) {
          if (same(nodeOf(path, file.text) && (readNode(path, file.text)!.node as { order: string[] }).order, order)) continue
          file.text = setProperty(file.text, "order", order.length ? order : undefined)
          writeBack(path)
        } else if (!held || order.length) {
          const text = nodeFile({ type: "channel", path: record.path, order, description: record.description ?? "", properties: {}, id: isPostId(record.id) ? record.id : newNodeId() }).text
          files.set(path, { text, version: null })
          writeBack(path)
        }
      }
      for (const channel of now) {
        const path = `${channel.path}/${CHANNEL_FILE}`
        const held = files.get(path)
        if (!records.some(record => record.id === idOf(channel)) && held) {
          files.delete(path)
          removeBack(path, held)
        }
      }
    },
    /**
     * Renames or moves a channel as one folder (the store calls this in place of moving each block),
     * through the bridge's rename: what used its old path is rewritten, and the channel gets an ID.
     */
    moveChannel(from: string, to: string) {
      if ([...files.keys()].some(path => path.startsWith(`${to}/`))) throw new DOMException(`There is already a channel “${to}” in your home.`, "DataError")
      for (const path of [...files.keys()]) if (path.startsWith(`${from}/`)) moveHeld(path, `${to}${path.slice(from.length)}`)
      for (const doc of blocks) {
        const path = pathOf.get(doc.id)!
        if (path.startsWith(`${to}/`)) { Object.assign(doc, docOf({ ...refOf(path, nodeOf(path, files.get(path)!.text)!), id: doc.id }, { path, text: files.get(path)!.text }).doc); touch(doc.id) }
      }
      renameBack(`${to}/${CHANNEL_FILE}`, { channel: from, to })
      journal.syncJournal()
    },
    /** Moves a block between Only you and Friends, once the person has approved (the visibility control asks). Public is Publish's. */
    markVisibility(ref: BlockRef, layer: Layer, replaces: string, why?: string) {
      const doc = findDoc(ref)
      if (versionOf(ref.id) !== replaces) throw stale()
      if (layer === "public" || doc.visibility === "public" || doc.kind === "post") { onProblem(PUBLISH); return }
      if (doc.visibility === layer) return
      const path = pathOf.get(doc.id)!
      const held = files.get(path)!
      // Only the layer changes: visibility, and kind where the property alone would make a note read as a post.
      held.text = mergeFile(held.text, path, held.text, layer)
      touch(doc.id)
      Object.assign(doc, docOf({ ...refOf(path, nodeOf(path, held.text)!), id: doc.id }, { path, text: held.text }).doc)
      // An agent's move, approved by the person in the page, is journaled with the agent that asked.
      const actor = journal.actor()
      visibilityBack(path, layer, actor.kind === "agent" ? { by: `agent:${actor.name.replace(/[^A-Za-z0-9._-]+/g, "-")}`, why } : undefined)
      journal.syncJournal()
    },
    /** What agents asked to change about who sees a block, waiting for the person. */
    async requests(): Promise<VisibilityRequest[]> {
      const response = await bridgeFetch("/vault/requests", {}, bridge)
      if (!response.ok) throw await failed(response)
      return ((await response.json()) as { requests: VisibilityRequest[] }).requests
    },
    /** The person's answer to a request. Approved, the bridge moves the block, and the workspace reads it again. */
    async decide(id: string, approve: boolean) {
      await queue
      const response = await bridgeFetch(`/vault/requests/${encodeURIComponent(id)}`, { method: "POST", body: JSON.stringify({ approve }), headers: { "Content-Type": "application/json" } }, bridge)
      if (!response.ok) throw await failed(response)
      const done = await response.json() as { request: VisibilityRequest; file?: { path: string; text: string; version: string } }
      if (done.file) settle([done.file])
      return done.request
    },
    /** What publishing the block would write, and what this computer still needs; `label` tries another place on the site. Writes nothing. */
    async planPublish(ref: BlockRef, label?: PostLabel): Promise<PublishDraft> {
      const { path } = await onDisk(ref)
      const response = await bridgeFetch("/vault/publish/plan", asJson({ path, ...(label ? { label: label.label, sublabel: label.sublabel ?? "" } : {}) }), bridge)
      if (!response.ok) throw await failed(response)
      return await response.json() as PublishDraft
    },
    /**
     * Publishes the block as the plan the person approved: the bridge writes its post to their PDS,
     * then marks its file public (and keeps the label on its channel). Refused when the block changed
     * since the plan.
     */
    async publishBlock(ref: BlockRef, draft: PublishDraft): Promise<{ address: string; update: boolean }> {
      const { path, held } = await onDisk(ref)
      if (!draft.confirm || path !== draft.path || held.version !== draft.version) throw new DOMException("It changed since you saw the plan. Look at it again.", "InvalidStateError")
      const response = await bridgeFetch("/vault/publish", asJson({ path, confirm: draft.confirm, label: draft.label, sublabel: draft.sublabel }, held.version), bridge)
      if (!response.ok) throw await failed(response)
      const done = await response.json() as { address: string; update: boolean; files: { path: string; text: string; version: string }[] }
      settle(done.files)
      journal.syncJournal()
      return { address: done.address, update: done.update }
    },
    /** Takes the block's post down from the PDS, then keeps the block for `to`. */
    async unpublishBlock(ref: BlockRef, to: "private" | "friends"): Promise<{ removed: boolean; address?: string }> {
      const { path, held } = await onDisk(ref)
      if (!held.version) throw missing()
      const response = await bridgeFetch("/vault/unpublish", asJson({ path, to }, held.version), bridge)
      if (!response.ok) throw await failed(response)
      const done = await response.json() as { path: string; text: string; version: string; removed: boolean; address?: string }
      settle([done])
      journal.syncJournal()
      return { removed: done.removed, ...(done.address ? { address: done.address } : {}) }
    },
    vault(layers: readonly Layer[] = visibleLayers) {
      return readVault([...files].filter(([path, held]) => {
        const node = nodeOf(path, held.text)
        return node?.type !== "block" || layers.includes((node.visibility ?? "private") as Layer)
      }).map(([path, held]) => ({ path, text: held.text })))
    },
    connections(layers?: readonly Layer[]): VaultEvidence {
      const vault = source.vault(layers)
      // A private block's whole-block links are a property, as in the sample; posts keep theirs in the post.
      return evidence({
        ...vault,
        blocks: vault.blocks.map(block => "properties" in block && Array.isArray(block.properties.connect)
          ? { ...block, post: { connect: block.properties.connect } }
          : block),
      })
    },
    search: createSampleSearch(all, entities),
    history(ref: BlockRef) {
      return journal.linesFor(ref.id).filter(line => line.op !== "remove")
        .map(line => ({ rev: line.id, version: line.after, created: line.at })).reverse()
    },
    readVersion(ref: BlockRef, rev: string | number) {
      const doc = findDoc(ref)
      const line = typeof rev === "string" ? journal.changeById(rev) : undefined
      const snapshot = line && line.node === ref.id && journal.snapshotAt(line.after)
      if (!snapshot) throw missing()
      // That version as the workspace would write it, merged onto the file as it is on disk now.
      const path = pathOf.get(doc.id)!
      return { path, text: mergeFile(files.get(path)!.text, path, fileOf({ ...doc, ...snapshot }).text, doc.visibility) }
    },
    visibilityMove,
    async moveVisibility(): Promise<never> { throw new DOMException("Who sees a block in your home is changed with its visibility control: Friends and Only you in its file, Everyone through Publish.", "NotSupportedError") },
    async listFriends() { return [] },
    async removeFriend() { throw new DOMException("Friends are kept by the vault service.", "NotSupportedError") },
    async listShared() { return [] },
    async readShared(): Promise<never> { throw missing() },
    async publishPlan() { return emptyPlan() },
  } satisfies HomeSource<"sync"> & {
    demo: unknown; home: { handle: string; url: string }; settled(): Promise<void>; unsent(): boolean; moveChannel(from: string, to: string): void
    requests(): Promise<VisibilityRequest[]>; decide(id: string, approve: boolean): Promise<VisibilityRequest>
    planPublish(ref: BlockRef, label?: PostLabel): Promise<PublishDraft>
    publishBlock(ref: BlockRef, draft: PublishDraft): Promise<{ address: string; update: boolean }>
    unpublishBlock(ref: BlockRef, to: "private" | "friends"): Promise<{ removed: boolean; address?: string }>
  }
  return source
}

export type LocalSource = Awaited<ReturnType<typeof createLocalSource>>
