import assert from "node:assert/strict"
import test from "node:test"
import { newNodeId } from "../../vault/vault/node.mjs"
import { createServiceSource, type ServiceOptions } from "../src/data/service-source"
import { CORTEX_CONTEXT, mediaName, type BlockRef } from "../src/data/source"
import { blocks, byId, channelByPath, homeStatus } from "../src/data/workspace-data"
import { createChannel, deleteChannel, setSource, setVisibility } from "../src/workspace/store"
import { createFixtureSource, fixtureIds } from "./fixtures/fixture-source"

const did = "did:web:member.example.test"
const origin = "https://workspace.example.test"
type Call = { method: string; verb: string; query: Record<string, string>; body?: unknown; type?: string | null }

function mockService(reply: (call: Call) => Response) {
  const calls: Call[] = []
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(String(input))
    assert.equal(url.origin, origin)
    const method = url.pathname.replace("/vault/xrpc/com.ohmmmm.", "")
    assert.equal(new Headers(init?.headers).get("X-Ohm-Did"), method === "account.get" ? null : did)
    const raw = init?.body instanceof Uint8Array
    const call: Call = {
      method, verb: init?.method ?? "GET", query: Object.fromEntries(url.searchParams),
      ...(init?.body ? { body: raw ? [...init.body as Uint8Array] : JSON.parse(String(init.body)) } : {}),
      ...(raw ? { type: new Headers(init?.headers).get("Content-Type") } : {}),
    }
    calls.push(call)
    return reply(call)
  }
  return { calls, options: { did, origin, fetch } }
}

test("channels are read, saved, moved and removed as _channel.md files with their versions", async () => {
  const { calls, options } = mockService(({ method }) => {
    if (method === "vault.listChannels") return Response.json({ channels: [{ path: "reading", version: "c1" }, { path: "gone", removed: true }], cursor: "2" })
    if (method === "vault.getChannel") return Response.json({ channel: { path: "reading", text: "---\ntitle: Reading\n---\n" }, version: "c1" })
    if (method === "vault.putChannel") return Response.json({ path: "reading", version: "c2" })
    if (method === "vault.moveChannel") return Response.json({ from: "reading", to: "books", channels: 1, blocks: 3 })
    if (method === "vault.deleteChannel") return Response.json({ path: "books", removed: true })
    throw new Error(`Unexpected method ${method}`)
  })
  const source = createServiceSource(options)
  assert.deepEqual(await source.channels.list(), [{ path: "reading", version: "c1", title: undefined, kind: undefined }])
  assert.equal((await source.channels.read("reading")).version, "c1")
  assert.deepEqual(await source.channels.save({ path: "reading/_channel.md", text: "---\ntitle: Books\n---\n" }, "c1"), { version: "c2" })
  assert.equal((await source.channels.move("reading", "books", "c2")).blocks, 3)
  await source.channels.remove("books", "c3")
  assert.deepEqual(calls.slice(2), [
    { method: "vault.putChannel", verb: "POST", query: {}, body: { channel: { path: "reading", text: "---\ntitle: Books\n---\n" }, replaces: "c1" } },
    { method: "vault.moveChannel", verb: "POST", query: {}, body: { from: "reading", to: "books", replaces: "c2" } },
    { method: "vault.deleteChannel", verb: "POST", query: {}, body: { path: "books", replaces: "c3" } },
  ])
})

test("the service source has no inbox: no keep or decline requests", () => {
  const { options } = mockService(({ method }) => { throw new Error(`Unexpected method ${method}`) })
  const source = createServiceSource(options) as unknown as Record<string, unknown>
  assert.equal(source.inbox, undefined)
})

