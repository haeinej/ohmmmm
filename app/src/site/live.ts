// The site, live (home/site-live.mjs): one stream from `ohm serve` for the whole app, telling every file
// that changes in the site folder, where each coding agent says it is working, and what the person last
// pointed at. Each arrives as a window event; open pages and panels listen to the ones they need.
import { bridgeFetch } from "@/data/bridge"
import { LINKS_CHANGED, saved, TOOLS_CHANGED } from "./source"

export const LIVE_CHANGE = "ohm:live-change"
export const LIVE_FOCUS = "ohm:live-focus"
export const LIVE_POINTED = "ohm:live-pointed"
/** The board changed (`{ rev, by }`), or an agent asked to show a card (`{ id }`). */
export const LIVE_BOARD = "ohm:live-board"
export const LIVE_VIEW = "ohm:live-view"
export type LiveFocus = { agent: string; path: string; selector: string; note: string; at: string }
export type LivePick = { path: string; selector: string; text: string; html: string }

/** Whether ohm serve is reachable, and which agents spoke over MCP and when. */
/** `open` and `doing` come from an agent's own hooks (the ohm plugin), when it has them. */
export type LiveAgent = { agent: string; seen: string; open?: boolean; doing?: string }
export type LiveStatus = { online: boolean; agents: LiveAgent[] }
/** An agent did something, by its hooks: `{ agent, event, tool, path }` (path within the site, or tools/…). */
export const LIVE_ACTIVITY = "ohm:live-activity"
export type LiveActivity = { agent: string; event: string; tool: string; path: string; at: string }
export const LIVE_STATUS = "ohm:live-status"
let status: LiveStatus = { online: false, agents: [] }
const setStatus = (next: Partial<LiveStatus>) => { status = { ...status, ...next }; window.dispatchEvent(new CustomEvent(LIVE_STATUS, { detail: status })) }
export const liveStatus = () => status
/**
 * Whether an agent is connected: with hooks (the ohm plugin), while its session is open and it was heard
 * from in the last half hour; without, while it spoke over MCP in the last ten minutes.
 */
export const connected = (s: LiveStatus, agent?: string) => s.online && s.agents.some(a => (!agent || a.agent === agent)
  // An open session that went quiet for half an hour ended without saying so (it crashed, or was killed).
  && (a.open !== undefined ? a.open && Date.now() - new Date(a.seen).getTime() < 1_800_000 : Date.now() - new Date(a.seen).getTime() < 600_000))

let running = false
/** Open the stream once; it reconnects by itself when `ohm serve` restarts. */
export function startLive() {
  if (running) return
  running = true
  let refresh = 0
  const loop = async () => {
    for (;;) {
      try {
        const res = await bridgeFetch("/site/events", { cache: "no-store" })
        if (!res.ok || !res.body) throw new Error("no stream")
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffered = ""
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          buffered += decoder.decode(value, { stream: true })
          let end
          while ((end = buffered.indexOf("\n")) >= 0) {
            const line = buffered.slice(0, end); buffered = buffered.slice(end + 1)
            if (!line.trim()) continue
            const event = JSON.parse(line) as { type: string } & Record<string, string>
            if (event.type === "change") {
              window.dispatchEvent(new CustomEvent(LIVE_CHANGE, { detail: event.path }))
              if (event.by) window.dispatchEvent(new CustomEvent(LIVE_ACTIVITY, { detail: { agent: event.by, event: "changed", tool: "", path: event.path, at: event.at } }))
              // Panels read the site again, once for a burst of changes.
              clearTimeout(refresh); refresh = window.setTimeout(saved, 300)
            }
            if (event.type === "focus") window.dispatchEvent(new CustomEvent(LIVE_FOCUS, { detail: event }))
            if (event.type === "hello") setStatus({ online: true })
            if (event.type === "agents") setStatus({ agents: (event as unknown as LiveStatus).agents })
            if (event.type === "channels") saved()
            if (event.type === "tools") window.dispatchEvent(new CustomEvent(TOOLS_CHANGED, { detail: event.name }))
            if (event.type === "links") window.dispatchEvent(new CustomEvent(LINKS_CHANGED))
            if (event.type === "board") window.dispatchEvent(new CustomEvent(LIVE_BOARD, { detail: event }))
            if (event.type === "view") window.dispatchEvent(new CustomEvent(LIVE_VIEW, { detail: event }))
            if (event.type === "activity") window.dispatchEvent(new CustomEvent(LIVE_ACTIVITY, { detail: event }))
            if (event.type === "pointed") window.dispatchEvent(new CustomEvent(LIVE_POINTED, { detail: event }))
          }
        }
      } catch { /* not running, or restarting */ }
      setStatus({ online: false })
      await new Promise(r => setTimeout(r, 3000))
    }
  }
  void loop()
}

