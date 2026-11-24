// The home on this computer, through `ohmmmm serve`, as the workspace's source (src/data/local-source.ts):
// a working copy read once through the bridge, edited at once, and written back only over the version
// read, merging into each file so nothing the workspace does not know is lost. Every person is invented.
import assert from "node:assert/strict"
import test from "node:test"
import { blobCid } from "../../vault/vault/core.mjs"
import { readProperties, splitFile } from "../../vault/vault/file.mjs"
import { createLocalSource, mergeFile } from "../src/data/local-source"
import { byId, bySlug, channelRecords } from "../src/data/workspace-data"
import { memoryBackend, setMediaBackend } from "../src/media/cache"
import { addImage, autosave, collect, createDraft, deleteDoc, moveBlock, open, saveDraft, setSource } from "../src/workspace/store"

const TID = "3m2zx5u6ifk2a"
const bridge = { url: "http://127.0.0.1:8766", token: "QexdqYGJ2FZs7RkxcsaXaQMMXE0wJv3TqcHALTiddso" }
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), c => c.charCodeAt(0))
const props = (text: string) => readProperties(splitFile(text).head).properties as Record<string, unknown>

/** A bridge over files kept in memory, answering as home/serve.mjs does, with real versions. */
function fakeHome(initial: Record<string, string>) {
  const disk = new Map(Object.entries(initial))
  const calls: string[] = []
  const version = (text: string) => blobCid(new TextEncoder().encode(text))
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
  const fetch = (async (input: string, init: RequestInit = {}) => {
    const url = new URL(input)
    const headers = init.headers as Record<string, string>
    assert.equal(headers.Authorization, `Bearer ${bridge.token}`)
    const method = init.method ?? "GET"
    calls.push(`${method} ${url.pathname}${url.search ? `?${url.searchParams.get("path") ?? url.searchParams.get("channel")}` : ""}`)
    if (url.pathname === "/vault/files") {
      return json(200, { home: "mira.example.com", files: await Promise.all([...disk].filter(([path]) => path.endsWith(".md")).map(async ([path, text]) => ({ path, text, version: await version(text) }))) })
    }
    if (url.pathname === "/vault/file") {
      const path = url.searchParams.get("path")!
      const now = disk.has(path) ? await version(disk.get(path)!) : null
      const said = headers["If-Match"]?.replace(/"/g, "") ?? (headers["If-None-Match"] === "*" ? null : undefined)
      if (said === undefined) return json(428, { error: "Say which version" })
      if (said !== now) return json(412, { error: "The file changed since it was read", version: now })
      if (method === "DELETE") { disk.delete(path); return json(200, { path, removed: true }) }
      disk.set(path, String(init.body))
      return json(now ? 200 : 201, { path, version: await version(String(init.body)), created: !now })
    }
    const media = /^\/media\/(.+)$/.exec(url.pathname)
    if (media && method === "PUT") {
      const q = url.searchParams
      assert.equal(await blobCid(init.body as Uint8Array), media[1])
      const path = `${q.get("channel")}/${q.get("slug")}.md`
      const text = `---\nkind: media\ntitle: ${q.get("title")}\nalt: ${q.get("alt")}\nhash: ${media[1]}\nmime: image/png\nid: ${q.get("id")}\n---\n\n![[${q.get("name")}]]\n`
      disk.set(`${q.get("channel")}/${q.get("name")}`, "bytes")
      disk.set(path, text)
      return json(201, { created: true, path, text, version: await version(text) })
    }
    return json(404, { error: "Not here" })
  }) as unknown as typeof globalThis.fetch
  return { disk, calls, fetch }
}

const HOME = {
  "notes/walk.md": `---\ntitle: Slow walk\nmood: calm\norigin: /Users/mira/old/walk.md\ntags: [yanaka, cats]\nid: ${TID}\n---\n\nYanaka, lanterns, cats.\n`,
  "notes/no-id.md": "Just a line, with no properties.\n",
  "notes/_channel.md": "---\ntitle: Notes\nkept: yes\n---\n\nWhat I notice.\n",
  "essays/on-rain.md": "---\ntitle: On rain\nvisibility: public\n---\n\nA published essay.\n",
}

async function withHome(t: test.TestContext, files: Record<string, string> = HOME) {
  const home = fakeHome(files)
  const realFetch = globalThis.fetch
  globalThis.fetch = home.fetch
  const problems: string[] = []
  const source = await createLocalSource(bridge, { onProblem: message => { problems.push(message) } })
  await setSource(source)
  t.after(async () => { globalThis.fetch = realFetch; await setSource() })
  return { ...home, source, problems }
}

test("the merge keeps every property the workspace does not know, their order, and the file's own form", () => {
  const original = HOME["notes/walk.md"]
  const written = `---\nkind: text\ntitle: Slow walk in the rain\nslug: walk\nvisibility: private\nupdated: 2026-11-24\nid: ${TID}\n---\n\nYanaka in the rain.\n`
  const merged = mergeFile(original, "notes/walk.md", written, "private")
  assert.equal(merged, `---\ntitle: Slow walk in the rain\nmood: calm\norigin: /Users/mira/old/walk.md\ntags: [yanaka, cats]\nid: ${TID}\nupdated: 2026-11-24\n---\n\nYanaka in the rain.\n`)
  // A file with no properties gains only what changed; kind and visibility it already says are not written.
  const plain = mergeFile(HOME["notes/no-id.md"], "notes/no-id.md", "---\nkind: text\ntitle: A line\nvisibility: private\n---\n\nJust a line, changed.\n", "private")
  assert.equal(plain, "---\ntitle: A line\n---\n\nJust a line, changed.\n")
  // A kind the body does not imply is written.
  assert.equal(props(mergeFile(HOME["notes/no-id.md"], "notes/no-id.md", "---\nkind: excerpt\n---\n\nJust a line.\n", "private")).kind, "excerpt")
})

test("the home is read through the bridge, and an edit is written back merged, over the version read", async t => {
  const { disk, calls, source, problems } = await withHome(t)
  const walk = byId(TID)!
  assert.deepEqual([walk.title, walk.homeChannel, walk.visibility], ["Slow walk", "notes", "private"])
  const plain = bySlug("no-id")!
  assert.equal(plain.id, "path:notes/no-id.md", "a block with no ID is known by its path")
  assert.equal(bySlug("on-rain")!.visibility, "public")

  open(TID, "edit")
  autosave(TID, { body: "Yanaka in the rain." })
  assert.equal(byId(TID)!.body, "Yanaka in the rain.", "the workspace has it at once")
  await source.settled()
  const saved = disk.get("notes/walk.md")!
  assert.match(saved, /^---\ntitle: Slow walk\nmood: calm\norigin: \/Users\/mira\/old\/walk\.md\ntags: \[yanaka, cats\]\nid: 3m2zx5u6ifk2a\nupdated: \d{4}-\d{2}-\d{2}\n---\n\nYanaka in the rain\.\n?$/)
  assert.ok(calls.includes("PUT /vault/file?notes/walk.md"))

  // Two edits in a row go in order, the second over the version the first wrote.
  autosave(TID, { body: "Yanaka in the rain, then sun." })
  autosave(TID, { title: "Rain, then sun" })
  await source.settled()
  assert.match(disk.get("notes/walk.md")!, /title: Rain, then sun[\s\S]*Yanaka in the rain, then sun\./)
  assert.deepEqual(problems, [])

  // Changed on disk meanwhile: nothing is written over it, and the person is told.
  disk.set("notes/walk.md", disk.get("notes/walk.md")!.replace("then sun", "then snow"))
  autosave(TID, { body: "Mine." })
  await source.settled()
  assert.match(disk.get("notes/walk.md")!, /then snow/)
  assert.equal(problems.length, 1)
  assert.match(problems[0], /notes\/walk\.md was not saved to your home: it changed on disk since it was read/)
})

test("new blocks, images, channel order and deletes reach the home; moves are not built here yet, and say so", async t => {
  const { disk, calls, source, problems } = await withHome(t)
  setMediaBackend(memoryBackend())
  t.after(() => setMediaBackend(memoryBackend()))

  const draft = createDraft({ homeChannel: "notes", title: "Lantern shop" })
  saveDraft({ body: "Paper, wire, light." })
  await source.settled()
  assert.ok(calls.includes("PUT /vault/file?notes/lantern-shop.md"))
  const made = disk.get("notes/lantern-shop.md")!
  assert.match(made, new RegExp(`id: ${draft.id}`))
  assert.equal(props(made).visibility, undefined, "private is the default, so it is not written")

  // An image: the bridge writes the file and its block; a later caption merges onto what it wrote.
  const image = await addImage({ name: "Wet street.png", type: "image/png", bytes: PNG, channel: "notes", alt: "A wet street" })
  await source.settled()
  assert.equal(disk.get("notes/wet-street.png"), "bytes")
  assert.match(disk.get("notes/wet-street.md")!, new RegExp(`id: ${image.id}`))
  open(image.id, "edit")
  saveDraft({ body: "![[wet-street.png]]\n\nAfter the rain." })
  await source.settled()
  assert.match(disk.get("notes/wet-street.md")!, /^---\nkind: media\ntitle: Wet street\nalt: A wet street\nhash: b[a-z2-7]+\nmime: image\/png\nid: [a-z2-7]{13}\n[\s\S]*After the rain\./)

  // Into a channel's order: its _channel.md keeps its own properties and gains the order.
  moveBlock(draft.id, "notes", "notes", { before: TID })
  await source.settled()
  const channel = props(disk.get("notes/_channel.md")!)
  assert.deepEqual([channel.title, channel.kept], ["Notes", "yes"], "its own properties stay")
  const order = channel.order as string[]
  assert.equal(order.indexOf("lantern-shop") + 1, order.indexOf("walk"), "placed where it was dropped")
  collect(draft.id, "essays")
  await source.settled()
  assert.deepEqual(props(disk.get("notes/lantern-shop.md")!).channels, ["essays"])

  // Moving a block to another folder is not built here: the block stays, and the person is told how.
  const before = disk.get("notes/lantern-shop.md")
  moveBlock(draft.id, "notes", "essays")
  await source.settled()
  assert.equal(byId(draft.id)!.homeChannel, "notes")
  assert.equal(disk.get("notes/lantern-shop.md"), before)
  assert.match(problems.at(-1)!, /ohmmmm vault rename lantern-shop --channel essays/)
  assert.ok(channelRecords.some(channel => channel.path === "notes"))

  deleteDoc(draft.id)
  await source.settled()
  assert.equal(disk.has("notes/lantern-shop.md"), false)
  assert.equal(problems.length, 1)
})
