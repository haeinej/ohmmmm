import assert from "node:assert/strict"
import test from "node:test"
import { createFixtureSource, fixtureIds } from "./fixtures/fixture-source"
import { blockKey, byId, channelByPath, channelRowId, docIdOf, journalOf, placedIn } from "../src/data/workspace-data"
import { buildGraph } from "../src/graph/model"
import { isPostId } from "../../vault/vault/file.mjs"
import { search } from "../src/data/search"
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
