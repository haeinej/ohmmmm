import assert from "node:assert/strict"
import test from "node:test"
import { newNodeId } from "../../vault/vault/node.mjs"
import { createServiceSource, type ServiceOptions } from "../src/data/service-source"
import { createLocalSource } from "../src/data/local-source"
import { blockOf, emptyPlan, type BlockRef } from "../src/data/source"
import { setSource } from "../src/workspace/store"
import { byId, getSource, workspaceEvidence } from "../src/data/workspace-data"

const did = "did:web:member.example.test"
const origin = "https://workspace.example.test"
type Call = { method: string; verb: string; query: Record<string, string>; body?: unknown }

function mockService(reply: (call: Call) => Response) {
  const calls: Call[] = []
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(String(input))
    assert.equal(url.origin, origin)
    assert.ok(url.pathname.startsWith("/vault/xrpc/com.ohmmmm."))
    assert.equal(init?.credentials, "same-origin")
    const method = url.pathname.replace("/vault/xrpc/com.ohmmmm.", "")
    assert.equal(new Headers(init?.headers).get("X-Ohm-Did"), method === "account.get" ? null : did)
    const call = {
      method, verb: init?.method ?? "GET", query: Object.fromEntries(url.searchParams),
      ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}),
    }
    calls.push(call)
    return reply(call)
  }
  return { calls, options: { did, origin, fetch } }
}

test("post reads, replacements and deletes use the post XRPC path and CAS version", async () => {
  const id = newNodeId()
  const post = { id, label: "reading", slug: "example", sublabel: "", title: "Example", visibility: "public", body: "A synthetic post." }
  const { calls, options } = mockService(({ method }) => {
    if (method === "vault.getPost") return Response.json({ post, version: "first" })
    if (method === "vault.putPost") return Response.json({ version: "next" })
    if (method === "vault.deletePost") return Response.json({ removed: true })
    throw new Error(`Unexpected method ${method}`)
  })
  const source = createServiceSource(options)
  const ref: BlockRef = { id, layer: "public", store: "post" }
  const file = await source.readBlock(ref)
  assert.equal(file.path, "reading/example.md")
  assert.equal(blockOf(file)?.kind, "post")
  assert.equal(file.version, "first")
  const updated = { ...file, text: file.text.replace("A synthetic post.", "Revised.") }
  const { version } = await source.saveBlock(ref, updated, file.version)
  await source.deleteBlock(ref, version)
  assert.deepEqual(calls, [
    { method: "vault.getPost", verb: "GET", query: { id } },
    { method: "vault.putPost", verb: "POST", query: {}, body: { post: { ...post, body: "Revised.", properties: {} }, replaces: "first" } },
    { method: "vault.deletePost", verb: "POST", query: {}, body: { id, replaces: "next" } },
  ])
})

test("private deletion and kept versions require unlock, and version reads open ciphertext locally", async () => {
  const id = "fixture-opaque-private-file"
  const ref: BlockRef = { id, layer: "private", store: "sealed" }
  const file = { path: "journal/example.md", text: "---\nkind: text\n---\n\nA synthetic retained block." }
  const versions = [{ rev: 7, version: "previous", created: "2026-11-01" }]
  const { calls, options } = mockService(({ method }) => {
    if (method === "vault.listPrivateVersions") return Response.json({ versions })
    if (method === "vault.getPrivateVersion") return Response.json({ ciphertext: "sealed-version" })
    if (method === "vault.deletePrivateBlock") return Response.json({ removed: true })
    throw new Error(`Unexpected method ${method}`)
  })
  let unlocked = false
  const privateSession: ServiceOptions<string, string>["privateSession"] = {
    unlocked: () => unlocked ? { did, master: "fixture-keyring" } : null,
    keys: {
      async openFile(master, member, key, sealed) {
        assert.deepEqual([master, member, key, sealed], ["fixture-keyring", did, id, "sealed-version"])
        return new TextEncoder().encode(JSON.stringify(file))
      },
      async sealFile() { throw new Error("Unexpected sealing") },
      vaultPrivateFiles: () => ({
        list: async () => [],
        get: async () => null,
        replace: async () => { throw new Error("Unexpected replacement") },
      }),
    },
  }
  const source = createServiceSource({ ...options, privateSession })
  await assert.rejects(source.history(ref), { code: "PrivateLocked" })
  await assert.rejects(source.readVersion(ref, 7), { code: "PrivateLocked" })
  await assert.rejects(source.deleteBlock(ref, "current"), { code: "PrivateLocked" })
  assert.deepEqual(calls, [])
  unlocked = true
  assert.deepEqual(await source.history(ref), versions)
  assert.deepEqual(await source.readVersion(ref, 7), file)
  await source.deleteBlock(ref, "current")
  assert.deepEqual(calls, [
    { method: "vault.listPrivateVersions", verb: "GET", query: { id } },
    { method: "vault.getPrivateVersion", verb: "GET", query: { id, rev: "7" } },
    { method: "vault.deletePrivateBlock", verb: "POST", query: {}, body: { id, replaces: "current" } },
  ])
})

test("publish plan preparation and friend removal use the member session and surface AccountChanged", async () => {
  const friend = "did:web:friend.example.test"
  const plan = { ...emptyPlan(), plan: "synthetic-preview" }
  let changed = false
  const { calls, options } = mockService(({ method }) => {
    if (changed) return Response.json({ error: "AccountChanged", message: "The signed-in account changed." }, { status: 409 })
    return Response.json(method === "vault.getPublishPlan" ? plan : { removed: true })
  })
  const source = createServiceSource(options)
  assert.deepEqual(await source.publishPlan(), plan)
  assert.deepEqual(await source.publishPlan(true), plan)
  await source.removeFriend(friend)
  changed = true
  await assert.rejects(source.removeFriend(friend), { code: "AccountChanged", message: "The signed-in account changed." })
  assert.deepEqual(calls, [
    { method: "vault.getPublishPlan", verb: "GET", query: {} },
    { method: "vault.getPublishPlan", verb: "GET", query: { prepare: "1" } },
    { method: "vault.removeFriend", verb: "POST", query: {}, body: { did: friend } },
    { method: "vault.removeFriend", verb: "POST", query: {}, body: { did: friend } },
  ])
})

test("the workspace can select a service and project its blocks and evidence", async () => {
  const id = newNodeId()
  const post = { id, label: "reading", slug: "example", title: "Service fixture", visibility: "public", body: "See [example](https://example.test)." }
  const { options } = mockService(({ method }) => {
    if (method === "account.get") return Response.json({ did, user: { name: "Example" }, mirrored: false, service: null })
    if (method === "vault.getTree") return Response.json({ labels: [{ label: "reading", posts: [post], sublabels: [] }] })
    if (method === "vault.listBlocks") return Response.json({ blocks: [], cursor: "0" })
    if (method === "vault.getPost") return Response.json({ post, version: "one" })
    throw new Error(`Unexpected method ${method}`)
  })
  const original = getSource()
  try {
    await setSource({ service: options })
    assert.notEqual(getSource(), original)
    assert.equal(byId(id)?.title, "Service fixture")
    assert.ok(workspaceEvidence().some(edge => edge.from === `block:${id}` && edge.to === "url:https://example.test"))
  } finally {
    await setSource()
  }
  assert.equal(getSource(), original)
  assert.equal(byId(id), undefined)
})

test("the local source needs a paired bridge before it reads anything", async () => {
  await assert.rejects(createLocalSource(null as never), { name: "NotFoundError" })
})
