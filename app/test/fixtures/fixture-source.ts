// A HomeSource over synthetic data, for tests only. It keeps the service's rules that the workspace
// leans on (versions, compare-and-set, channels as files, the sealed cortex as files)
// in memory. The app never imports it: its runtime source is the vault service.
import { setProperty, writeNoteFile } from "../../../vault/vault/file.mjs"
import { evidence, newNodeId, readNode, readVault } from "../../../vault/vault/node.mjs"
import { docOf, fileOf } from "../../src/data/block-document"
import { cortexDocOf, cortexFileOf } from "../../src/data/cortex-document"
import { createJournal, type Actor, type JournalEntry } from "../../src/data/journal"
import {
  emptyPlan, mediaName, moveVisibility, visibilityMove,
  type BlockHead, type BlockRef, type ChannelHead, type CortexFile, type Friend, type FriendRequest, type HomeFile, type HomeSource, type Layer, type MoveRecord, type MoveResult, type MoveTarget, type MoveRequest, type VaultEvidence,
} from "../../src/data/source"
import { channelsOf, type Doc } from "../../src/data/workspace-model"
import { createMemorySearch } from "../../src/data/memory-search"
import * as fixtures from "./sample"

const allLayers: readonly Layer[] = ["public", "friends", "private"]
const missing = () => new DOMException("There is no such fixture block.", "NotFoundError")
const stale = () => new DOMException("The fixture block changed. Read it again before saving.", "InvalidStateError")
const versionOf = (value: unknown) => {
  let hash = 0x811c9dc5
  for (const char of JSON.stringify(value)) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 0x01000193) }
  return `fixture-${(hash >>> 0).toString(16)}`
}
const storeOf = (doc: Doc): BlockRef["store"] => doc.visibility === "private" ? "sealed" : doc.kind === "post" ? "post" : "block"

