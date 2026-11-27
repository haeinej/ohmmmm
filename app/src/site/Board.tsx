// The home screen's canvas (docs/plans/information-and-viewer.md): a white, endless plane to think
// on. Drag a block or a channel from the side panel onto it; it becomes a card you can move, and a
// block's card opens the block. Drag the empty plane, or scroll, to move around; pinch or ⌘-scroll
// to zoom. ⌘Z and ⇧⌘Z take a change back and do it again; Delete takes the chosen card off.
//
// For now the board is kept in this browser (localStorage), not in the home: what it should be as a
// file is still open in the plan, and a canvas that is used first will say what it needs.
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react"
import { cn } from "@/lib/cn"
import { notify } from "@/components/ui/notice"
import { Icon } from "@/components/ui/icon"
import { Button } from "@/components/ui/button"
import { AgentMark, agentName, useLiveStatus } from "./AgentStatus"
import { connected } from "./live"
import { ToolFrame } from "./ToolFrame"
import { BlockCard, CARD, LinkCard, ReaderScale, CHANNEL_VIEWS, ChannelCard, PageCard, type ChannelView } from "./Cards"
import { goTo, type Place } from "./nav"
import { LIVE_ACTIVITY, LIVE_BOARD, LIVE_VIEW, readBoard, runPrompt, saveBoard, shareSelection, stopPrompt, THIS_WINDOW, type LiveActivity } from "./live"
import { addLink, LINKS_CHANGED, NEW_NOTE, NEW_PROMPT, readLinks, siteUrl, type Change, type SiteLink, type SiteContent, type SiteItem } from "./source"
import { ArticleView } from "./ArticleView"

/** A page's name from its path: `writings/index.html` is Writings; the site's own index is Home. */
export const pageTitle = (path: string) => {
  const stem = path.replace(/(^|\/)index\.html?$/i, "").replace(/\.html?$/i, "").split("/").filter(Boolean).at(-1)
  return stem ? stem.replace(/[-_]+/g, " ").replace(/^./, c => c.toUpperCase()) : "Home"
}

export const ITEM = "application/x-ohm-site-item"
export const CHANNEL = "application/x-ohm-site-channel"
/** A file of the site, from Sources; an HTML file lands as a live page. */
export const FILE = "application/x-ohm-site-file"
/** A kept link (a page that isn't yours), from Artifacts. */
export const LINK = "application/x-ohm-site-link"
/** A tool, from the panel's Tools: its name. */
export const TOOL = "application/x-ohm-site-tool"
/** A page lands at a computer screen's shape: 16:10. */
export const PAGE_SIZE = { w: 480, h: 300 }
const isPage = (path: string) => /\.html?$/i.test(path)

/** A card on the board: where it is, how big (at least the panel's tile), and for a channel, how it is shown. */
export type Card =
  | { id: string; kind: "block"; path: string; x: number; y: number; w?: number; h?: number }
  | { id: string; kind: "channel"; name: string; x: number; y: number; w?: number; h?: number; view?: ChannelView }
  /** A note: the canvas's own, for annotating what is on it. Not a block; it stays on the canvas. */
  | { id: string; kind: "note"; text: string; x: number; y: number; w?: number; h?: number }
  /** A prompt to an agent: written here, sent, picked up by the agent over MCP and answered under it. */
  | { id: string; kind: "prompt"; text: string; to: string; status: "draft" | "waiting" | "working" | "done" | "declined"; answer?: string; by?: string; sent?: string; x: number; y: number; w?: number; h?: number }
  /** An internal tool an agent built, running sandboxed on the canvas. */
  | { id: string; kind: "tool"; name: string; x: number; y: number; w?: number; h?: number }
  /** A kept link: a page that isn't the person's, shown by what it says about itself. */
  | { id: string; kind: "link"; link: SiteLink; x: number; y: number; w?: number; h?: number }
  /** A page of the site, live: its path in the site folder. */
  | { id: string; kind: "page"; path: string; x: number; y: number; w?: number; h?: number }
type View = { x: number; y: number; zoom: number }
export type BoardState = { canUndo: boolean; canRedo: boolean; zoom: number; count: number }
export type BoardHandle = { undo(): void; redo(): void; zoomBy(by: number): void }

/** An arrow from one card to another, with words on it if any. */
export type Arrow = { id: string; from: string; to: string; text?: string }
const KEY = "ohm.board.v1"
const read = (): Card[] => { try { return JSON.parse(localStorage.getItem(KEY) ?? "[]") } catch { return [] } }
export const id = () => Math.random().toString(36).slice(2, 10)

/**
 * A prompt to an agent, on the canvas: who it is for (its mark, green while it is connected), what is asked,
 * and how it stands. Written and sent here; the agent reads it with prompts_waiting and answers with
 * prompt_answer, and the answer appears under it as it comes.
 */
