// The browsers paired with the home's bridge (docs/serve.md, "The keys"): each has its own key, and the
// person can see them and forget one, here or with `ohmmmm browsers`. The home keeps only each key's
// hash; a browser is shown by an ID (the start of that hash), the name it gave itself, and when it was
// paired and last used.
import { bridgeFetch, type Bridge } from "./bridge"

export type PairedBrowser = { id: string; made: string; app?: string; name?: string; seen?: string; you?: boolean }
export type HomeKeys = { browsers: PairedBrowser[]; agents: { name: string; made: string }[]; shared: boolean }

const answered = async <T>(response: Response): Promise<T> => {
  if (!response.ok) {
    const said = await response.json().catch(() => ({})) as { error?: string }
    throw new DOMException(said.error ?? `Your home answered HTTP ${response.status}.`, response.status === 404 ? "NotFoundError" : "OperationError")
  }
  return await response.json() as T
}

/** The browsers paired with the home, this one marked `you`, and the agents that have keys. */
export const homeKeys = (bridge?: Bridge) => bridgeFetch("/vault/keys", {}, bridge).then(answered<HomeKeys>)

/** Forgets one paired browser: its key stops working at once. `you` says it was this one. */
export const forgetPairedBrowser = (id: string, bridge?: Bridge) =>
  bridgeFetch(`/vault/keys/${encodeURIComponent(id)}`, { method: "DELETE" }, bridge).then(answered<{ forgotten: string; you: boolean }>)

/** What this browser is, in words a person recognises in a list: "Chrome on macOS". */
export function browserName(ua: string = typeof navigator === "undefined" ? "" : navigator.userAgent): string {
  const brand = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox"
    : /Chrome\/|CriOS\//.test(ua) ? "Chrome" : /Version\/[\d.]+.*Safari\//.test(ua) ? "Safari" : "A browser"
  const system = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android"
    : /CrOS/.test(ua) ? "ChromeOS" : /Mac OS X|Macintosh/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : ""
  return system ? `${brand} on ${system}` : brand
}

/** Gives this browser its name in the home's list, once: a browser already named keeps its name. */
export async function nameThisBrowser(bridge?: Bridge, name = browserName()) {
  const mine = (await homeKeys(bridge)).browsers.find(each => each.you)
  if (!mine || mine.name) return
  await bridgeFetch("/vault/keys/self", { method: "POST", body: JSON.stringify({ name }), headers: { "Content-Type": "application/json" } }, bridge).then(answered)
}
