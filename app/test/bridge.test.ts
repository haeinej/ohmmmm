// Pairing with `ohmmmm serve` (docs/serve.md), and the media cache reading an image the browser lacks
// from the home folder through it, by CID.
import assert from "node:assert/strict"
import test from "node:test"
import { blobCid } from "../../vault/vault/core.mjs"
import { bridgeAddress, bridgeMedia, currentBridge, forgetBridge, pairFromLocation } from "../src/data/bridge"
import { memoryBackend, original, setMediaBackend, setMediaRemote } from "../src/media/cache"

const TOKEN = "QexdqYGJ2FZs7RkxcsaXaQMMXE0wJv3TqcHALTiddso"
const store = () => {
  const held = new Map<string, string>()
  return { getItem: (key: string) => held.get(key) ?? null, setItem: (key: string, value: string) => { held.set(key, value) }, removeItem: (key: string) => { held.delete(key) } }
}

test("the pairing link pairs this browser with a bridge on this machine, and leaves the address bar clean", () => {
  const kept = store()
  const replaced: string[] = []
  const history = { replaceState: (_: unknown, __: string, url?: string | URL | null) => { replaced.push(String(url)) } }
  const at = { hash: `#bridge=${encodeURIComponent("http://127.0.0.1:8766")}&token=${TOKEN}`, pathname: "/", search: "?open=x" }
  assert.deepEqual(pairFromLocation(at, kept, history), { url: "http://127.0.0.1:8766", token: TOKEN })
  assert.deepEqual(replaced, ["/?open=x"], "the token leaves the address bar at once")
  assert.deepEqual(currentBridge(kept), { url: "http://127.0.0.1:8766", token: TOKEN })

  // Only this machine, over plain http, and a proper token. Anything else is ignored, but still cleared.
  for (const bridge of ["https://evil.example", "http://192.168.1.4:8766", "http://127.0.0.1:8766/path", "javascript:alert(1)"]) {
    const other = store()
    assert.equal(pairFromLocation({ hash: `#bridge=${encodeURIComponent(bridge)}&token=${TOKEN}`, pathname: "/", search: "" }, other, history), null, bridge)
    assert.equal(currentBridge(other), null)
  }
  assert.equal(pairFromLocation({ hash: "#bridge=http%3A%2F%2Flocalhost%3A8766&token=short", pathname: "/", search: "" }, store(), history), null)
  assert.equal(pairFromLocation({ hash: "", pathname: "/", search: "" }, store(), history), null)
  assert.equal(bridgeAddress("http://localhost:5190"), "http://localhost:5190")
  forgetBridge(kept)
  assert.equal(currentBridge(kept), null)
})

test("an image the browser lacks comes from the home folder through the bridge, only if it is what its CID says", async () => {
  const bytes = new TextEncoder().encode("a synthetic image")
  const cid = await blobCid(bytes)
  const asked: { url: string; auth?: string }[] = []
  const realFetch = globalThis.fetch
  let answer = bytes
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    asked.push({ url, auth: (init.headers as Record<string, string>).Authorization })
    return new Response(answer.slice(), { status: 200, headers: { "Content-Type": "image/png" } })
  }) as typeof fetch
  try {
    const bridge = { url: "http://127.0.0.1:8766", token: TOKEN }
    const kept = new Map<string, Uint8Array>()
    setMediaBackend(memoryBackend(kept))
    setMediaRemote(name => bridgeMedia(name, bridge))
    const found = await original(cid, "image/png")
    assert.deepEqual(found?.bytes, bytes)
    assert.deepEqual(asked, [{ url: `http://127.0.0.1:8766/media/${cid}`, auth: `Bearer ${TOKEN}` }])
    assert.deepEqual(kept.get(cid), bytes, "kept in the browser from then on")

    // Bytes that are not what the CID says are dropped.
    setMediaBackend(memoryBackend())
    answer = new TextEncoder().encode("something else")
    assert.equal(await original(cid, "image/png"), undefined)
    // With no bridge paired, nothing is asked.
    setMediaRemote(name => bridgeMedia(name, null))
    asked.length = 0
    assert.equal(await original(cid, "image/png"), undefined)
    assert.deepEqual(asked, [])
  } finally {
    globalThis.fetch = realFetch
    setMediaRemote()
    setMediaBackend(memoryBackend())
  }
})

test("a paired browser names itself in words a person recognises, once", async t => {
  const { browserName, nameThisBrowser } = await import("../src/data/browsers")
  assert.equal(browserName("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"), "Chrome on macOS")
  assert.equal(browserName("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36 Edg/149.0.0.0"), "Edge on Windows")
  assert.equal(browserName("Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0"), "Firefox on Linux")
  assert.equal(browserName("Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1"), "Safari on iPhone")
  assert.equal(browserName(""), "A browser")

  const sent: string[] = []
  let named: string | undefined
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (input: string, init: RequestInit = {}) => {
    sent.push(`${init.method ?? "GET"} ${new URL(input).pathname}`)
    if (init.method === "POST") named = (JSON.parse(String(init.body)) as { name: string }).name
    const browsers = [{ id: "aaaaaaaaaaaa", made: "2026-11-24T00:00:00Z", you: true, ...(named ? { name: named } : {}) }]
    return new Response(JSON.stringify(init.method === "POST" ? { id: "aaaaaaaaaaaa", name: named } : { browsers, agents: [], shared: false }), { status: 200, headers: { "Content-Type": "application/json" } })
  }) as typeof fetch
  t.after(() => { globalThis.fetch = realFetch })
  const bridge = { url: "http://127.0.0.1:8766", token: TOKEN }
  await nameThisBrowser(bridge, "Chrome on macOS")
  await nameThisBrowser(bridge, "Something else")
  assert.deepEqual(sent, ["GET /vault/keys", "POST /vault/keys/self", "GET /vault/keys"])
  assert.equal(named, "Chrome on macOS", "a browser already named keeps its name")
})