export function createFixtureSource() {
  const { blocks: vaultBlocks, cortex: cortexDocs, owner, entities, byAgent, fixtureIds } = structuredClone({ ...fixtures })
  const blocks = [...vaultBlocks, ...byAgent]
  const channels = new Map<string, string>()
  const cortexFiles = new Map<string, HomeFile>(cortexDocs.map(doc => [doc.id, cortexFileOf(doc)]))
  const media = new Map<string, Uint8Array>()
  const friendList: Friend[] = entities.filter(person => person.did !== owner.did).map(person => ({ did: person.did, added: "2026-11-01", channels: "*" }))
  const friendAsks: FriendRequest[] = []
  const journal = seededJournal([...blocks, ...cortexDocs], fixtureIds)
  /** Kept versions of sealed blocks, newest last, as the private layer keeps them. */
  const kept = new Map<string, { rev: number; version: string; created: string; file: HomeFile }[]>()
  let revs = 0
  const requests: MoveRequest[] = []
  const journalOfMoves: (MoveRecord & { state: string })[] = []
  const hidden = new Set<string>()
  /** Failures to come, as a dropped connection would cause: the next delete, or the next record. */
  const failing = { delete: 0, record: 0 }
  const dropped = () => new DOMException("The connection dropped.", "NetworkError")

  const channelText = (path: string, created: string) => writeNoteFile({ properties: { id: newNodeId(), created } })
  function ensureChannel(path: string, created: string) {
    if (!path || channels.has(path)) return
    ensureChannel(path.split("/").slice(0, -1).join("/"), created)
    channels.set(path, channelText(path, created))
  }
  for (const doc of blocks) for (const path of channelsOf(doc)) ensureChannel(path, doc.updated)
  for (const path of ["reading", "projects/someday"]) ensureChannel(path, "2026-11-18")

  function find(ref: BlockRef, version?: string) {
    const doc = blocks.find(each => each.id === ref.id && each.visibility === ref.layer)
    if (!doc) throw missing()
    if (version !== undefined && versionOf(fileOf(doc)) !== version) throw stale()
    return doc
  }
  const cortexFile = (id: string): CortexFile => {
    const file = cortexFiles.get(id)
    if (!file) throw missing()
    return { id, ...file, version: versionOf(file) }
  }
  const channelHead = (path: string): ChannelHead => ({ path, version: versionOf({ path, text: channels.get(path) }) })

  function vaultOf(layers: readonly Layer[] = allLayers) {
    const files = blocks.filter(doc => layers.includes(doc.visibility)).map(doc => fileOf(doc))
    const channelFiles = [...channels].map(([path, text]) => ({ path: `${path}/_channel.md`, text }))
    const entityFiles = entities.map(person => ({
      path: `_entities/person/${person.handle}.md`,
      text: writeNoteFile({ properties: { name: person.name, aliases: [person.handle], uri: `at://${person.did}` } }),
    }))
    return readVault([...files, ...channelFiles, ...entityFiles])
  }
  async function mediaOf(name: string) {
    const bytes = media.get(name)
    if (!bytes) throw missing()
    return new Blob([bytes as Uint8Array<ArrayBuffer>])
  }

  const source = {
    account() { return { did: owner.did, user: { name: owner.name }, mirrored: false, service: null } },
    listBlocks(layers: readonly Layer[] = allLayers) {
      return blocks.filter(doc => layers.includes(doc.visibility)).map((doc): BlockHead => ({
        id: doc.id, layer: doc.visibility, path: fileOf(doc).path, title: doc.title, version: versionOf(fileOf(doc)), store: storeOf(doc),
        ...(hidden.has(doc.id) ? { leaving: "2026-11-24T00:00:00.000Z" } : {}),
      }))
    },
    readBlock(ref: BlockRef) {
      const file = fileOf(find(ref))
      return { ...file, version: versionOf(file) }
    },
    saveBlock(ref: BlockRef, file: HomeFile, replaces: string | null) {
      // Posts, readable blocks and sealed blocks are separate stores, as on the service.
      const held = blocks.find(doc => doc.id === ref.id && storeOf(doc) === ref.store)
      // A post changes layer in place (to or from public, through Publish); anything else moves between stores.
      if ((held ? versionOf(fileOf(held)) : null) !== replaces || (held && held.visibility !== ref.layer && storeOf(held) !== "post")) throw stale()
      const { doc } = docOf(ref, { ...file, text: setProperty(file.text, "visibility", ref.layer) })
      if (held) { for (const key of Object.keys(held)) delete (held as Record<string, unknown>)[key]; Object.assign(held, doc) }
      else blocks.push(doc)
      for (const path of channelsOf(doc)) ensureChannel(path, doc.updated)
      const saved = fileOf(held ?? doc)
      if (ref.store === "sealed") kept.set(ref.id, [...kept.get(ref.id) ?? [], { rev: ++revs, version: versionOf(saved), created: new Date().toISOString(), file: saved }])
      return { version: versionOf(saved) }
    },
    deleteBlock(ref: BlockRef, replaces: string) {
      if (failing.delete) { failing.delete--; throw dropped() }
      const doc = find(ref, replaces)
      blocks.splice(blocks.indexOf(doc), 1)
    },
    vault: vaultOf,
    connections(layers?: readonly Layer[]): VaultEvidence {
      return evidence(vaultOf(layers))
    },
    search: createMemorySearch(() => [...blocks, ...[...cortexFiles.keys()].map(id => cortexDocOf(cortexFile(id))!)], entities),
    history(ref: BlockRef) {
      const versions = kept.get(ref.id)
      if (versions) return versions.map(({ rev, version, created }) => ({ rev, version, created })).reverse()
      return journal.linesFor(ref.id).filter(line => line.op !== "remove")
        .map(line => ({ rev: line.id, version: line.after, created: line.at })).reverse()
    },
    readVersion(ref: BlockRef, rev: string | number) {
      const version = kept.get(ref.id)?.find(each => each.rev === rev)
      if (version) return version.file
      const doc = find(ref)
      const line = typeof rev === "string" ? journal.changeById(rev) : undefined
      const snapshot = line && line.node === ref.id && journal.snapshotAt(line.after)
      if (!snapshot) throw missing()
      return fileOf({ ...doc, ...snapshot })
    },
    visibilityMove,
    // The service source's move: copy into the other store (under the opaque ID for private), then
    // remove the old copy.
    async moveVisibility(ref: BlockRef, to: MoveTarget, replaces: string): Promise<MoveResult> {
      return moveVisibility(source as unknown as Pick<HomeSource, "readBlock" | "saveBlock" | "deleteBlock">, ref, to, replaces)
    },
    async listFriends() { return structuredClone(friendList) },
    friendRequests: {
      async list() { return structuredClone(friendAsks) },
      async approve(id: string, channels: "*" | string[]) {
        const index = friendAsks.findIndex(each => each.id === id)
        if (index < 0) throw new DOMException("There is no such request waiting", "NotFoundError")
        const [asked] = friendAsks.splice(index, 1)
        friendList.push({ did: asked.did, added: "2026-11-24", channels, ...(asked.name ? { name: asked.name } : {}), ...(asked.email ? { email: asked.email } : {}) })
      },
      async decline(id: string) {
        const index = friendAsks.findIndex(each => each.id === id)
        if (index < 0) throw new DOMException("There is no such request waiting", "NotFoundError")
        friendAsks.splice(index, 1)
      },
      async setChannels(did: string, channels: "*" | string[]) {
        const friend = friendList.find(each => each.did === did)
        if (!friend) throw new DOMException("That DID is not a friend", "NotFoundError")
        friend.channels = channels
      },
    },
    async removeFriend(did: string) {
      const index = friendList.findIndex(friend => friend.did === did)
      if (index >= 0) friendList.splice(index, 1)
    },
    async listShared() { return [] },
    async readShared(): Promise<never> { throw missing() },
    async publishPlan() { return emptyPlan() },
    channels: {
      async list() { return [...channels.keys()].map(channelHead) },
      async read(path: string) {
        const text = channels.get(path)
        if (text === undefined) throw missing()
        return { path, text, version: channelHead(path).version }
      },
      async save(file: HomeFile, replaces: string | null) {
        const path = file.path.replace(/\/_channel\.md$/, "")
        if ((channels.has(path) ? channelHead(path).version : null) !== replaces) throw stale()
        channels.set(path, file.text)
        return { version: channelHead(path).version }
      },
      async move(from: string, to: string, replaces: string | null) {
        if ((channels.has(from) ? channelHead(from).version : null) !== replaces) throw stale()
        if (channels.has(to)) throw new DOMException(`There is already a channel at ${to}`, "InvalidStateError")
        const under = (path: string) => path === from || path.startsWith(`${from}/`)
        const moved = (path: string) => under(path) ? to + path.slice(from.length) : path
        let movedChannels = 0, movedBlocks = 0
        for (const [path, text] of [...channels]) if (under(path)) { channels.delete(path); channels.set(moved(path), text); movedChannels++ }
        // As the service: it moves the readable blocks; sealed ones are refiled on the device.
        for (const doc of blocks.filter(each => each.visibility !== "private")) {
          const home = moved(doc.homeChannel!), inner = doc.channels?.map(moved)
          if (home === doc.homeChannel && JSON.stringify(inner) === JSON.stringify(doc.channels)) continue
          Object.assign(doc, { homeChannel: home, channels: inner })
          movedBlocks++
        }
        for (const path of channelsOf({ kind: "text", homeChannel: to } as Doc)) ensureChannel(path, "2026-11-23")
        return { from, to, channels: movedChannels, blocks: movedBlocks }
      },
      async remove(path: string, replaces: string) {
        if (channelHead(path).version !== replaces) throw stale()
        if (blocks.some(doc => channelsOf(doc).some(each => each === path || each.startsWith(`${path}/`)))
          || [...channels.keys()].some(each => each.startsWith(`${path}/`))) {
          throw new DOMException("A block or channel is filed in it", "InvalidStateError")
        }
        channels.delete(path)
      },
    },
    cortex: {
      async list() { return [...cortexFiles.keys()].map(cortexFile) },
      async read(id: string) { return cortexFile(id) },
      async save(id: string, file: HomeFile, replaces: string | null) {
        if ((cortexFiles.has(id) ? cortexFile(id).version : null) !== replaces) throw stale()
        cortexFiles.set(id, { path: file.path, text: file.text })
        return { version: cortexFile(id).version }
      },
      async saveMany() { throw new DOMException("Not in the fixture.", "NotSupportedError") },
      async remove(id: string, replaces: string) {
        if (cortexFile(id).version !== replaces) throw stale()
        cortexFiles.delete(id)
      },
      async history() { return [] },
      async readVersion(): Promise<never> { throw missing() },
      async journal() {
        return journal.historyLines().map((line, index) => ({ seq: index + 1, created: line.at, entry: journal.entryOf(line) }))
      },
    },
    media: {
      async has(names: readonly string[]) { return names.filter(name => media.has(name)) },
      async put(bytes: Uint8Array<ArrayBuffer>) {
        const name = await mediaName(bytes)
        media.set(name, bytes)
        return { name, size: bytes.byteLength }
      },
      get: mediaOf,
      rendition: mediaOf,
    },
    // Agents' requests and the move journal, as the service keeps them; `ask` stands in for an agent.
    moves: {
      async requests() { return requests.filter(request => request.state === "waiting") },
      async decline(id: string) {
        const request = requests.find(each => each.id === id && each.state === "waiting")
        if (!request) throw new DOMException("This request has been answered already", "InvalidStateError")
        request.state = "declined"
        journalOfMoves.push({ block: request.block, from: request.from, to: request.to, request: id, state: "declined" })
      },
      async record(move: MoveRecord) {
        if (failing.record) { failing.record--; throw dropped() }
        // A move named by the cockpit is journalled once, however often it is sent.
        const earlier = move.moveId && journalOfMoves.find(line => line.moveId === move.moveId)
        if (earlier) return { state: earlier.state }
        if (move.request) {
          const request = requests.find(each => each.id === move.request && each.state === "waiting")
          if (!request) throw new DOMException("This request has been answered already", "InvalidStateError")
          if (request.block !== move.block || request.to !== move.to) throw new DOMException("The move made is not the one requested", "InvalidStateError")
          request.state = "approved"
        }
        const state = move.cleanupPending ? "cleanup-pending" : move.to === "public" || move.from === "public" ? "previewed" : "done"
        journalOfMoves.push({ ...move, state })
        return { state }
      },
      publishPage: (postId: string) => `https://vault.example.test/vault/?publish=${postId}`,
    },
    async agenda() {
      return {
        unlabelled: blocks.filter(doc => doc.homeChannel === "other").length,
        mediaWithoutAlt: blocks.filter(doc => doc.kind === "media").length,
        counted: "public and friends-only",
      }
    },
  } satisfies Omit<HomeSource<"sync">, "channels" | "cortex" | "media" | "moves" | "friendRequests" | "agenda"> & Pick<HomeSource, "channels" | "cortex" | "media" | "moves" | "friendRequests" | "agenda">
  const ask = (request: Omit<MoveRequest, "id" | "asked" | "state">) => {
    const made = { ...request, id: `r${requests.length + 1}`, asked: "2026-11-24T00:00:00.000Z", state: "waiting" as const }
    requests.push(made)
    return made
  }
  /** Hides a friends block as an agent with a grant would (vault.hideBlock). */
  const hide = (id: string) => { hidden.add(id) }
  /** Someone signed in to ohm asks to be a friend (vault.askFriend). */
  const askFriend = (asked: Omit<FriendRequest, "id" | "asked">) => {
    const made = { ...asked, id: `f${friendAsks.length + 1}`, asked: "2026-11-24T00:00:00.000Z" }
    friendAsks.push(made)
    return made
  }
  return Object.assign(source, { fixtureIds, owner, ask, hide, askFriend, journalOfMoves, failing })
}

