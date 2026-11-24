import assert from "node:assert/strict"
import test from "node:test"
import { createFixtureSource, fixtureIds } from "./fixtures/fixture-source"
import { blockKey, byId, channelByPath, channelRowId, docIdOf, journalOf, placedIn } from "../src/data/workspace-data"
import { buildGraph } from "../src/graph/model"
import { isPostId } from "../../vault/vault/file.mjs"
import { search } from "../src/data/search"
import { createServiceSource } from "../src/data/service-source"
import { blockOf, type BlockRef, type HomeFile } from "../src/data/source"
import { collect, createDraft, deleteDoc, moveBlock, restoreVersion, saveDraft, setSource } from "../src/workspace/store"
import { newNodeId } from "../../vault/vault/node.mjs"

test("the workspace edits and collects blocks through the same data source search reads", async () => {
  const sampleSource = createFixtureSource()
  await setSource(sampleSource)
  const draft = await createDraft({ title: "A synthetic reading list" })
  try {
    await saveDraft({ body: "Alder lantern." })
    await collect(draft.id, "reading")
    const ref = (await sampleSource.listBlocks(["private"])).find(block => block.id === draft.id)!
    assert.equal(ref.layer, "private")
    const file = await sampleSource.readBlock(ref)
    assert.equal(blockOf(file)?.body.trim(), "Alder lantern.")
    assert.ok(blockOf(file)?.channels.includes("reading"))
    assert.equal((await search({ query: "Alder lantern" }))[0].id, draft.id)
    assert.ok((await sampleSource.history(ref)).length)
    const ordered = (await sampleSource.vault()).items("reading")
    assert.ok(ordered.some(block => "slug" in block && block.slug === "a-synthetic-reading-list"))
    const change = { path: file.path, text: file.text.replace("Alder lantern.", "Alder lantern and river.") }
    const { version } = await sampleSource.saveBlock(ref, change, file.version)
    assert.notEqual(version, file.version)
    assert.throws(() => sampleSource.saveBlock(ref, file, file.version), /changed/)
    assert.throws(() => sampleSource.deleteBlock(ref, file.version), /changed/)
    assert.equal((await search({ query: "Alder lantern and river" }))[0].id, draft.id)
  } finally {
    await setSource(sampleSource)
    await deleteDoc(draft.id)
    assert.deepEqual(await search({ query: "Alder lantern" }), [])
    await setSource()
  }
})

test("draft kinds, history and channel moves keep one sealed ID and one vault TID across placements", async () => {
  const sampleSource = createFixtureSource()
  await setSource(sampleSource)
  const draft = await createDraft({ homeChannel: "writing/journal", title: "Alder lantern" })
  try {
    assert.match(draft.id, /^[A-Za-z0-9_-]{16,64}$/)
    assert.ok(isPostId(byId(draft.id)?.vaultId))
    assert.equal(byId(draft.id)?.kind, "text")
    const initial = journalOf().currentVersion(draft.id)!
    await saveDraft({ body: "https://example.test/alder-lantern" })
    assert.equal(byId(draft.id)?.kind, "link")
    const row = channelRowId(draft.id, "projects/tools")
    assert.equal(docIdOf(row), draft.id)
    assert.equal(placedIn(row), "projects/tools")
    assert.ok((await moveBlock(draft.id, "writing/journal", "projects/tools")).homeChannelChanged)
    assert.equal(byId(draft.id)?.homeChannel, "projects/tools")
    assert.ok((await sampleSource.connections()).some(edge =>
      edge.kind === "contains" && edge.from === `channel:${channelByPath("projects/tools")!.id}` && edge.to === blockKey(byId(draft.id)!.vaultId!)))
    await restoreVersion(draft.id, initial)
    assert.equal(byId(draft.id)?.homeChannel, "writing/journal")
    assert.equal(byId(draft.id)?.kind, "text")
  } finally {
    await setSource()
  }
})

