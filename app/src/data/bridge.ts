// The home's bridge on this machine, `ohmmmm serve` (docs/serve.md). The app pairs with it once, from
// the link the bridge (or `ohmmmm pair`) prints: `<app>/#bridge=<its address>&token=<this browser's
// key>`. The key rides in the fragment, which a browser never sends to a server, and is kept in this
// browser only: the home keeps no copy of it, only its hash. Agents have a key of their own, which
// reaches only the bridge's MCP endpoints.
//
// For now the media cache reads through it: an image this browser does not hold is fetched from the
// home folder by its CID (vault/plans/media.md, step 3). The local home source comes next.

export type Bridge = { url: string; token: string }
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">

const KEY = "ohm-bridge"
const TOKEN = /^[A-Za-z0-9_-]{20,200}$/

/** A bridge's address, when it is one: plain http on this machine, and nothing but host and port. */
export function bridgeAddress(value: string): string | null {
  try {
    const url = new URL(value)
    const here = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    return url.protocol === "http:" && here && url.pathname === "/" && !url.search && !url.hash && !url.username ? url.origin : null
  } catch { return null }
}

const storage = (): Store | null => {
  try { return typeof localStorage === "undefined" ? null : localStorage } catch { return null }
}

/** The bridge this browser is paired with, if any. */
export function currentBridge(store: Store | null = storage()): Bridge | null {
  try {
    const held = JSON.parse(store?.getItem(KEY) ?? "null") as Partial<Bridge> | null
    const url = held?.url && bridgeAddress(held.url)
    return url && typeof held?.token === "string" && TOKEN.test(held.token) ? { url, token: held.token } : null
  } catch { return null }
}

/**
 * Pairs with the bridge a pairing link names, and takes the token out of the address bar at once.
 * A link to anywhere but this machine, or with no proper token, is ignored. Returns the bridge paired.
 */
export function pairFromLocation(
  at: Pick<Location, "hash" | "pathname" | "search"> = location,
  store: Store | null = storage(),
  history: Pick<History, "replaceState"> | null = typeof window === "undefined" ? null : window.history,
): Bridge | null {
  const said = new URLSearchParams(at.hash.replace(/^#/, ""))
  if (!said.has("bridge")) return null
  history?.replaceState(null, "", `${at.pathname}${at.search}`)
  const url = bridgeAddress(said.get("bridge") ?? "")
  const token = said.get("token") ?? ""
  if (!url || !TOKEN.test(token)) return null
  store?.setItem(KEY, JSON.stringify({ url, token }))
  return { url, token }
}

export const forgetBridge = (store: Store | null = storage()) => store?.removeItem(KEY)

/** A request to the paired bridge, signed with this browser's key. */
export function bridgeFetch(path: string, init: RequestInit = {}, bridge = currentBridge()) {
  if (!bridge) return Promise.reject(new DOMException("No bridge is paired. Run ohmmmm serve, or ohmmmm pair, and open the link it prints.", "NotFoundError"))
  return fetch(`${bridge.url}${path}`, { ...init, headers: { ...init.headers, Authorization: `Bearer ${bridge.token}` } })
}

/** The media cache's last place to look: the home folder, through the bridge. */
export async function bridgeMedia(cid: string, bridge = currentBridge()) {
  if (!bridge) return undefined
  try {
    const answer = await bridgeFetch(`/media/${encodeURIComponent(cid)}`, {}, bridge)
    if (!answer.ok) return undefined
    return { bytes: new Uint8Array(await answer.arrayBuffer()), type: answer.headers.get("content-type") ?? "application/octet-stream" }
  } catch { return undefined }
}
