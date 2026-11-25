// The main screen (flows/site.md): the person's website itself, running, with everything it does:
// its own navigation, filters, viewer and motion. Nothing here is drawn for it. On top of that it
// can be composed: a photograph in its gallery is picked up and let go somewhere else in the order,
// each move can be taken back and done again, and saving writes the new order into the page's file,
// so what is published is what was arranged here.
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react"
import type { Move } from "./source"

/** What the Site view can ask of the canvas. */
export type LiveCanvasHandle = { undo(): void; redo(): void; discard(): void; saved(): void; reload(): void; go(path: string): void }
export type LiveState = { page: string; moves: Move[]; canUndo: boolean; canRedo: boolean }

type Op = { key: string; before: string | null; was: string | null }

const figures = (doc: Document) => [...doc.querySelectorAll<HTMLElement>("#grid figure.item")]
/** A photograph is known by its file's name, without the folder or the version after `?`. */
const keyOf = (figure: Element) => (figure.querySelector("img, video")?.getAttribute("src") ?? "").split("?")[0].split("/").at(-1) ?? ""
const find = (doc: Document, key: string) => figures(doc).find(f => keyOf(f) === key)
const nextKey = (figure: Element) => { let n = figure.nextElementSibling; while (n && !n.matches("figure.item")) n = n.nextElementSibling; return n ? keyOf(n) : null }
function place(doc: Document, key: string, before: string | null) {
  const figure = find(doc, key)
  if (!figure) return
  const ref = before ? find(doc, before) ?? null : null
  // To the end means after the last photograph, wherever that is among the cards.
  if (ref) ref.before(figure); else figures(doc).filter(f => f !== figure).at(-1)?.after(figure)
}