test("vault evidence and cortex observations refer to the same block keys, and observed edges are drawn apart", async () => {
  const sampleSource = createFixtureSource()
  await setSource(sampleSource)
  try {
    const evidence = await sampleSource.connections()
    const garden = blockKey(fixtureIds.garden)
    assert.ok(evidence.some(edge => edge.from === garden && edge.to === blockKey(fixtureIds.slow) && edge.kind === "links"))
    assert.ok(evidence.some(edge => edge.from === garden && edge.kind === "mentions" && edge.to.startsWith("entity:")))
    const graph = buildGraph()
    // Nodes are blocks only; the cortex is off by default.
    assert.ok(graph.nodes.some(node => node.id === garden))
    assert.ok(graph.nodes.every(node => node.root === "vault"))
    // People a block mentions and channels are not drawn; every edge is a connect between blocks.
    assert.ok(graph.edges.every(edge => edge.source.startsWith("block:") && edge.target.startsWith("block:")))
    assert.ok(graph.labels.some(label => label.name === "writing"))
    assert.ok((graph.nodes.find(node => node.id === blockKey(fixtureIds.slow))?.backlinks ?? 0) >= 2)
    const observation = byId(fixtureIds.slowness)!
    assert.equal(observation.kind, "observation")
    assert.deepEqual(observation.about, [fixtureIds.slow, fixtureIds.tokyo, fixtureIds.dusk])
    // An observation about blocks is an observed edge of its own, never merged with one the person made.
    const pair = [blockKey(fixtureIds.slow), blockKey(fixtureIds.tokyo)].sort().join()
    const between = graph.edges.filter(each => [each.source, each.target].sort().join() === pair)
    assert.equal(between.length, 2)
    assert.deepEqual(between.find(each => each.observed)?.observed, [observation.title])
    assert.ok(between.some(each => !each.observed))
    assert.equal(graph.nodes.some(node => node.doc.id === observation.id), false)
    const withCortex = buildGraph({ cortex: true })
    assert.ok(withCortex.nodes.some(node => node.root === "cortex" && node.doc.kind === "skill"))
    assert.ok(journalOf().historyLines("cortex").some(line => line.type === "change" && line.node === observation.id))
    assert.ok(journalOf().historyLines("vault").some(line => line.type === "change" && line.node === fixtureIds.garden))
    assert.ok(journalOf().historyLines("vault").every(line => line.type !== "change" || line.node !== observation.id))
    assert.equal((await search({ query: "June", scope: "entities" }))[0]?.kind, "entity")
  } finally {
    await setSource()
  }
})

