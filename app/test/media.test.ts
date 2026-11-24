// Images as media blocks (vault/plans/media.md, issue #30): an image is a block of its own, named by
// its bytes' CID; a text embeds it with ![[slug]]; no save ever holds a temporary browser address;
// and an export carries the image itself, so it still opens after the tab that made it has closed.
import assert from "node:assert/strict"
import test from "node:test"
import { MarkdownManager } from "@tiptap/markdown"
import StarterKit from "@tiptap/starter-kit"
import { blobCid } from "../../vault/vault/core.mjs"
import { readNode } from "../../vault/vault/node.mjs"
import { blockOf } from "../src/data/source"
import { byId, isBlock } from "../src/data/workspace-data"
import { Embed } from "../src/editor/embed"
import { heldNow, memoryBackend, serviceNameOf, setMediaBackend } from "../src/media/cache"
import { assertDurable, embedsIn, temporaryAddresses, unescapeEmbeds } from "../src/media/embeds"
import { exportBlock, exportNow, preload } from "../src/media/export"
import { crc32 } from "../src/media/zip"
import { downloadUrl } from "../src/workspace/drop"
import { addImage, autosave, createDraft, deleteDoc, open, saveDraft, setSource } from "../src/workspace/store"
import { createFixtureSource } from "./fixtures/fixture-source"

// A 1×1 PNG, as a synthetic image.
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), c => c.charCodeAt(0))
const OTHER_PNG = PNG.slice()
OTHER_PNG[OTHER_PNG.length - 13] ^= 1 // other bytes, so another CID

/** The files in a stored .zip, read from its local headers, each checked against its CRC. */
function unzip(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const files = new Map<string, Uint8Array>()
  let at = 0
  while (view.getUint32(at, true) === 0x04034b50) {
    assert.equal(view.getUint16(at + 8, true), 0, "stored, not compressed")
    const crc = view.getUint32(at + 14, true)
    const size = view.getUint32(at + 18, true)
    const nameLength = view.getUint16(at + 26, true)
    const extra = view.getUint16(at + 28, true)
    const name = new TextDecoder().decode(bytes.subarray(at + 30, at + 30 + nameLength))
    const data = bytes.subarray(at + 30 + nameLength + extra, at + 30 + nameLength + extra + size)
    assert.equal(crc32(data), crc, `${name} matches its CRC`)
    files.set(name, data)
    at += 30 + nameLength + extra + size
  }
  assert.ok(files.size, "the archive has files")
  return files
}

async function workspace() {
  const source = createFixtureSource()
  await setSource(source)
  return source
}

test("an image becomes a private media block named by its CID, and the same bytes are one block", async () => {
  setMediaBackend(memoryBackend())
  const source = await workspace()
  const made: string[] = []
  try {
    const first = await addImage({ name: "Wet street.png", type: "image/png", bytes: PNG, channel: "photos" })
    made.push(first.id)
    assert.equal(first.created, true)
    const media = byId(first.id)!
    assert.equal(media.kind, "media")
    assert.equal(media.visibility, "private")
    assert.equal(media.slug, "wet-street")
    assert.equal(media.body, "![[wet-street.png]]")
    assert.equal(media.media?.hash, await blobCid(PNG), "the vault's own blob CID")
    // The bytes went to the home's media store first, under the name the service gives the same digest.
    assert.deepEqual(await source.media.has([serviceNameOf(media.media!.hash)]), [serviceNameOf(media.media!.hash)])
    assert.equal(media.media?.mime, "image/png")
    assert.equal(media.media?.alt, "Wet street")
    // The file the vault would keep reads back as the same media block, with no browser address.
    const ref = (await source.listBlocks(["private"])).find(head => head.id === first.id)!
    const file = await source.readBlock(ref)
    assert.equal(file.path, "photos/wet-street.md")
    const node = readNode(file.path, file.text)!.node as { kind: string; properties: Record<string, unknown> }
    assert.equal(node.kind, "media")
    assert.equal(node.properties.hash, media.media?.hash)
    assert.doesNotMatch(file.text, /blob:|data:/)

    // A caption beside the image keeps it a media block, with its image.
    open(first.id, "edit")
    await saveDraft({ body: "![[wet-street.png]]\n\nThe street after the rain." })
    assert.deepEqual([byId(first.id)!.kind, byId(first.id)!.media?.hash], ["media", media.media?.hash])

    // The same bytes again, from another channel: no copy; the media block is collected there, as Are.na connects.
    const again = await addImage({ name: "copy.png", type: "image/png", bytes: PNG.slice(), channel: "reading" })
    assert.deepEqual([again.id, again.created], [first.id, false])
    const held = byId(first.id)!
    assert.ok(isBlock(held) && held.channels?.includes("reading"))

    // A second image with the same name in the same channel gets a file name of its own.
    const second = await addImage({ name: "Wet street.png", type: "image/png", bytes: OTHER_PNG, channel: "photos" })
    made.push(second.id)
    assert.equal(byId(second.id)!.body, "![[wet-street-2.png]]")

    await assert.rejects(addImage({ name: "notes.txt", type: "text/plain", bytes: PNG, channel: "photos" }), { name: "DataError" })
  } finally {
    for (const id of made) await deleteDoc(id)
    await setSource(null)
  }
})