/** Tell `ohm serve` what the person pointed at, for their agent (`site_pointed`). */
export async function point(pick: LivePick | null) {
  await bridgeFetch("/site/pointed", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(pick) })
}

/** The site path a frame is showing: `/site/writings/` is `writings/index.html`. */
export function framePath(frame: HTMLIFrameElement | null): string {
  try {
    const p = decodeURIComponent(frame?.contentWindow?.location.pathname ?? "").replace(/^\/site\//, "")
    return p === "" || p.endsWith("/") ? `${p}index.html` : p
  } catch { return "" }
}

/** A selector that finds this element again: its id if it has one, else its place under the nearest id or body. */
export function selectorOf(el: Element): string {
  const parts: string[] = []
  for (let n: Element | null = el; n && n.tagName !== "HTML"; n = n.parentElement) {
    if (n.id) { parts.unshift(`#${CSS.escape(n.id)}`); break }
    const parent: Element | null = n.parentElement
    const same = parent ? [...parent.children].filter(c => c.tagName === n!.tagName) : []
    parts.unshift(same.length > 1 ? `${n.tagName.toLowerCase()}:nth-of-type(${same.indexOf(n) + 1})` : n.tagName.toLowerCase())
  }
  return parts.join(" > ")
}

/**
 * Keep a frame showing a site page up to date: a stylesheet that changes is swapped in place; any other
 * change of the site (the page, its scripts, its pictures) reloads it where it was scrolled to.
 */
export function followChanges(frame: () => HTMLIFrameElement | null) {
  const onChange = (e: Event) => {
    const path = (e as CustomEvent<string>).detail
    const f = frame()
    const doc = f?.contentDocument
    const win = f?.contentWindow
    if (!doc || !win) return
    if (/\.css$/i.test(path)) {
      for (const link of doc.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'))
        if (link.href.includes(path.split("/").at(-1)!)) { const u = new URL(link.href); u.searchParams.set("ohm", String(Date.now())); link.href = u.href }
      return
    }
    const y = win.scrollY
    f!.addEventListener("load", () => f!.contentWindow?.scrollTo(0, y), { once: true })
    win.location.reload()
  }
  window.addEventListener(LIVE_CHANGE, onChange)
  return () => window.removeEventListener(LIVE_CHANGE, onChange)
}

/** The canvas, kept in the home (`/site/board`). */
export async function readBoard<T>(): Promise<{ cards: T[]; rev: number } | null> {
  const res = await bridgeFetch("/site/board", { cache: "no-store" }).catch(() => null)
  return res?.ok ? res.json() : null
}
/** This window, among the app's open windows: its saves come back named for it, so it knows they are its own. */
export const THIS_WINDOW = Math.random().toString(36).slice(2, 10)
export async function saveBoard<T>(cards: T[], arrows?: unknown[]): Promise<number | null> {
  const res = await bridgeFetch("/site/board", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cards, ...(arrows ? { arrows } : {}), window: THIS_WINDOW }) }).catch(() => null)
  return res?.ok ? ((await res.json()) as { rev: number }).rev : null
}
export function shareSelection(ids: string[]) {
  void bridgeFetch("/site/selection", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) }).catch(() => {})
}

/** Run a prompt card with Claude Code, from the canvas (`ohm serve` starts it in the home). */
export async function runPrompt(id: string): Promise<string | null> {
  const res = await bridgeFetch("/site/prompt/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }).catch(() => null)
  if (res?.ok) return null
  return res ? ((await res.json().catch(() => null)) as { error?: string; message?: string } | null)?.message ?? (await res.text().catch(() => "")) ?? "Couldn't start Claude Code" : "ohm serve isn't running"
}
export async function stopPrompt(id: string) {
  await bridgeFetch("/site/prompt/stop", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }).catch(() => null)
}
