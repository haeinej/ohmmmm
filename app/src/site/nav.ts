// Where the main area of the Site view is, and where it has been (docs/plans/information-and-viewer.md):
// home (the site itself) or a block by its path. Channels open in the side panel, not here. Back and forward in the title bar walk this, as in a browser.
import { useSyncExternalStore } from "react"

export type Place = { kind: "home" } | { kind: "block"; path: string } | { kind: "page"; path: string } | { kind: "channel"; name: string } | { kind: "link"; url: string; title: string } | { kind: "tool"; name: string; title: string }

let state: { been: Place[]; at: number } = { been: [{ kind: "home" }], at: 0 }
const listeners = new Set<() => void>()
const set = (next: typeof state) => { state = next; listeners.forEach(l => l()) }
const same = (a: Place, b: Place) => JSON.stringify(a) === JSON.stringify(b)

/** Go somewhere new: what was ahead of here is dropped. */
export function goTo(place: Place) {
  if (same(state.been[state.at], place)) return
  set({ been: [...state.been.slice(0, state.at + 1), place].slice(-100), at: Math.min(state.at + 1, 99) })
}
/** Move without leaving a step behind, as stepping through a channel's blocks does. */
export function replaceWith(place: Place) {
  set({ been: state.been.map((p, i) => (i === state.at ? place : p)), at: state.at })
}
export function step(by: -1 | 1) {
  const at = Math.max(0, Math.min(state.been.length - 1, state.at + by))
  if (at !== state.at) set({ ...state, at })
}

export function useNav() {
  const now = useSyncExternalStore(cb => { listeners.add(cb); return () => listeners.delete(cb) }, () => state)
  return { place: now.been[now.at], canBack: now.at > 0, canForward: now.at < now.been.length - 1 }
}
