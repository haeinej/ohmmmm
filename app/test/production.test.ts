import assert from "node:assert/strict"
import test from "node:test"
import { newNodeId } from "../../vault/vault/node.mjs"
import { createServiceSource, type ServiceOptions } from "../src/data/service-source"
import { CORTEX_CONTEXT, mediaName, type BlockRef } from "../src/data/source"
import { blocks, byId, channelByPath, homeStatus, inbox } from "../src/data/workspace-data"
import { createChannel, declineProposal, deleteChannel, keepProposal, setSource, setVisibility } from "../src/workspace/store"
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

test("readable proposals are kept and declined at the service, sealed ones on the device", async () => {
  const id = newNodeId()
  const { calls, options } = mockService(({ method }) => {
    if (method === "vault.keepProposed") return Response.json({ id, channel: "reading", version: "k1" })
    if (method === "vault.declineProposed") return Response.json({ id, removed: true })
    if (method === "vault.putPrivateBlock") return Response.json({ version: "p2" })
    if (method === "vault.deletePrivateBlock") return Response.json({ removed: true })
    throw new Error(`Unexpected method ${method}`)
  })
  const sealedId = "fixture-opaque-proposal"
  const proposal = { path: "inbox/alder.md", text: "---\nkind: text\nstatus: proposed\nby: agent:claude-code\n---\n\nAlder." }
  let saved: unknown
  const privateSession: ServiceOptions<string, string>["privateSession"] = {
    unlocked: () => ({ did, master: "keyring" }),
    keys: {
      async sealFile(_master, _did, _id, plain) { saved = JSON.parse(new TextDecoder().decode(plain)); return "sealed" },
      async openFile() { return new TextEncoder().encode(JSON.stringify(proposal)) },
      vaultPrivateFiles: ({ fetch, baseUrl }) => ({
        list: async () => [],
        get: async () => ({ id: sealedId, sealed: "sealed", version: "p1" }),
        replace: async ({ id: key, sealed, replaces }) => (await fetch(new URL("xrpc/com.ohmmmm.vault.putPrivateBlock", baseUrl), {
          method: "POST", body: JSON.stringify({ block: { id: key, ciphertext: sealed }, replaces }),
        })).json(),
      }),
    },
  }
  const source = createServiceSource({ ...options, privateSession })
  const readable: BlockRef = { id, layer: "friends", store: "block" }
  assert.deepEqual(await source.inbox.keep(readable, "reading", "v1"), { ref: readable, version: "k1" })
  await source.inbox.decline(readable, "v2")
  const sealed: BlockRef = { id: sealedId, layer: "private", store: "sealed" }
  assert.equal((await source.inbox.keep(sealed, "reading", "p1")).version, "p2")
  assert.deepEqual(saved, { path: "reading/alder.md", text: "---\nkind: text\nby: agent:claude-code\n---\n\nAlder." })
  await assert.rejects(source.inbox.keep(sealed, "reading", "stale"), { code: "Changed" })
  await source.inbox.decline(sealed, "p1")
  assert.deepEqual(calls.map(call => [call.method, call.body]), [
    ["vault.keepProposed", { id, channel: "reading", replaces: "v1" }],
    ["vault.declineProposed", { id, replaces: "v2" }],
    ["vault.putPrivateBlock", { block: { id: sealedId, ciphertext: "sealed" }, replaces: "p1" }],
    ["vault.deletePrivateBlock", { id: sealedId, replaces: "p1" }],
  ])
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
    if (method === "vault.getAgenda") return Response.json({ unlabelled: 2, proposed: 1, waiting: 0, mediaWithoutAlt: 3, counted: "public and friends-only" })
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

test("signed out shows nothing of anyone's home; the inbox keeps and declines through the source", async () => {
  await setSource(null)
  assert.equal(homeStatus(), "signed-out")
  assert.equal(blocks.length, 0)
  await assert.rejects(createChannel(), { name: "InvalidStateError" })
  const fixture = createFixtureSource()
  await setSource(fixture)
  try {
    assert.equal(homeStatus(), "ready")
    assert.deepEqual(inbox.map(item => item.id), [fixtureIds.proposal])
    assert.equal(blocks.some(doc => doc.id === fixtureIds.proposal), false)
    await assert.rejects(keepProposal(fixtureIds.proposal, "inbox"), { name: "DataError" })
    await keepProposal(fixtureIds.proposal, "reading")
    assert.equal(byId(fixtureIds.proposal)?.homeChannel, "reading")
    assert.equal(byId(fixtureIds.proposal)?.status, undefined)
    assert.deepEqual(inbox, [])
    await assert.rejects(declineProposal(fixtureIds.proposal), { name: "NotFoundError" })
    // Public is reached only through Publish.
    await assert.rejects(setVisibility(fixtureIds.address, "public"), { name: "NotSupportedError" })
    const path = await createChannel()
    assert.ok(channelByPath(path)?.version)
    await deleteChannel(path)
    assert.equal(channelByPath(path), undefined)
  } finally {
    await setSource(null)
  }
})

test("declining a proposal removes it at the source", async () => {
  const fixture = createFixtureSource()
  await setSource(fixture)
  try {
    await declineProposal(fixtureIds.proposal)
    assert.deepEqual(inbox, [])
    assert.equal(fixture.listBlocks().some(head => head.id === fixtureIds.proposal), false)
  } finally {
    await setSource(null)
  }
})