export type FixtureSource = ReturnType<typeof createFixtureSource>
export { fixtureIds } from "./sample"

/** A few days of history, by the member and two agents, as the cortex journal would hold them. */
function seededJournal(all: Doc[], ids: typeof fixtures.fixtureIds) {
  const journal = createJournal([])
  const claude: Actor = { kind: "agent", name: "Claude Code" }
  const muse: Actor = { kind: "agent", name: "Muse" }
  const you: Actor = { kind: "human", name: "you" }
  const day = (d: string, t = "10:00") => new Date(`${d}T${t}:00`)
  const byId = (id: string) => all.find(doc => doc.id === id)!
  const now = new Map(all.map(doc => [doc.id, structuredClone(doc)]))
  const edit = (id: string, change: Partial<Doc>, op: Parameters<typeof journal.recordChange>[1], by: Actor, at: Date, reason?: string) => {
    Object.assign(byId(id), now.get(id), change)
    journal.recordChange(byId(id), op, { by, at, reason })
  }
  for (const doc of all) if (doc.id !== ids.monday && doc.id !== ids.slow) journal.recordChange(doc, "create", { at: day(doc.updated || "2026-11-01", "09:00"), by: you })
  edit(ids.slow, { body: "# Slow software\n\nTools that wait for you." }, "create", you, day("2026-10-18", "21:10"))
  edit(ids.slow, {}, "edit", muse, day("2026-10-21", "11:02"), "Linked the two blocks you said say the same thing")
  journal.recordSession(muse, "Linked Slow software to the blocks it echoes", [
    { tried: "Filing Slow software under projects", why: "You keep essays in writing, and moved it back the last time" },
  ], day("2026-10-21", "11:05"))
  edit(ids.monday, { body: "# Monday, rain\n\nNothing shipped.", channels: undefined }, "create", you, day("2026-11-10", "22:15"))
  journal.save("Before the slowness channel", "Everything as it was before I started collecting slowness", day("2026-11-10", "23:00"))
  edit(ids.monday, {}, "edit", claude, day("2026-11-11", "07:30"), "Added the line you dictated")
  journal.recordSession(claude, "Added the line you dictated to Monday, rain", [], day("2026-11-11", "07:32"))
  for (const doc of all) Object.assign(doc, now.get(doc.id))
  return journal
}

export type { JournalEntry }