export function PromptCard({ card, on, onChange }: { card: Extract<Card, { kind: "prompt" }>; on: boolean; onChange(next: Partial<Extract<Card, { kind: "prompt" }>>): void }) {
  const s = useLiveStatus()
  const who = agentName(card.to)
  const say = { draft: "Not sent", waiting: `Waiting for ${who}`, working: `${who} is working`, done: "Done", declined: `${who} declined` }[card.status]
  const [text, setText] = useState(card.text)
  useEffect(() => setText(card.text), [card.text])
  return (
    <span className="ohm-card flex size-full flex-col overflow-hidden rounded-2xl bg-card shade-2">
      <span className="flex items-center gap-2 px-3 pt-3 text-small">
        <AgentMark agent={card.to} on={connected(s, card.to)} />
        <span className="font-medium">{who}</span>
        <span className={cn("ms-auto text-[11px]", card.status === "working" ? "text-foreground" : "text-muted-foreground")}>{say}</span>
      </span>
      {card.status === "draft"
        ? <textarea aria-label={`Prompt to ${who}`} placeholder={`Ask ${who} to do something…`} value={text} readOnly={!on} autoFocus={on && !card.text}
            onChange={e => setText(e.target.value)} onBlur={() => { if (text !== card.text) onChange({ text }) }}
            onPointerDown={on ? e => e.stopPropagation() : undefined}
            className={cn("min-h-0 flex-1 resize-none bg-transparent px-3 pt-2 text-body leading-snug outline-none placeholder:text-muted-foreground", !on && "pointer-events-none")} />
        : <span className="min-h-0 flex-1 overflow-y-auto px-3 pt-2 text-body leading-snug whitespace-pre-wrap">{card.text}</span>}
      {card.answer && (card.status === "working" || card.status === "done" || card.status === "declined") && (
        <span className="mx-3 mb-2 max-h-[45%] overflow-y-auto rounded-lg bg-muted px-2.5 py-2 text-small leading-snug whitespace-pre-wrap">{card.answer}</span>
      )}
      <span className="flex items-center gap-2 px-3 pb-3">
        {card.status === "draft" && (
          <Button size="sm" className="ms-auto" disabled={!text.trim()} onPointerDown={e => e.stopPropagation()}
            onClick={() => onChange({ text, status: "waiting", sent: new Date().toISOString() })}>Send to {who}</Button>
        )}
        {card.status === "working" && (
          <Button size="sm" variant="ghost" className="ms-auto" onPointerDown={e => e.stopPropagation()} onClick={() => void stopPrompt(card.id)}>Stop</Button>
        )}
        {(card.status === "done" || card.status === "declined") && (
          <Button size="sm" variant="ghost" className="ms-auto" onPointerDown={e => e.stopPropagation()} onClick={() => onChange({ status: "draft", answer: undefined })}>Ask again</Button>
        )}
      </span>
    </span>
  )
}

/**
 * The arrows between cards, drawn under them: a thin ink line from edge to edge with a small head, its
 * words in a quiet pill at the middle. A chosen arrow is darker; it can be taken off with Delete.
 */
function Arrows({ cards, arrows, picked, drawing, onPick }: { cards: Card[]; arrows: Arrow[]; picked: string | null; drawing: { from: string; x: number; y: number } | null; onPick(id: string): void }) {
  const box = (c: Card) => { const w = c.w ?? (c.kind === "page" ? PAGE_SIZE.w : CARD.w), h = c.h ?? (c.kind === "page" ? PAGE_SIZE.h : CARD.h); return { x: c.x, y: c.y, w, h, cx: c.x + w / 2, cy: c.y + h / 2 } }
  // Where the line from a box's centre toward a point leaves the box, a little outside it.
  const edge = (b: ReturnType<typeof box>, tx: number, ty: number) => {
    const dx = tx - b.cx, dy = ty - b.cy
    const t = Math.min(dx ? (b.w / 2 + 6) / Math.abs(dx) : Infinity, dy ? (b.h / 2 + 6) / Math.abs(dy) : Infinity)
    return { x: b.cx + dx * t, y: b.cy + dy * t }
  }
  // A soft curve, leaving and arriving along the longer way between the two ends; its middle carries the words.
  const curve = (s: { x: number; y: number }, e: { x: number; y: number }) => {
    const dx = e.x - s.x, dy = e.y - s.y, across = Math.abs(dx) >= Math.abs(dy)
    const c1 = across ? { x: s.x + dx / 2, y: s.y } : { x: s.x, y: s.y + dy / 2 }
    const c2 = across ? { x: e.x - dx / 2, y: e.y } : { x: e.x, y: e.y - dy / 2 }
    return { s, e, d: `M${s.x} ${s.y} C${c1.x} ${c1.y} ${c2.x} ${c2.y} ${e.x} ${e.y}`, m: { x: (s.x + 3 * c1.x + 3 * c2.x + e.x) / 8, y: (s.y + 3 * c1.y + 3 * c2.y + e.y) / 8 } }
  }
  const byId = new Map(cards.map(c => [c.id, box(c)]))
  const lines = arrows.flatMap(a => {
    const f = byId.get(a.from), t = byId.get(a.to)
    if (!f || !t) return []
    return [{ a, ...curve(edge(f, t.cx, t.cy), edge(t, f.cx, f.cy)) }]
  })
  const from = drawing ? byId.get(drawing.from) : undefined
  return (
    <svg aria-label="Arrows" className="pointer-events-none absolute top-0 left-0 overflow-visible" width="1" height="1">
      <defs>
        <marker id="ohm-head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 Z" fill="var(--foreground)" opacity="0.55" /></marker>
        <marker id="ohm-head-on" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 Z" fill="var(--foreground)" /></marker>
      </defs>
      {lines.map(({ a, d, m }) => {
        const on = picked === a.id
        return (
          <g key={a.id} className="pointer-events-auto cursor-pointer" onPointerDown={ev => { ev.stopPropagation(); onPick(a.id) }}>
            <path d={d} fill="none" stroke="transparent" strokeWidth="14" />
            <path d={d} fill="none" stroke="var(--foreground)" strokeOpacity={on ? 1 : 0.45} strokeWidth={on ? 2 : 1.5} strokeLinecap="round" markerEnd={`url(#${on ? "ohm-head-on" : "ohm-head"})`} />
            {a.text && (
              <foreignObject x={m.x - 80} y={m.y - 12} width="160" height="24" className="overflow-visible">
                <div className="flex justify-center"><span className="max-w-40 truncate rounded-full bg-card px-2 py-0.5 text-[11px] text-muted-foreground shade-1">{a.text}</span></div>
              </foreignObject>
            )}
          </g>
        )
      })}
      {drawing && from && (() => { const { d } = curve(edge(from, drawing.x, drawing.y), { x: drawing.x, y: drawing.y }); return <path d={d} fill="none" stroke="var(--foreground)" strokeOpacity="0.45" strokeWidth="1.5" strokeDasharray="4 4" markerEnd="url(#ohm-head)" /> })()}
    </svg>
  )
}

