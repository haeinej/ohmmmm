import { setProperty, writeNoteFile } from "../../../vault/vault/file.mjs"
import { evidence, newNodeId, readVault } from "../../../vault/vault/node.mjs"
import { docOf, fileOf } from "./block-document"
import { createJournal } from "./journal"
import * as fixtures from "./sample"
import { createSampleSearch } from "./sample-search"
import { emptyPlan, visibilityMove, type BlockHead, type BlockRef, type HomeSource, type Layer, type VaultEvidence } from "./source"
import { channelsOf, type ChannelRecord, type Doc } from "./workspace-model"

const visibleLayers: readonly Layer[] = ["public", "friends", "private"]
const missing = () => new DOMException("There is no such sample block.", "NotFoundError")
const stale = () => new DOMException("The sample block changed. Read it again before saving.", "InvalidStateError")

export function createSampleSource() {
  const { blocks, cortex, owner, entities, inbox, fixtureIds } = structuredClone({ ...fixtures })
  const all = [...blocks, ...cortex]
  const journal = createJournal(all, fixtureIds)
  const channels: ChannelRecord[] = []
  const revisions = new Map<string, { content: string; version: string }>()
  const friendList = entities.filter(person => person.did !== owner.did).map(person => ({ did: person.did, added: "2026-11-01" }))
  let sequence = 0

  const versionOf = (doc: Doc) => {
    const content = JSON.stringify(doc)
    const held = revisions.get(doc.id)
    if (held?.content === content) return held.version
    const version = `sample-${++sequence}`
    revisions.set(doc.id, { content, version })
    return version
  }

  function ensureChannel(path: string, created: string) {
    if (!path || channels.some(channel => channel.path === path)) return
    const parent = path.split("/").slice(0, -1).join("/")
    ensureChannel(parent, created)
    channels.push({ id: newNodeId(), path, order: [], created })
  }

  for (const post of blocks) for (const path of channelsOf(post)) ensureChannel(path, post.updated)
  for (const path of ["reading", "projects/someday"]) ensureChannel(path, "2026-11-18")

  function find(ref: BlockRef, version?: string) {
    const doc = blocks.find(post => post.id === ref.id && post.visibility === ref.layer)
    if (!doc) throw missing()
    if (version !== undefined && versionOf(doc) !== version) throw stale()
    return doc
  }

  function refreshChannels(doc: Doc) {
    for (const path of channelsOf(doc)) ensureChannel(path, doc.updated)
  }

  const source = {
    // Cortex, inbox and the demo's timeline have no live workspace integration in WP2.
    demo: {
      cortex, owner, entities, inbox, journal,
      markInboxRead(id: string) {
        const item = inbox.find(item => item.id === id)
        if (item) item.unread = false
      },
      saveCortex(doc: Doc, change?: Parameters<HomeSource["saveBlock"]>[3]) {
        const held = cortex.find(node => node.id === doc.id)
        if (!held) throw missing()
        Object.assign(held, doc)
        journal.syncJournal(change)
      },
    },
    account() { return { did: owner.did, user: { name: owner.name }, mirrored: false, service: null } },
    listBlocks(layers: readonly Layer[] = visibleLayers) {
      return blocks.filter(post => layers.includes(post.visibility)).map((post): BlockHead => ({
        id: post.id, layer: post.visibility, path: fileOf(post).path, title: post.title, version: versionOf(post),
        store: post.visibility === "private" ? "sealed" : post.kind === "post" ? "post" : "block",
      }))
    },
    readBlock(ref) {
      const doc = find(ref)
      return { ...fileOf(doc), version: versionOf(doc) }
    },
    saveBlock(ref, file, replaces, change?) {
      const held = blocks.find(post => post.id === ref.id)
      if ((held ? versionOf(held) : null) !== replaces || (held && held.visibility !== ref.layer)) throw stale()
      const { doc } = docOf(ref, { ...file, text: setProperty(file.text, "visibility", ref.layer) })
      if (held) Object.assign(held, doc)
      else { blocks.push(doc); all.push(doc) }
      refreshChannels(doc)
      journal.syncJournal(change)
      return { version: versionOf(held ?? doc) }
    },
    deleteBlock(ref, replaces) {
      const doc = find(ref, replaces)
      blocks.splice(blocks.indexOf(doc), 1)
      all.splice(all.indexOf(doc), 1)
      revisions.delete(doc.id)
      journal.syncJournal()
    },
    saveChannels(records) {
      channels.splice(0, channels.length, ...structuredClone(records))
    },
    markVisibility(ref, layer, replaces) {
      find(ref, replaces).visibility = layer
    },
    vault(layers: readonly Layer[] = visibleLayers) {
      const files = blocks.filter(post => layers.includes(post.visibility)).map(fileOf)
      const channelFiles = channels.map(channel => ({
        path: `${channel.path}/_channel.md`,
        text: writeNoteFile({
          properties: { sampleId: channel.id, created: channel.created, order: channel.order.map(id => blocks.find(doc => doc.id === id)?.slug).filter(Boolean) },
          body: channel.description,
        }),
      }))
      const entityFiles = entities.map(person => ({
        path: `_entities/person/${person.handle}.md`,
        text: writeNoteFile({ properties: { name: person.name, aliases: [person.handle], uri: `at://${person.did}` } }),
      }))
      return readVault([...files, ...channelFiles, ...entityFiles])
    },
    connections(layers?: readonly Layer[]): VaultEvidence {
      const vault = source.vault(layers)
      // Private sample text blocks also carry whole-block links as an app property.
      return evidence({
        ...vault,
        blocks: vault.blocks.map(block => "properties" in block && Array.isArray(block.properties.connect)
          ? { ...block, post: { connect: block.properties.connect } }
          : block),
      })
    },
    search: createSampleSearch(all, entities),
    history(ref) {
      return journal.linesFor(ref.id).filter(line => line.op !== "remove")
        .map(line => ({ rev: line.id, version: line.after, created: line.at })).reverse()
    },
    readVersion(ref, rev) {
      const doc = find(ref)
      const line = typeof rev === "string" ? journal.changeById(rev) : undefined
      const snapshot = line && line.node === ref.id && journal.snapshotAt(line.after)
      if (!snapshot) throw missing()
      return fileOf({ ...doc, ...snapshot })
    },
    visibilityMove,
    async moveVisibility(ref, { layer: to }, replaces) {
      visibilityMove(ref, to)
      const doc = find(ref, replaces)
      doc.visibility = to
      return { ref: { id: ref.id, layer: to, store: to === "private" ? "sealed" : doc.kind === "post" ? "post" : "block" }, version: versionOf(doc), cleanupPending: false }
    },
    async listFriends() { return structuredClone(friendList) },
    async removeFriend(did) {
      const index = friendList.findIndex(friend => friend.did === did)
      if (index >= 0) friendList.splice(index, 1)
    },
    async listShared() { return [] },
    async readShared() { throw missing() },
    async publishPlan() { return emptyPlan() },
  } satisfies HomeSource<"sync"> & { demo: unknown }
  return source
}

export type SampleSource = ReturnType<typeof createSampleSource>
export const sampleSource = createSampleSource()