test("no save holds a temporary browser address, on any path", async () => {
  assert.deepEqual(temporaryAddresses("![a](blob:http://localhost/1)\n<img src=\"data:image/png;base64,AA\">\n[x](data:text/plain,hi)"),
    ["blob:http://localhost/1", "data:image/png;base64,AA", "data:text/plain,hi"])
  assert.deepEqual(temporaryAddresses("```\n![a](blob:http://x/1)\n```\nSay `![a](data:x)` in code. ![b](https://example.test/b.png)"), [])
  assert.throws(() => assertDurable("![a](blob:http://localhost/1)"), { name: "DataError" })

  await workspace()
  const draft = await createDraft({ homeChannel: "photos", title: "Temporary images" })
  try {
    await assert.rejects(async () => saveDraft({ body: "![street](blob:http://localhost:5190/1234)" }), { name: "DataError" })
    // The editor's flush on leaving goes through autosave.
    await assert.rejects(async () => autosave(draft.id, { body: "<img src=\"data:image/png;base64,AAAA\">" }), { name: "DataError" })
    assert.equal(byId(draft.id)!.body, "", "nothing was saved")
    await saveDraft({ body: "![street](https://example.test/street.png)" })
    assert.equal(byId(draft.id)!.body, "![street](https://example.test/street.png)")
  } finally {
    await deleteDoc(draft.id)
    await setSource(null)
  }
})

test("the editor reads and writes ![[…]] as an embed, and outside code only", () => {
  const markdown = new MarkdownManager({ extensions: [StarterKit, Embed] })
  const text = "First line.\n\n![[wet-street]]\n\n![[wet-street.png|A wet street]]\n\n```\n![[in-code]]\n```"
  const doc = markdown.parse(text)
  const embeds = doc.content!.filter(node => node.type === "embed").map(node => node.attrs!.src)
  assert.deepEqual(embeds, ["wet-street", "wet-street.png|A wet street"])
  assert.equal(markdown.serialize(doc), text)
  assert.deepEqual(embedsIn(text), ["wet-street", "wet-street.png"])
  // Typed inside a line, the serializer escapes it; the editor puts it back as written.
  assert.equal(unescapeEmbeds(markdown.serialize(markdown.parse("Look: ![[wet_street.png]] there."))), "Look: ![[wet_street.png]] there.")
})

test("an export carries the image, so it opens after the tab that made it has closed (#30)", async () => {
  const kept = new Map<string, Uint8Array>() // the browser's storage, which outlives a tab
  setMediaBackend(memoryBackend(kept))
  const source = await workspace()
  const draft = await createDraft({ homeChannel: "photos", title: "Evening walk" })
  let mediaId = ""
  try {
    // Insert a synthetic image, as dropping it in the editor does, then autosave the text that shows it.
    const image = await addImage({ name: "Wet street.png", type: "image/png", bytes: PNG, channel: "photos", alt: "A wet [street] at dusk" })
    mediaId = image.id
    await autosave(draft.id, { body: `Rain all afternoon.\n\n![[${image.slug}]]\n\nThen the light came back.` })
    const ref = (await source.listBlocks(["private"])).find(head => head.id === draft.id)!
    const saved = blockOf(await source.readBlock(ref))!.body
    assert.match(saved, /!\[\[wet-street\]\]/, "the autosaved body names the media block")
    assert.doesNotMatch(saved, /blob:|data:/)
    assert.equal(byId(draft.id)!.kind, "text")
    assert.ok((await source.connections()).some(edge => edge.kind === "embeds" && edge.to.endsWith(byId(image.id)!.vaultId!)),
      "the vault reads the embed as evidence, so the media block shows where it is used")

    // Close the tab: nothing it held in memory or as object URLs is left, only the browser's storage.
    setMediaBackend(memoryBackend(kept))
    const doc = byId(draft.id)!
    const markdown = `# ${doc.title}\n\n${doc.body}`
    assert.equal(exportNow(doc, markdown), null, "a drag waits for the image to load")
    const exported = await exportBlock(doc, markdown)
    assert.equal(exported.name, "Evening walk.zip")
    assert.deepEqual([exported.images, exported.missing], [1, []])
    const files = unzip(exported.bytes)
    assert.deepEqual([...files.keys()], ["Evening walk.md", "assets/wet-street.png"])
    assert.deepEqual(files.get("assets/wet-street.png"), PNG, "the image itself, byte for byte")
    const md = new TextDecoder().decode(files.get("Evening walk.md"))
    assert.equal(md, "# Evening walk\n\nRain all afternoon.\n\n![A wet \\[street\\] at dusk](assets/wet-street.png)\n\nThen the light came back.")

    // Loaded, the same export is put together at once, as a drag needs, and the drag carries its bytes.
    await preload(doc)
    assert.ok(heldNow(byId(mediaId)!.media!.hash))
    const now = exportNow(doc, markdown)!
    assert.deepEqual(now.bytes.length, exported.bytes.length)
    const url = downloadUrl(now)
    assert.ok(url.startsWith("application/zip:Evening walk.zip:data:application/zip;base64,"))
    assert.deepEqual(Uint8Array.from(atob(url.split("base64,")[1]), c => c.charCodeAt(0)), now.bytes)

    // A block with no images still exports as plain Markdown.
    const plain = await exportBlock(byId(mediaId)!, "# Only words\n\nNothing to show.")
    assert.deepEqual([plain.name, plain.type], ["Wet street.md", "text/markdown"])

    // An image this device does not have stays named, and the export says so.
    setMediaBackend(memoryBackend())
    const missing = await exportBlock(doc, markdown)
    assert.deepEqual([missing.type, missing.missing], ["text/markdown", ["wet-street"]])
    assert.match(new TextDecoder().decode(missing.bytes), /!\[\[wet-street\]\]/)
  } finally {
    await deleteDoc(draft.id)
    if (mediaId) await deleteDoc(mediaId)
    await setSource(null)
    setMediaBackend(memoryBackend())
  }
})