export const Board = forwardRef<BoardHandle, { content: SiteContent | null; colors: Record<string, string>; onState(state: BoardState): void
  /** Save a change to a page's file: a writing edited inside its card. */
  onSave(page: string, change: Change): Promise<unknown> }>(
  function Board({ content, colors, onState, onSave }, ref) {
    const [cards, setCards] = useState<Card[]>(read)
    const [view, setView] = useState<View>({ x: 0, y: 0, zoom: 1 })
    // What is chosen: one card or many. One alone is live (a page, a writing) and shows its views; many move and go together.
    const [picked, setPicked] = useState<string[]>([])
    const chosen = picked.length === 1 ? picked[0] : null
    const setChosen = (id: string | null) => setPicked(id ? [id] : [])
    const [brush, setBrush] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
    const spaceHeld = useRef(false)
    useEffect(() => {
      const down = (e: KeyboardEvent) => { if (e.code === "Space" && !(e.target as HTMLElement).closest?.("input, textarea, [contenteditable]")) spaceHeld.current = true }
      const up = (e: KeyboardEvent) => { if (e.code === "Space") spaceHeld.current = false }
      window.addEventListener("keydown", down); window.addEventListener("keyup", up)
      return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up) }
    }, [])
    const [over, setOver] = useState(false)
    const past = useRef<{ cards: Card[]; arrows: Arrow[] }[]>([])
    const future = useRef<{ cards: Card[]; arrows: Arrow[] }[]>([])
    const [arrows, setArrows] = useState<Arrow[]>([])
    const arrowsRef = useRef(arrows)
    arrowsRef.current = arrows
    const [pickedArrow, setPickedArrow] = useState<string | null>(null)
    const [drawing, setDrawing] = useState<{ from: string; x: number; y: number } | null>(null)
    const plane = useRef<HTMLDivElement>(null)
    const last = useRef({ id: "", at: 0 })
    const hold = useRef(0)
    const drag = useRef<{ kind: "pan" | "card" | "size" | "brush"; id?: string; sx: number; sy: number; ox: number; oy: number; before: Card[]; moved: boolean
      /** Where each moving card started, for a group; and, for a brush, the cards chosen before it began. */
      from?: Record<string, { x: number; y: number }>; base?: string[] } | null>(null)

    // The board lives in the home (site/.ohm/board.json), so a coding agent can see and change it too.
    // It loads from there (taking this browser's old board along the first time), saves there a moment
    // after each change, and follows changes made elsewhere as they happen.
    const rev = useRef(-1)
    // Cards an agent just worked on (its hooks said so): its name on them for a moment, as a collaborator's.
    const [touched, setTouched] = useState<Record<string, string>>({})
    useEffect(() => {
      const timers = new Map<string, number>()
      const on = (e: Event) => {
        const a = (e as CustomEvent<LiveActivity>).detail
        if (!a.path) return
        const hit = cardsRef.current.filter(c => ((c.kind === "block" || c.kind === "page") && c.path === a.path) || (c.kind === "tool" && a.path.startsWith(`tools/${c.name}/`)))
        for (const c of hit) {
          setTouched(t => ({ ...t, [c.id]: a.agent }))
          clearTimeout(timers.get(c.id))
          timers.set(c.id, window.setTimeout(() => setTouched(({ [c.id]: _, ...rest }) => rest), 4000))
        }
      }
      window.addEventListener(LIVE_ACTIVITY, on)
      return () => { window.removeEventListener(LIVE_ACTIVITY, on); for (const t of timers.values()) clearTimeout(t) }
    }, [])
    const showing = useRef("")
    const loaded = useRef(false)
    useEffect(() => {
      const load = () => readBoard<Card>().then(async b => {
        if (!b) return
        const local = cardsRef.current
        // The first time: a home with no board yet takes this browser's, and the browser's stays as it is
        // until the home has it. An empty board from the home never replaces cards held here.
        if (!loaded.current && b.cards.length === 0 && local.length) {
          const r = await saveBoard(local)
          if (r !== null) { rev.current = r; loaded.current = true }
          return
        }
        loaded.current = true; rev.current = b.rev; setCards(b.cards); setArrows((b as unknown as { arrows?: Arrow[] }).arrows ?? [])
      })
      void load()
      // A change from anywhere but this window (an agent, another window) is loaded; this window's own is not.
      const onBoard = (e: Event) => { const d = (e as CustomEvent<{ rev: number; by: string }>).detail; if (d.by !== `app:${THIS_WINDOW}` || d.rev > rev.current + 1) void load() }
      // Asked to show a card the board doesn't have yet (it was just added): show it once it arrives.
      const onView = (e: Event) => { const id = (e as CustomEvent<{ id: string }>).detail.id; const card = cardsRef.current.find(c => c.id === id); if (card) { centerOn(card); setChosen(card.id) } else showing.current = id }
      window.addEventListener(LIVE_BOARD, onBoard); window.addEventListener(LIVE_VIEW, onView)
      return () => { window.removeEventListener(LIVE_BOARD, onBoard); window.removeEventListener(LIVE_VIEW, onView) }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
    // Which kept links may be shown live: read from the links themselves, so the board never holds a stale answer.
    const [framed, setFramed] = useState<Set<string>>(new Set())
    useEffect(() => {
      const read = () => { readLinks().then(ls => setFramed(new Set(ls.filter(l => l.frameable).map(l => l.url))), () => {}) }
      read(); window.addEventListener(LINKS_CHANGED, read)
      return () => window.removeEventListener(LINKS_CHANGED, read)
    }, [])
    const cardsRef = useRef(cards)
    cardsRef.current = cards
    useEffect(() => {
      localStorage.setItem(KEY, JSON.stringify(cards))
      // A second copy that only ever holds a board with cards on it: a way back if one is ever emptied by mistake.
      if (cards.length) localStorage.setItem(`${KEY}.last`, JSON.stringify(cards))
      if (!loaded.current) return
      const t = setTimeout(() => { void saveBoard(cards, arrowsRef.current).then(r => { if (r !== null) rev.current = r }) }, 400)
      return () => clearTimeout(t)
    }, [cards, arrows])
    useEffect(() => shareSelection(picked), [picked])
    const centerOn = (card: Card) => {
      const r = plane.current?.getBoundingClientRect()
      if (!r) return
      setView(v => ({ ...v, x: r.width / 2 - (card.x + (card.w ?? CARD.w) / 2) * v.zoom, y: r.height / 2 - (card.y + (card.h ?? CARD.h) / 2) * v.zoom }))
    }
    useEffect(() => {
      const card = showing.current && cards.find(c => c.id === showing.current)
      if (card) { showing.current = ""; centerOn(card); setChosen(card.id) }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [cards])
    useEffect(() => onState({ canUndo: past.current.length > 0, canRedo: future.current.length > 0, zoom: view.zoom, count: cards.length }), [cards, view.zoom, onState])

    /** Change the board, keeping where it was so it can be taken back. */
    const change = useCallback((next: Card[], before: Card[] = cards) => {
      past.current.push({ cards: before, arrows: arrowsRef.current }); future.current = []
      // An arrow goes with a card it joined.
      const ids = new Set(next.map(c => c.id))
      setArrows(as => as.filter(a => ids.has(a.from) && ids.has(a.to)))
      setCards(next)
    }, [cards])
    const changeArrows = useCallback((next: Arrow[]) => { past.current.push({ cards, arrows: arrowsRef.current }); future.current = []; setArrows(next) }, [cards])
    const zoomAt = useCallback((factor: number, cx?: number, cy?: number) => setView(v => {
      const zoom = Math.max(0.25, Math.min(2.5, v.zoom * factor))
      const r = plane.current?.getBoundingClientRect()
      const px = cx ?? (r ? r.width / 2 : 0), py = cy ?? (r ? r.height / 2 : 0)
      return { zoom, x: px - ((px - v.x) * zoom) / v.zoom, y: py - ((py - v.y) * zoom) / v.zoom }
    }), [])
    useImperativeHandle(ref, () => ({
      undo: () => { const prev = past.current.pop(); if (prev) { future.current.push({ cards, arrows: arrowsRef.current }); setCards(prev.cards); setArrows(prev.arrows) } },
      redo: () => { const next = future.current.pop(); if (next) { past.current.push({ cards, arrows: arrowsRef.current }); setCards(next.cards); setArrows(next.arrows) } },
      zoomBy: by => zoomAt(by),
    }), [cards, zoomAt])

    // Scroll moves the plane; ⌘-scroll or a pinch zooms where the pointer is. Not passive, so the page itself never scrolls.
    useEffect(() => {
      const el = plane.current
      if (!el) return
      const onWheel = (e: WheelEvent) => {
        // Inside a chosen card, scrolling is the card's own, as in a tab.
        if ((e.target as HTMLElement).closest?.("[data-live]")) return
        e.preventDefault()
        if (e.ctrlKey || e.metaKey) { const r = el.getBoundingClientRect(); zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top) }
        else setView(v => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }))
      }
      el.addEventListener("wheel", onWheel, { passive: false })
      return () => el.removeEventListener("wheel", onWheel)
    }, [zoomAt])

    // The rack's +: a note, in the middle of what is on screen, chosen so it can be written in at once.
    useEffect(() => {
      const onNote = () => {
        const r = plane.current?.getBoundingClientRect()
        const at = r ? { x: (r.width / 2 - view.x) / view.zoom, y: (r.height / 2 - view.y) / view.zoom } : { x: 0, y: 0 }
        const card: Card = { id: id(), kind: "note", text: "", x: at.x - 110, y: at.y - 70, w: 220, h: 140 }
        change([...cards, card]); setChosen(card.id)
      }
      const onPrompt = (e: Event) => {
        const begun = (e as CustomEvent<string | undefined>).detail ?? ""
        const r = plane.current?.getBoundingClientRect()
        const at = r ? { x: (r.width / 2 - view.x) / view.zoom, y: (r.height / 2 - view.y) / view.zoom } : { x: 0, y: 0 }
        const card: Card = { id: id(), kind: "prompt", text: begun, to: "claude-code", status: "draft", x: at.x - 160, y: at.y - 110, w: 320, h: 220 }
        change([...cards, card]); setChosen(card.id)
      }
      window.addEventListener(NEW_NOTE, onNote); window.addEventListener(NEW_PROMPT, onPrompt)
      return () => { window.removeEventListener(NEW_NOTE, onNote); window.removeEventListener(NEW_PROMPT, onPrompt) }
    }, [cards, view, change])


    // As on Are.na: paste a web address anywhere on the canvas and it is kept as a link, its card where you are looking.
    useEffect(() => {
      const onPaste = (e: ClipboardEvent) => {
        if ((e.target as HTMLElement).closest?.("input, textarea, [contenteditable]")) return
        const text = e.clipboardData?.getData("text/plain").trim() ?? ""
        if (!/^https?:\/\/\S+$/.test(text)) return
        e.preventDefault()
        addLink(text).then(link => {
          const r = plane.current?.getBoundingClientRect()
          const at = r ? { x: (r.width / 2 - view.x) / view.zoom, y: (r.height / 2 - view.y) / view.zoom } : { x: 0, y: 0 }
          const card: Card = { id: id(), kind: "link", link, x: at.x - 160, y: at.y - 130, w: 320, h: 260 }
          change([...cards, card]); setChosen(card.id)
        }, problem => notify({ message: (problem as Error).message, tone: "error" }))
      }
      window.addEventListener("paste", onPaste)
      return () => window.removeEventListener("paste", onPaste)
    }, [cards, view, change])

    useEffect(() => {
      const onKey = (e: KeyboardEvent) => {
        if ((e.target as HTMLElement).closest?.("input, textarea, [contenteditable]")) return
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") { e.preventDefault(); setPicked(cards.map(c => c.id)); return }
        if (e.key === "Escape") { setPicked([]); setPickedArrow(null); return }
        if (pickedArrow && (e.key === "Backspace" || e.key === "Delete")) { e.preventDefault(); changeArrows(arrowsRef.current.filter(a => a.id !== pickedArrow)); setPickedArrow(null); return }
        if (!picked.length) return
        if (e.key === "Backspace" || e.key === "Delete") { e.preventDefault(); const gone = new Set(picked); change(cards.filter(c => !gone.has(c.id))); setPicked([]) }
      }
      window.addEventListener("keydown", onKey)
      return () => window.removeEventListener("keydown", onKey)
    }, [picked, cards, change, pickedArrow, changeArrows])

    const items = new Map((content?.collections ?? []).flatMap(c => c.items).map(i => [i.path, i]))
    const channelItems = (name: string) => {
      const [outer, inner] = name.split("/")
      const c = content?.collections.find(x => x.name === outer)
      return c ? (inner ? c.items.filter(i => i.channel === inner) : c.items) : []
    }
    const toPlane = (clientX: number, clientY: number) => {
      const r = plane.current!.getBoundingClientRect()
      return { x: (clientX - r.left - view.x) / view.zoom, y: (clientY - r.top - view.y) / view.zoom }
    }

    return (
      <div ref={plane} aria-label="Canvas" className={cn("relative min-h-0 flex-1 touch-none overflow-hidden bg-white select-none dark:bg-card", over && "ring-2 ring-inset ring-primary/30")}
        onDragOver={e => { if (e.dataTransfer.types.includes(ITEM) || e.dataTransfer.types.includes(CHANNEL) || e.dataTransfer.types.includes(FILE) || e.dataTransfer.types.includes(LINK) || e.dataTransfer.types.includes(TOOL)) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; setOver(true) } }}
        onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false) }}
        onDrop={e => {
          setOver(false)
          const at = toPlane(e.clientX, e.clientY)
          const item = e.dataTransfer.getData(ITEM), channel = e.dataTransfer.getData(CHANNEL), file = e.dataTransfer.getData(FILE)
          const kept = e.dataTransfer.getData(LINK)
          const tool = e.dataTransfer.getData(TOOL)
          if (tool) {
            e.preventDefault()
            const card: Card = { id: id(), kind: "tool", name: tool, x: at.x - 210, y: at.y - 160, w: 420, h: 320 }
            change([...cards, card]); setChosen(card.id)
            return
          }
          if (kept) {
            e.preventDefault()
            const card: Card = { id: id(), kind: "link", link: JSON.parse(kept) as SiteLink, x: at.x - 160, y: at.y - 100, w: 320, h: 260 }
            change([...cards, card]); setChosen(card.id)
            return
          }
          if (file && isPage(file)) {
            e.preventDefault()
            const card: Card = { id: id(), kind: "page", path: file, x: at.x - PAGE_SIZE.w / 2, y: at.y - 16, w: PAGE_SIZE.w, h: PAGE_SIZE.h }
            change([...cards, card]); setChosen(card.id)
            return
          }
          if (!item && !channel) return
          e.preventDefault()
          const card: Card = item
            ? { id: id(), kind: "block", path: (JSON.parse(item) as SiteItem).path, x: at.x - CARD.w / 2, y: at.y - CARD.h / 2 }
            : { id: id(), kind: "channel", name: channel, x: at.x - CARD.w / 2, y: at.y - CARD.h / 2 }
          change([...cards, card]); setChosen(card.id)
        }}
        onPointerDown={e => {
          // The middle button, or Space held, moves around; scrolling and two fingers do too.
          setPickedArrow(null)
          const joining = e.button === 0 && (e.target as HTMLElement).closest("[data-join]")
          if (joining) {
            // From the dot on a chosen card's edge: let go on another card, and an arrow joins them.
            const from = (e.target as HTMLElement).closest<HTMLElement>("[data-card]")?.dataset.card
            if (from) { const p = toPlane(e.clientX, e.clientY); setDrawing({ from, x: p.x, y: p.y }); try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* gone */ } }
            return
          }
          if (e.button === 1 || (e.button === 0 && spaceHeld.current)) {
            drag.current = { kind: "pan", sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y, before: cards, moved: false }
            try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* gone */ }
            return
          }
          if (e.button !== 0) return
          const corner = (e.target as HTMLElement).closest<HTMLElement>("[data-size]")
          const el = (e.target as HTMLElement).closest<HTMLElement>("[data-card]")
          const card = el ? cards.find(c => c.id === el.dataset.card) : undefined
          // Shift adds a card to what is chosen, or takes it away; a card already among many keeps them all.
          if (card && e.shiftKey) { setPicked(p => (p.includes(card.id) ? p.filter(i => i !== card.id) : [...p, card.id])); return }
          const group = card && picked.includes(card.id) && picked.length > 1 ? picked : card ? [card.id] : []
          if (card) setPicked(group)
          // A second press on a block's card opens it. (Held, the canvas takes the card's clicks, so this is read here.)
          const again = card && last.current.id === card.id && e.timeStamp - last.current.at < 400
          last.current = { id: card?.id ?? "", at: e.timeStamp }
          if (again && card.kind === "block" && items.has(card.path)) { goTo({ kind: "block", path: card.path }); return }
          if (again && card.kind === "page") { goTo({ kind: "page", path: card.path }); return }
          // Held still for a moment, a block, a page or a channel opens beside your card.
          clearTimeout(hold.current)
          if (card) {
            const to: Place | null = card.kind === "channel" ? { kind: "channel", name: card.name }
              : card.kind === "page" ? { kind: "page", path: card.path }
              : card.kind === "link" ? { kind: "link", url: card.link.url, title: card.link.title }
              : card.kind === "tool" ? { kind: "tool", name: card.name, title: card.name } : card.kind === "block" && items.has(card.path) ? { kind: "block", path: card.path } : null
            if (to) hold.current = window.setTimeout(() => { if (!drag.current?.moved) { drag.current = null; goTo(to) } }, 450)
          }
          if (corner && card) {
            drag.current = { kind: "size", id: card.id, sx: e.clientX, sy: e.clientY, ox: card.w ?? (card.kind === "page" ? PAGE_SIZE.w : CARD.w), oy: card.h ?? (card.kind === "page" ? PAGE_SIZE.h : CARD.h), before: cards, moved: false }
            try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* a pointer the browser no longer knows */ }
            return
          }
          if ((e.target as HTMLElement).closest("[data-views]")) return
          if (card) {
            const from = Object.fromEntries(cards.filter(c => group.includes(c.id)).map(c => [c.id, { x: c.x, y: c.y }]))
            drag.current = { kind: "card", id: card.id, sx: e.clientX, sy: e.clientY, ox: card.x, oy: card.y, before: cards, moved: false, from }
          } else {
            // On the empty canvas, a drag draws a box: every card it touches is chosen (with Shift, added).
            const base = e.shiftKey ? picked : []
            if (!e.shiftKey) setPicked([])
            drag.current = { kind: "brush", sx: e.clientX, sy: e.clientY, ox: 0, oy: 0, before: cards, moved: false, base }
          }
          try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* a pointer the browser no longer knows */ }
        }}
        onPointerMove={e => {
          if (drawing) { const p = toPlane(e.clientX, e.clientY); setDrawing(dr => (dr ? { ...dr, x: p.x, y: p.y } : dr)); return }
          const d = drag.current
          if (!d) return
          const dx = e.clientX - d.sx, dy = e.clientY - d.sy
          if (Math.abs(dx) + Math.abs(dy) > 3) { d.moved = true; clearTimeout(hold.current) }
          if (d.kind === "pan") setView(v => ({ ...v, x: d.ox + dx, y: d.oy + dy }))
          else if (d.kind === "size") {
            // From the corner: a block keeps its shape, 3:4; a channel can take any shape. Never smaller than the tile.
            const card = cards.find(c => c.id === d.id)
            const w = Math.max(CARD.w, d.ox + dx / view.zoom)
            const h = card?.kind === "block" ? (w * CARD.h) / CARD.w : Math.max(CARD.h, d.oy + dy / view.zoom)
            setCards(cs => cs.map(c => (c.id === d.id ? { ...c, w, h } : c)))
          }
          else if (d.kind === "brush") {
            const a = toPlane(d.sx, d.sy), b = toPlane(e.clientX, e.clientY)
            const box = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) }
            setBrush(box)
            const touched = cards.filter(c => {
              const w = c.w ?? (c.kind === "page" ? PAGE_SIZE.w : CARD.w), h = c.h ?? (c.kind === "page" ? PAGE_SIZE.h : CARD.h)
              return c.x < box.x + box.w && c.x + w > box.x && c.y < box.y + box.h && c.y + h > box.y
            }).map(c => c.id)
            setPicked([...new Set([...(d.base ?? []), ...touched])])
          }
          else setCards(cs => cs.map(c => (d.from?.[c.id] ? { ...c, x: d.from[c.id].x + dx / view.zoom, y: d.from[c.id].y + dy / view.zoom } : c)))
        }}
        onPointerUp={e => {
          if (drawing) {
            const under = document.elementsFromPoint(e.clientX, e.clientY).map(el => (el as HTMLElement).closest?.("[data-card]") as HTMLElement | null).find(Boolean)
            const to = under?.dataset.card
            if (to && to !== drawing.from && !arrowsRef.current.some(a => a.from === drawing.from && a.to === to))
              changeArrows([...arrowsRef.current, { id: id(), from: drawing.from, to }])
            setDrawing(null)
            return
          }
          clearTimeout(hold.current)
          const d = drag.current
          drag.current = null
          setBrush(null)
          if ((d?.kind === "card" || d?.kind === "size") && d.moved) { past.current.push({ cards: d.before, arrows: arrowsRef.current }); future.current = []; setCards(cs => [...cs]) }
        }}>
        <div className="absolute top-0 left-0 origin-top-left" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}>
          <Arrows cards={cards} arrows={arrows} picked={pickedArrow} drawing={drawing} onPick={id => { setPickedArrow(id); setPicked([]) }} />
          {cards.map(card => {
            const block = card.kind === "block" ? items.get(card.path) : undefined
            const w = card.w ?? (card.kind === "page" ? PAGE_SIZE.w : CARD.w), h = card.h ?? (card.kind === "page" ? PAGE_SIZE.h : CARD.h)
            const on = chosen === card.id
            const among = picked.includes(card.id)
            return (
              <div key={card.id} data-card={card.id} style={{ left: card.x, top: card.y, width: w, height: h }}
                className={cn("group absolute cursor-grab rounded-2xl transition-shadow duration-(--ohm-duration-state) active:cursor-grabbing", (on || among) && "shade-4 ring-1 ring-foreground/15", touched[card.id] && "ring-2 ring-(--ohm-mark-clay)")}>
                {card.kind === "tool"
                  ? <span className="ohm-card block size-full overflow-hidden rounded-2xl bg-card shade-2"><ToolFrame name={card.name} live={on} /></span>
                  : card.kind === "prompt"
                  ? <PromptCard card={card} on={on} onChange={next => {
                      const nextCards = cards.map(c => (c.id === card.id ? { ...c, ...next } as Card : c))
                      change(nextCards)
                      // Sent: saved to the home at once, then Claude Code is started on it from here.
                      if (next.status === "waiting") void saveBoard(nextCards, arrowsRef.current).then(r => { if (r !== null) rev.current = r; return runPrompt(card.id) })
                        .then(problem => { if (problem) notify({ message: problem, tone: "error" }) })
                    }} />
                  : card.kind === "link"
                  ? <LinkCard link={{ ...card.link, frameable: card.link.frameable ?? framed.has(card.link.url) }} live={on} />
                  : card.kind === "note"
                  // A note: plain words on a quiet sheet, written in place once chosen.
                  ? <span className="ohm-card flex size-full overflow-hidden rounded-2xl bg-muted p-3 shade-1">
                      <textarea aria-label="Note" placeholder="Write a note" defaultValue={card.text} readOnly={!on} autoFocus={on && !card.text}
                        onPointerDown={on ? e => e.stopPropagation() : undefined}
                        onBlur={e => { const text = e.target.value; if (text !== card.text) change(cards.map(c => (c.id === card.id ? { ...c, text } : c))) }}
                        className={cn("size-full resize-none bg-transparent text-small leading-relaxed text-foreground outline-none placeholder:text-muted-foreground", !on && "pointer-events-none")} />
                    </span>
                  : card.kind === "page"
                  // Live once chosen: until then a sheet lies over it, so pressing anywhere picks the card up.
                  ? <PageCard src={siteUrl(card.path)} title={pageTitle(card.path)} address={content?.site} live={on} />
                  : card.kind === "block"
                  ? block && (block.kind === "article" || block.kind === "project")
                    // A writing on the canvas is always the editor itself, so choosing it changes nothing on
                    // screen: it only starts taking the pointer (scroll, select, change) once it is chosen.
                    ? <span className="ohm-card relative block size-full overflow-hidden rounded-2xl bg-card shade-2">
                        <span data-live={on || undefined} className={cn("card-live absolute inset-0 flex overflow-hidden", on ? "cursor-auto" : "pointer-events-none")}
                          onPointerDown={on ? e => e.stopPropagation() : undefined}>
                          <ReaderScale live={on}><ArticleView item={block} channel={block.channel ?? ""} onSave={onSave} /></ReaderScale>
                        </span>
                      </span>
                    : block ? <BlockCard item={block} /> : <span className="flex size-full items-center rounded-2xl bg-muted p-3 text-small text-muted-foreground">{card.path} isn't in the site any more.</span>
                  : <ChannelCard name={card.name} items={channelItems(card.name)} pages={card.name === "Artifacts" ? [{ src: siteUrl("index.html"), title: "Home" }] : undefined} mark={colors[card.name] ?? (card.name.includes("/") ? colors[card.name.split("/")[0]] : undefined)} view={card.view}
                      onOpenBlock={i => goTo({ kind: "block", path: i.path })} />}
                {/* A channel's views, over its top edge while it is chosen: frosted, as floating controls are. */}
                {on && card.kind === "channel" && (
                  <div data-views role="radiogroup" aria-label="Show this channel as" className="frost absolute -top-11 left-1/2 flex -translate-x-1/2 gap-0.5 rounded-full p-1 shade-3">
                    {CHANNEL_VIEWS.map(v => (
                      <button key={v.view} type="button" role="radio" aria-checked={(card.view ?? "cover") === v.view} aria-label={v.label} title={v.label}
                        onClick={() => change(cards.map(c => {
                          if (c.id !== card.id) return c
                          // A view that shows blocks one by one needs room: give it some when it is still the tile's size.
                          const roomy = v.view !== "cover" && (c.w ?? CARD.w) <= CARD.w
                          return { ...c, view: v.view, ...(roomy ? { w: v.view === "row" ? 420 : 300, h: v.view === "row" ? 220 : 320 } : {}) }
                        }))}
                        className="inline-flex size-8 items-center justify-center rounded-full text-muted-foreground outline-none hover:text-foreground aria-checked:bg-primary aria-checked:text-primary-foreground">
                        <Icon icon={v.icon} size="sm" />
                      </button>
                    ))}
                  </div>
                )}
                {/* A live page takes the pointer, so while it is chosen a small bar above it is where it is held. */}
                {on && (card.kind === "page" || card.kind === "tool" || (card.kind === "link" && !!(card.link.frameable ?? framed.has(card.link.url))) || (block && (block.kind === "article" || block.kind === "project"))) && (
                  <span data-page-strip title="Hold here to move" className="absolute -top-5 left-1/2 flex h-4 w-14 -translate-x-1/2 cursor-grab items-center justify-center rounded-full bg-card shade-2">
                    <span aria-hidden className="h-1 w-6 rounded-full bg-muted-foreground/40" />
                  </span>
                )}
                {/* The corner: drag it to make the card bigger. */}
                {touched[card.id] && (
                  <span aria-label={`${agentName(touched[card.id])} is working on this`} className="pointer-events-none absolute -top-7 left-0 z-10 inline-flex items-center gap-1 rounded-full py-0.5 ps-0.5 pe-2 text-[11px] font-medium text-white animate-in fade-in" style={{ background: "var(--ohm-mark-clay)" }}>
                    <AgentMark agent={touched[card.id]} on size={16} />{agentName(touched[card.id])}
                  </span>
                )}
                {/* Chosen, a card has a dot on its right edge: drag it to another card to join them with an arrow. */}
                {on && <span data-join title="Drag to another card to connect" className="absolute top-1/2 -right-5 flex size-4 -translate-y-1/2 cursor-crosshair items-center justify-center rounded-full bg-card shade-3"><span aria-hidden className="size-1.5 rounded-full bg-foreground/60" /></span>}
                <span data-size aria-hidden className={cn("absolute -right-1.5 -bottom-1.5 size-4 cursor-nwse-resize rounded-full bg-card shade-3 transition-opacity duration-(--ohm-duration-state)", on ? "opacity-100" : "opacity-0 group-hover:opacity-100")} />
              </div>
            )
          })}
        </div>
        {brush && (
          <div aria-hidden className="pointer-events-none absolute rounded-md bg-foreground/5 ring-1 ring-foreground/20"
            style={{ left: view.x + brush.x * view.zoom, top: view.y + brush.y * view.zoom, width: brush.w * view.zoom, height: brush.h * view.zoom }} />
        )}
        {/* Several chosen: one thin frame around them all, with a handle at each corner, as a design tool draws it. */}
        {picked.length > 1 && (() => {
          const chosenCards = cards.filter(c => picked.includes(c.id))
          if (!chosenCards.length) return null
          const sizeOf = (c: Card) => ({ w: c.w ?? (c.kind === "page" ? PAGE_SIZE.w : CARD.w), h: c.h ?? (c.kind === "page" ? PAGE_SIZE.h : CARD.h) })
          const x0 = Math.min(...chosenCards.map(c => c.x)), y0 = Math.min(...chosenCards.map(c => c.y))
          const x1 = Math.max(...chosenCards.map(c => c.x + sizeOf(c).w)), y1 = Math.max(...chosenCards.map(c => c.y + sizeOf(c).h))
          const pad = 8
          const box = { left: view.x + (x0 - pad) * view.zoom, top: view.y + (y0 - pad) * view.zoom, width: (x1 - x0 + pad * 2) * view.zoom, height: (y1 - y0 + pad * 2) * view.zoom }
          return (
            <div aria-hidden className="pointer-events-none absolute rounded-md ring-1 ring-foreground/40" style={box}>
              {[["-left-1 -top-1"], ["-right-1 -top-1"], ["-left-1 -bottom-1"], ["-right-1 -bottom-1"]].map(([at]) => (
                <span key={at} className={cn("absolute size-2 rounded-[2px] bg-card ring-1 ring-foreground/50", at)} />
              ))}
            </div>
          )
        })()}
        {/* The few tools a canvas of things needs, in ohm's own frosted bar. */}
        {cards.length === 0 && (
          <p className="pointer-events-none absolute inset-0 m-auto h-fit text-center text-small text-muted-foreground">
            Drag a block or a channel here from the side panel.
          </p>
        )}
      </div>
    )
  },
)
