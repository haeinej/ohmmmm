import assert from "node:assert/strict"
import test from "node:test"
import { createServiceSource } from "../src/data/service-source"
import { createFixtureSource } from "./fixtures/fixture-source"
import { blockOf, moveVisibility, type BlockRef } from "../src/data/source"
import { channelByPath, workspaceEvidence } from "../src/data/workspace-data"
import { renameChannel, setSource } from "../src/workspace/store"
import { isPostId, setProperty } from "../../vault/vault/file.mjs"
import { newNodeId } from "../../vault/vault/node.mjs"

test("renaming a channel moves it at the source, keeps its identity and updates its evidence key", async () => {
  await setSource(createFixtureSource())
  try {
    const original = channelByPath("writing")!
    await renameChannel("writing", "essays")
    assert.equal(channelByPath("writing"), undefined)
    assert.equal(channelByPath("essays")?.id, original.id)
    // A channel with an ID is known by it, so its evidence follows it when it moves.
    const inner = channelByPath("essays/journal")!
    assert.ok(workspaceEvidence().some(edge => edge.kind === "contains" && edge.from === `channel:${inner.id}`))
  } finally {
    await setSource()
  }
})

test("a Friends block with an envelope-only TID keeps it inside the private copy", async () => {
  const from: BlockRef = { id: newNodeId(), layer: "friends", store: "block" }
  const opaqueId = "fixture-opaque-private-file"
  const operations: string[] = []
  const result = await moveVisibility({
    async readBlock(ref) {
      assert.deepEqual(ref, from)
      return { path: "reading/example.md", text: "---\nkind: text\nvisibility: friends\n---\n\nAlder.", version: "friends-version" }
    },
    async saveBlock(ref, file, replaces) {
      operations.push("save")
      assert.deepEqual(ref, { id: opaqueId, layer: "private", store: "sealed" })
      assert.equal(replaces, null)
      assert.equal(blockOf(file)?.id, from.id)
      assert.equal(blockOf(file)?.visibility, "private")
      return { version: "private-version" }
    },
    async deleteBlock(ref, replaces) {
      operations.push("delete")
      assert.deepEqual(ref, from)
      assert.equal(replaces, "friends-version")
    },
  }, from, { layer: "private", opaqueId }, "friends-version")
  assert.deepEqual(operations, ["save", "delete"])
  assert.equal(result.cleanupPending, false)
})

test("unlocking preserves a Friends search match on its channel path", async () => {
  const did = "did:web:reader.example.test"
  const id = newNodeId()
  let unlocked = false
  const source = createServiceSource({
    origin: "https://workspace.example.test", did,
    privateSession: {
      unlocked: () => unlocked ? { did, master: "fixture-keyring" } : null,
      keys: {
        async openFile() { throw new Error("No sealed fixture files") },
        async sealFile() { throw new Error("Search is read-only") },
        vaultPrivateFiles: () => ({
          list: async () => [],
          get: async () => null,
          replace: async () => { throw new Error("Search is read-only") },
        }),
      },
    },
    fetch: async input => {
      const url = new URL(String(input))
      const method = url.pathname.split(".").at(-1)
      const post = { id, slug: "alder", title: "Alder", label: "reading", sublabel: "journals", visibility: "friends", passage: "A seed." }
      if (method === "searchPosts" && !unlocked) return Response.json({ posts: url.searchParams.get("visibility") === "friends" ? [post] : [] })
      if (method === "getTree") return Response.json({ labels: [{ label: "reading", posts: [], sublabels: [{ sublabel: "journals", posts: [post] }] }] })
      if (method === "listBlocks") return Response.json({ blocks: [], cursor: "1" })
      if (method === "getPost") return Response.json({ post: { ...post, body: "A seed." }, version: "v1" })
      throw new Error(`Unexpected fixture call ${method}`)
    },
  })
  for (const state of [false, true]) {
    unlocked = state
    assert.deepEqual((await source.search({ query: "journals" })).map(hit => hit.id), [id])
  }
})

test("fixture file saves add and remove whole-block links", async () => {
  const sampleSource = createFixtureSource()
  const ref: BlockRef = { id: newNodeId(), layer: "private", store: "sealed" }
  assert.ok(isPostId(ref.id))
  const file = { path: "reading/alder.md", text: "---\nkind: text\nvisibility: private\n---\n\nA seed." }
  const first = await sampleSource.saveBlock(ref, file, null)
  const added = await sampleSource.saveBlock(ref, { ...file, text: setProperty(file.text, "connect", ["garden-of-notes"]) }, first.version)
  const linked = blockOf(await sampleSource.readBlock(ref))
  assert.deepEqual(linked && "properties" in linked ? (linked.properties as Record<string, unknown>).connect : undefined, ["garden-of-notes"])
  const cleared = await sampleSource.saveBlock(ref, file, added.version)
  assert.doesNotMatch((await sampleSource.readBlock(ref)).text, /connect:/)
  await sampleSource.deleteBlock(ref, cleared.version)
})
