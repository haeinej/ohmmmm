// Whether the paired ohm has a site, and the worker that serves its files on the app's own origin
// (flows/site.md, public/site-sw.js). The Site view shows whenever the bridge says the ohm's site/ is
// connected; nothing else switches it on.
import { useSyncExternalStore } from "react"
import { bridgeFetch, currentBridge } from "@/data/bridge"

export type SiteInfo = { connected: boolean; repo?: string; project?: string; domain?: string }

let info: SiteInfo = { connected: false }
const listeners = new Set<() => void>()
const tell = (next: SiteInfo) => { info = next; listeners.forEach(l => l()) }

/** Gives the worker this browser's key for the bridge, and waits until it has it. */
async function readyWorker(bridge: { url: string; token: string }) {
  if (!("serviceWorker" in navigator)) throw new Error("This browser can't show your site here")
  const registration = await navigator.serviceWorker.register("/site-sw.js", { scope: "/" })
  const worker = registration.active ?? registration.waiting ?? registration.installing
  await navigator.serviceWorker.ready
  const target = (await navigator.serviceWorker.getRegistration("/"))?.active ?? worker
  if (!target) throw new Error("The site's worker did not start")
  await new Promise<void>(done => {
    const heard = (event: MessageEvent) => { if (event.data?.type === "ohm-site-bridge-ready") { navigator.serviceWorker.removeEventListener("message", heard); done() } }
    navigator.serviceWorker.addEventListener("message", heard)
    target.postMessage({ type: "ohm-site-bridge", bridge })
    setTimeout(done, 3000)
  })
}

export async function startSite() {
  const bridge = currentBridge()
  if (!bridge) return
  try {
    const answer = await bridgeFetch("/site", { cache: "no-store" }, bridge)
    if (!answer.ok) return
    const said = (await answer.json()) as SiteInfo
    if (!said.connected) return
    // The worker only serves the site's files on this origin (the canvas's frame, tile pictures). A
    // browser that won't run it still gets the Site view, its tiles and its canvas; what the worker
    // would have served is missing there, and says so in the console.
    await readyWorker(bridge).catch(problem => console.warn("The site's worker did not start, so the site's own files won't show here:", problem))
    tell(said)
  } catch { /* no site: the main panel is as before */ }
}

export const siteInfo = () => info
export function useSite(): SiteInfo {
  return useSyncExternalStore(l => { listeners.add(l); return () => listeners.delete(l) }, () => info)
}
