// The site's files, on the app's own origin (flows/site.md). The person's website is in their ohm,
// served by `ohm serve` on this computer, which answers only with this browser's key. A frame can't
// send a key, and a page from another origin can't be reached into, so this worker stands between:
// the app's `/site/<path>` and every address a site page asks for by its own root (`/writing/x.jpg`)
// are fetched from the bridge's `/site/file/<path>`, signed with the key the app gave it.
//
// It answers only:
//   - a link followed inside the site's frame, sent back under /site/;
//   - requests from a page under /site/ (the canvas's frame), whatever their path, on this origin;
//   - the app's own requests for /site/<path> (tile pictures).
// Everything else passes by untouched.
const STORE = "ohm-site-sw"
let bridge = null

async function held() {
  if (bridge) return bridge
  try {
    const answer = await (await caches.open(STORE)).match("/__bridge")
    bridge = answer ? await answer.json() : null
  } catch { bridge = null }
  return bridge
}

self.addEventListener("install", () => self.skipWaiting())
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()))

self.addEventListener("message", event => {
  const sent = event.data
  if (sent?.type !== "ohm-site-bridge") return
  bridge = sent.bridge && typeof sent.bridge.url === "string" && typeof sent.bridge.token === "string" ? { url: sent.bridge.url, token: sent.bridge.token } : null
  event.waitUntil((async () => {
    const store = await caches.open(STORE)
    if (bridge) await store.put("/__bridge", new Response(JSON.stringify(bridge), { headers: { "Content-Type": "application/json" } }))
    else await store.delete("/__bridge")
    event.source?.postMessage({ type: "ohm-site-bridge-ready" })
  })())
})

self.addEventListener("fetch", event => {
  const url = new URL(event.request.url)
  if (url.origin !== self.location.origin || (event.request.method !== "GET" && event.request.method !== "HEAD")) return
  const inSite = url.pathname.startsWith("/site/")
  // A link followed inside the site's frame (`/writings/`): the frame stays in the site, at the same
  // page under /site/, so its own styles and pictures keep coming from the site. Only a frame that
  // was showing the site is moved; the app's own pages are never touched.
  if (!inSite && event.request.mode === "navigate" && event.request.destination === "iframe") {
    const from = event.request.referrer ? new URL(event.request.referrer) : null
    if (from && from.origin === self.location.origin && from.pathname.startsWith("/site/")) {
      event.respondWith(Response.redirect(`/site${url.pathname}${url.search}${url.hash}`, 302))
      return
    }
  }
  event.respondWith((async () => {
    // A site page's own requests: from a frame showing /site/…
    let fromSite = inSite
    if (!fromSite && event.clientId) {
      const client = await self.clients.get(event.clientId)
      fromSite = Boolean(client && new URL(client.url).pathname.startsWith("/site/"))
    }
    if (!fromSite) return fetch(event.request)
    const known = await held()
    if (!known) return new Response("This browser is not paired with your ohm. Run ohm serve and open the link it prints.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } })
    const path = inSite ? url.pathname.slice("/site/".length) : url.pathname.replace(/^\//, "")
    const answer = await fetch(`${known.url}/site/file/${path}${url.search}`, { method: event.request.method, headers: { Authorization: `Bearer ${known.token}` }, cache: "no-store" })
    // A page's own response, with nothing of the bridge's that would bar it from the frame.
    const headers = new Headers()
    for (const name of ["content-type", "content-length", "etag", "cache-control"]) { const value = answer.headers.get(name); if (value) headers.set(name, value) }
    return new Response(event.request.method === "HEAD" ? null : answer.body, { status: answer.status, headers })
  })())
})