test("the cortex refuses until the keys can seal under its own context, then seals every file and journal entry under it", async () => {
  const id = "fixture-opaque-cortex-file"
  const file = { path: "observations/alder.md", text: "---\nby: claude-code\n---\n\nAlder." }
  const { calls, options } = mockService(({ method }) => {
    if (method === "cortex.listFiles") return Response.json({ blocks: [{ id, version: "f1" }], cursor: "1" })
    if (method === "cortex.getFile") return Response.json({ id, ciphertext: "sealed-file", version: "f1" })
    if (method === "cortex.putFile") return Response.json({ id, version: "f2" })
    if (method === "cortex.listJournal") return Response.json({ entries: [{ seq: 1, entry: "sealed-entry", created: "2026-11-23" }], cursor: "1" })
    throw new Error(`Unexpected method ${method}`)
  })
  const sealedWith: { id: string; context?: string }[] = []
  const keys: NonNullable<ServiceOptions<string, string>["privateSession"]>["keys"] = {
    async sealFile(_master, _did, key, _plain, seal) { sealedWith.push({ id: key, context: seal?.context }); return `sealed-${key}` },
    async openFile(_master, _did, key, _sealed, seal) {
      assert.equal(seal?.context, CORTEX_CONTEXT)
      return new TextEncoder().encode(JSON.stringify(key === "journal" ? { by: "claude-code", op: "create" } : file))
    },
    vaultPrivateFiles: () => ({ list: async () => [], get: async () => null, replace: async () => ({}) }),
  }
  const unlocked = () => ({ did, master: "keyring" })
  const without = createServiceSource({ ...options, privateSession: { unlocked, keys } })
  await assert.rejects(without.cortex.list(), { code: "CortexKeysMissing" })
  await assert.rejects(without.cortex.save(id, file, null), { code: "CortexKeysMissing" })
  assert.equal(calls.length, 0)
  const source = createServiceSource({ ...options, privateSession: { unlocked, keys: { ...keys, CORTEX_CONTEXT } } })
  assert.deepEqual(await source.cortex.list(), [{ id, version: "f1", ...file }])
  assert.deepEqual(await source.cortex.save(id, file, "f1", { by: "you", op: "edit" }), { version: "f2" })
  assert.deepEqual(sealedWith, [{ id, context: CORTEX_CONTEXT }, { id: "journal", context: CORTEX_CONTEXT }])
  assert.deepEqual(calls.at(-1)?.body, { file: { id, ciphertext: `sealed-${id}` }, replaces: "f1", journal: "sealed-journal" })
  assert.deepEqual((await source.cortex.journal())[0].entry, { by: "claude-code", op: "create" })
})

test("media bytes go to the cache raw under their content address; the agenda is the service's counts", async () => {
  const bytes = new TextEncoder().encode("a small picture") as Uint8Array<ArrayBuffer>
  const name = await mediaName(bytes)
  const { calls, options } = mockService(({ method }) => {
    if (method === "media.putMedia") return Response.json({ name, size: bytes.byteLength })
    if (method === "media.hasMedia") return Response.json({ present: [name] })
    if (method === "media.getRendition") return new Response("smaller", { headers: { "Content-Type": "image/webp" } })
    if (method === "vault.getAgenda") return Response.json({ unlabelled: 2, mediaWithoutAlt: 3, counted: "public and friends-only" })
    throw new Error(`Unexpected method ${method}`)
  })
  const source = createServiceSource(options)
  assert.deepEqual(await source.media.put(bytes, "image/png"), { name, size: bytes.byteLength })
  assert.deepEqual(await source.media.has([name, "sha256-00"]), [name])
  assert.equal(await (await source.media.rendition(name, 480)).text(), "smaller")
  assert.equal((await source.agenda()).mediaWithoutAlt, 3)
  assert.deepEqual(calls[0], { method: "media.putMedia", verb: "POST", query: { name }, body: [...bytes], type: "image/png" })
  assert.deepEqual(calls[2].query, { name, width: "480" })
})

test("signed out shows nothing of anyone's home; an agent's block is an ordinary block, private and marked as the agent's", async () => {
  await setSource(null)
  assert.equal(homeStatus(), "signed-out")
  assert.equal(blocks.length, 0)
  await assert.rejects(createChannel(), { name: "InvalidStateError" })
  const fixture = createFixtureSource()
  await setSource(fixture)
  try {
    assert.equal(homeStatus(), "ready")
    const agents = byId(fixtureIds.byAgent)
    assert.equal(blocks.some(doc => doc.id === fixtureIds.byAgent), true)
    assert.deepEqual([agents?.homeChannel, agents?.by, agents?.visibility, agents?.status], ["reading", "agent:claude-code", "private", undefined])
    // Public is reached only through Publish: the move marks it and hands over to the Publish page.
    assert.match((await setVisibility(fixtureIds.address, "public")).publish ?? "", /\?publish=/)
    const path = await createChannel()
    assert.ok(channelByPath(path)?.version)
    await deleteChannel(path)
    assert.equal(channelByPath(path), undefined)
  } finally {
    await setSource(null)
  }
})