export const LiveCanvas = forwardRef<LiveCanvasHandle, {
  start: string
  zoom: number
  accent: string
  onState(state: LiveState): void
  /** ⌘-click on a photograph or a card: open it as a block. */
  onOpen(address: string): void
}>(function LiveCanvas({ start, zoom, accent, onState, onOpen }, ref) {
  const frame = useRef<HTMLIFrameElement>(null)
  const done = useRef<Op[]>([])
  const undone = useRef<Op[]>([])
  /** The page the moves belong to: they are put back when that page is shown again. */
  const composed = useRef("")
  const [turn, setTurn] = useState(0)
  const handlers = useRef({ onState, onOpen })
  handlers.current = { onState, onOpen }

  const page = () => (frame.current?.contentWindow?.location.pathname ?? "").replace(/^\/site\//, "").replace(/\/$/, "/index.html")
  const tell = useCallback(() => handlers.current.onState({
    page: page(), moves: composed.current === page() ? done.current.map(({ key, before }) => ({ key, before })) : [],
    canUndo: done.current.length > 0 && composed.current === page(), canRedo: undone.current.length > 0 && composed.current === page(),
  }), [])

  useImperativeHandle(ref, () => ({
    undo() {
      const doc = frame.current?.contentDocument, op = done.current.pop()
      if (!doc || !op) return
      place(doc, op.key, op.was); undone.current.push(op); tell()
    },
    redo() {
      const doc = frame.current?.contentDocument, op = undone.current.pop()
      if (!doc || !op) return
      place(doc, op.key, op.before); done.current.push(op); tell()
    },
    discard() {
      const doc = frame.current?.contentDocument
      if (doc) for (const op of [...done.current].reverse()) place(doc, op.key, op.was)
      done.current = []; undone.current = []; tell()
    },
    saved() { done.current = []; undone.current = []; tell() },
    reload() { setTurn(t => t + 1) },
    go(path) { const win = frame.current?.contentWindow; if (win) win.location.href = `/site/${path.replace(/^\//, "")}` },
  }), [tell])

  const onLoad = () => {
    const doc = frame.current?.contentDocument, win = frame.current?.contentWindow
    if (!doc || !win) return
    const style = doc.createElement("style")
    style.textContent = `
      figure.item.ohm-lifted { opacity: .3 !important; }
      figure.item.ohm-before { box-shadow: inset 4px 0 0 ${accent}, inset 0 4px 0 ${accent} !important; }
      figure.item.ohm-after { box-shadow: inset -4px 0 0 ${accent}, inset 0 -4px 0 ${accent} !important; }
      body.ohm-moving, body.ohm-moving * { cursor: grabbing !important; user-select: none !important; }
    `
    doc.head.append(style)
    // Moves made on this page before it was left are put back, so they are still there to save.
    if (composed.current === page()) for (const op of done.current) place(doc, op.key, op.before)
    tell()

    // The site's own links stay inside the canvas: `/writing/` is this site's page, not the app's.
    doc.addEventListener("click", e => {
      const el = e.target as Element
      const link = el.closest?.("a[href]") as HTMLAnchorElement | null
      const item = el.closest?.("figure.item, a.read-card")
      if (item && (e.metaKey || e.ctrlKey)) {
        e.preventDefault(); e.stopPropagation()
        return handlers.current.onOpen(item.matches("figure.item") ? `photo:${keyOf(item)}` : new URL((item as HTMLAnchorElement).href).pathname + new URL((item as HTMLAnchorElement).href).hash)
      }
      if (!link || link.target === "_blank" || link.origin !== win.location.origin || link.pathname.startsWith("/site/")) return
      if (link.getAttribute("href")?.startsWith("#")) return
      e.preventDefault()
      win.location.href = `/site${link.pathname}${link.search}${link.hash}`
    }, true)

    // Picking a photograph up: it follows only once the pointer has really moved, so a click is still the site's own.
    let held: { figure: HTMLElement; x: number; y: number; moving: boolean; target: HTMLElement | null; after: boolean } | null = null
    const clear = () => doc.querySelectorAll(".ohm-before, .ohm-after, .ohm-lifted").forEach(el => el.classList.remove("ohm-before", "ohm-after", "ohm-lifted"))
    doc.addEventListener("dragstart", e => { if ((e.target as Element).closest?.("#grid")) e.preventDefault() }, true)
    doc.addEventListener("pointerdown", e => {
      const figure = (e.target as Element).closest?.("#grid figure.item") as HTMLElement | null
      if (figure && e.button === 0 && !e.metaKey && !e.ctrlKey) held = { figure, x: e.clientX, y: e.clientY, moving: false, target: null, after: false }
    }, true)
    doc.addEventListener("pointermove", e => {
      if (!held) return
      if (!held.moving && Math.hypot(e.clientX - held.x, e.clientY - held.y) < 8) return
      held.moving = true
      doc.body.classList.add("ohm-moving")
      clear()
      held.figure.classList.add("ohm-lifted")
      const over = (doc.elementFromPoint(e.clientX, e.clientY)?.closest("#grid figure.item") ?? null) as HTMLElement | null
      held.target = over && over !== held.figure ? over : null
      if (held.target) {
        const box = held.target.getBoundingClientRect()
        held.after = e.clientY > box.top + box.height / 2
        held.target.classList.add(held.after ? "ohm-after" : "ohm-before")
      }
    }, true)
    doc.addEventListener("pointerup", () => {
      const h = held
      held = null
      doc.body.classList.remove("ohm-moving")
      clear()
      if (!h?.moving) return
      // The click that ends a move is not a click on the photograph.
      doc.addEventListener("click", e => { e.preventDefault(); e.stopPropagation() }, { capture: true, once: true })
      if (!h.target) return
      const key = keyOf(h.figure), was = nextKey(h.figure)
      const before = h.after ? nextKey(h.target) : keyOf(h.target)
      if (before === key || before === was) return
      if (composed.current !== page()) { done.current = []; composed.current = page() }
      place(doc, key, before)
      done.current.push({ key, before, was }); undone.current = []
      tell()
    }, true)
  }

  // Zooming out shows more of the site at once: the page is given a larger window and drawn smaller.
  return (
    <div className="relative min-h-0 flex-1 overflow-hidden bg-white">
      <iframe ref={frame} key={turn} title="Your site" src={start} onLoad={onLoad} className="absolute top-0 left-0 block origin-top-left bg-white"
        style={{ width: `${100 / zoom}%`, height: `${100 / zoom}%`, transform: `scale(${zoom})` }} />
    </div>
  )
})