test("member service reads use the signed-in DID and shared reads request a scoped service token", async () => {
  const did = "did:web:reader.example.test"
  const owner = "did:web:owner.example.test"
  const id = newNodeId()
  const calls: { method: string; search: URLSearchParams; headers: Headers; body?: unknown }[] = []
  const source = createServiceSource({
    origin: "https://workspace.example.test", did,
    sharedServiceToken: async method => {
      assert.equal(method, "com.ohmmmm.vault.listShared")
      return "fixture-reader-token"
    },
    fetch: async (input, init) => {
      const url = new URL(String(input))
      assert.equal(url.origin, "https://workspace.example.test")
      assert.equal(init?.credentials, "same-origin")
      const method = url.pathname.replace("/vault/xrpc/com.ohmmmm.", "")
      calls.push({ method, search: url.searchParams, headers: new Headers(init?.headers), body: init?.body && JSON.parse(String(init.body)) })
      if (method === "account.get") return Response.json({ did, user: { name: "Example" }, mirrored: false, service: null })
      if (method === "vault.getTree") return Response.json({ labels: [{ label: "reading", sublabels: [], posts: [{ id, slug: "example", visibility: "public" }] }] })
      if (method === "vault.listBlocks") return Response.json({ blocks: [], cursor: "1" })
      if (method === "vault.putBlock") return Response.json({ error: "Changed", message: "Read the current version." }, { status: 409 })
      if (method === "vault.listShared") return Response.json({ blocks: [{ id, path: "reading/example.md", kind: "text", version: "v1" }] })
      throw new Error(`Unexpected fixture call ${method}`)
    },
  })
  assert.equal((await source.account()).did, did)
  assert.equal((await source.listBlocks())[0].path, "reading/example.md")
  assert.equal((await source.listShared(owner))[0].id, id)
  const ref: BlockRef = { id, layer: "friends", store: "block" }
  const file = { path: "reading/example.md", text: "---\nkind: text\nvisibility: friends\n---\n\nExample." }
  await assert.rejects(source.saveBlock(ref, file, "superseded"), { code: "Changed" })
  await assert.rejects(source.saveBlock(ref, { ...file, text: file.text.replace("friends", "private") }, null), { code: "InvalidFile" })
  assert.deepEqual(calls.map(call => call.method), ["account.get", "vault.getTree", "vault.listBlocks", "vault.listShared", "vault.putBlock"])
  assert.equal(calls[0].headers.get("X-Ohm-Did"), null)
  assert.ok(calls.slice(1).every(call => call.headers.get("X-Ohm-Did") === did))
  assert.equal(calls[3].search.get("owner"), owner)
  assert.equal(calls[3].headers.get("Authorization"), "Bearer fixture-reader-token")
  assert.deepEqual(calls[4].body, { block: { id, ...file }, replaces: "superseded" })
})

test("private browser files require unlock and only sealed data crosses the service boundary", async () => {
  const did = "did:web:member.example.test"
  const id = "fixture-opaque-private-file"
  const ref: BlockRef = { id, store: "sealed", layer: "private" }
  const file: HomeFile = { path: "journal/example.md", text: "---\nkind: text\n---\n\nAn example private orchard." }
  let session: { did: string; master: string } | null = null
  let stored: Uint8Array | undefined
  let networkCalls = 0
  const source = createServiceSource({
    origin: "https://workspace.example.test", did,
    privateSession: {
      unlocked: () => session,
      keys: {
        async sealFile(master, owner, key, plain) {
          assert.deepEqual([master, owner, key], ["test-keyring", did, id])
          stored = plain
          return "sealed-fixture"
        },
        async openFile(master, owner, key, sealed) {
          assert.deepEqual([master, owner, key, sealed], ["test-keyring", did, id, "sealed-fixture"])
          return stored!
        },
        vaultPrivateFiles({ baseUrl, fetch }) {
          assert.equal(baseUrl, "https://workspace.example.test/vault/")
          return {
            list: async () => [],
            get: async () => ({ id, sealed: "sealed-fixture", version: "v1" }),
            replace: async ({ id, sealed, replaces }) => {
              const response = await fetch(new URL("xrpc/com.ohmmmm.vault.putPrivateBlock", baseUrl), {
                method: "POST",
                body: JSON.stringify({ block: { id, ciphertext: sealed }, replaces }),
              })
              return response.json()
            },
          }
        },
      },
    },
    fetch: async (input, init) => {
      networkCalls++
      assert.match(String(input), /\/vault\/xrpc\/com\.ohmmmm\.vault\.putPrivateBlock$/)
      assert.equal(new Headers(init?.headers).get("X-Ohm-Did"), did)
      assert.deepEqual(JSON.parse(String(init?.body)), { block: { id, ciphertext: "sealed-fixture" }, replaces: null })
      return Response.json({ version: "v1" })
    },
  })
  await assert.rejects(source.readBlock(ref), { code: "PrivateLocked" })
  await assert.rejects(source.saveBlock(ref, file, null), { code: "PrivateLocked" })
  assert.equal(networkCalls, 0)
  session = { did, master: "test-keyring" }
  assert.deepEqual(await source.saveBlock(ref, file, null), { version: "v1" })
  assert.deepEqual(await source.readBlock(ref), { ...file, version: "v1" })
  assert.equal(networkCalls, 1)
})