test("saving keeps every property the workspace doesn't edit, for blocks and cortex files", async () => {
  const { fileOf } = await import("../src/data/block-document")
  const { cortexDocOf, cortexFileOf } = await import("../src/data/cortex-document")
  const { docOf } = await import("../src/data/block-document")
  const ref: BlockRef = { id: newNodeId(), layer: "friends", store: "block" }
  const base = { path: "photos/dusk.md", text: "---\nkind: media\ntitle: Dusk\nvisibility: friends\norigin: /photos/dusk.jpg\nhash: sha256-ab\nalt: A street at dusk\ncreated: 2026-09-16\ntags: [street]\n---\n\nThe same street, later.\n" }
  const doc = { ...docOf(ref, base).doc, icon: "🌆", body: "The same street, much later." }
  const saved = fileOf(doc, base)
  for (const kept of ["origin: /photos/dusk.jpg", "hash: sha256-ab", "alt: A street at dusk", "created: 2026-09-16", "tags:"]) assert.ok(saved.text.includes(kept), kept)
  assert.match(saved.text, /icon: /)
  assert.match(saved.text, /\n\nThe same street, much later\.\n$/)
  const observation = { id: "fixture-opaque-observation", version: "o1", path: "observations/dusk.md", text: "---\nby: claude-code\nsession: s-12\nevidence: [block:abc@v1]\n---\n\nShe walks at dusk.\n" }
  const changed = cortexFileOf({ ...cortexDocOf(observation)!, body: "She walks at dusk, often." }, observation)
  assert.ok(changed.text.includes("session: s-12") && changed.text.includes("evidence:"))
  assert.equal(changed.path, "observations/dusk.md")
})

test("ordering and moving channels stay inside what the screen and the layers allow", async () => {
  const fixture = createFixtureSource()
  await setSource(fixture)
  try {
    const { moveBlock } = await import("../src/workspace/store")
    // Only readable slugs go into a channel's readable order; a private block's place is not written there.
    const result = await moveBlock(fixtureIds.monday, "writing/journal", "writing/journal", { before: fixtureIds.garden })
    assert.equal(result.ordered, false)
    await moveBlock(fixtureIds.tokyoTwo, "photos/tokyo", "photos/tokyo", { before: fixtureIds.tokyo })
    const order = (await fixture.channels.read("photos/tokyo")).text
    assert.match(order, /order:/)
    const privateSlugs = blocks.filter(doc => doc.visibility === "private").map(doc => doc.slug)
    for (const slug of privateSlugs) assert.ok(!order.includes(slug), slug)
  } finally {
    await setSource(null)
  }
})

test("with the private layer locked, channel moves and removals are refused, and a reload keeps this device's history", async () => {
  const fixture = createFixtureSource()
  const locked = { ...fixture, listBlocks: (layers?: readonly ("public" | "friends" | "private")[]) => {
    if (layers?.includes("private")) throw Object.assign(new Error("Unlock this account's private vault on this device."), { code: "PrivateLocked" })
    return fixture.listBlocks(layers)
  } }
  await setSource(locked)
  try {
    const { privateLayer } = await import("../src/data/workspace-data")
    assert.equal(privateLayer, "locked")
    const { renameChannel, deleteChannel: remove } = await import("../src/workspace/store")
    await assert.rejects(renameChannel("photos", "pictures"), { name: "InvalidStateError" })
    await assert.rejects(remove("reading"), { name: "InvalidStateError" })
  } finally {
    await setSource(null)
  }
  await setSource(fixture)
  try {
    const { journalOf } = await import("../src/data/workspace-data")
    const { collect, reload } = await import("../src/workspace/store")
    await collect(fixtureIds.garden, "reading")
    const mine = journalOf().linesFor(fixtureIds.garden).at(-1)!
    await reload()
    assert.equal(journalOf().changeById(mine.id)?.after, mine.after)
    assert.ok(journalOf().snapshotAt(mine.after))
  } finally {
    await setSource(null)
  }
})

test("one unreadable file is left out; the rest of the home opens", async () => {
  const fixture = createFixtureSource()
  const flaky = { ...fixture, readBlock: (ref: BlockRef) => {
    if (ref.id === fixtureIds.garden) throw new Error("The post changed visibility. Refresh the vault.")
    return fixture.readBlock(ref)
  } }
  await setSource(flaky)
  try {
    const { unreadable } = await import("../src/data/workspace-data")
    assert.equal(homeStatus(), "ready")
    assert.equal(unreadable, 1)
    assert.equal(byId(fixtureIds.garden), undefined)
    assert.ok(byId(fixtureIds.slow))
  } finally {
    await setSource(null)
  }
})
