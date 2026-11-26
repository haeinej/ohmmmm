// The feed (app/flows/feed.md, docs/plans/units.md step 6): your blocks worth seeing, newest first, laid
// out on an endless plane like the site's canvas (site/Board.tsx): drag or scroll to move around, ⌘-scroll
// or pinch to zoom, and more comes as you go down. It takes the whole page; there is no side panel beside
// it. Each tile is the card the canvas already uses (site/Cards.tsx): a picture as itself, a writing as its
// first page in miniature, and under it its title and who made it. A tile opens what it shows. What it
// shows follows View as: a friend sees public and friends blocks, anyone public ones.
import { useCallback, useEffect, useRef, useState } from "react"
import type { LucideIcon } from "lucide-react"
import { BotIcon, GlobeIcon, LockIcon, UsersIcon } from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Icon } from "@/components/ui/icon"
import { bridgeFetch } from "@/data/bridge"
import { docOfUnit, readFeed, type Unit } from "@/data/units"
import { titleOf } from "@/data/workspace-data"
import { cn } from "@/lib/cn"
import { BlockCard, ReaderScale } from "@/site/Cards"
import { ToolFrame } from "@/site/ToolFrame"
import { ago } from "@/site/SitePublish"
import { MarkdownView } from "@/viewers/MarkdownView"
import { siteUrl } from "@/site/source"
import "@/editor/editor.css"
import "@/viewers/markdown.css"
import { me, openUnit, report, useWorkspace } from "./store"

const SEEN_BY: Record<Unit["visibility"], { label: string; icon: LucideIcon }> = {
  private: { label: "Only you", icon: LockIcon },
  friends: { label: "Friends", icon: UsersIcon },
  public: { label: "Everyone", icon: GlobeIcon },
}
// The tiles' face, as site/Cards.tsx draws it: no edges, lifted by shade, the card radius.
const face = "ohm-card relative block w-full overflow-hidden rounded-2xl bg-card shade-2"

/** Who made it, as the tile says it: you, an agent by name, or your site. */
function authorOf(unit: Unit): { name: string; agent: boolean } {
  const by = unit.by?.replace(/^agent:/, "")
  if (unit.by?.startsWith("agent:") || (unit.root === "agents" && by && by !== "me")) return { name: by!, agent: true }
  if (unit.root === "agents") return { name: "Your agents", agent: true }
  return { name: me.name, agent: false }
}

/**
 * A cover's address the page can show. A site file comes through the bridge, so it shows whether or not
 * the site's worker runs; read once and kept, as tiles of one picture share it.
 */
const pictures = new Map<string, Promise<string>>()
function useCover(cover?: string) {
  const [src, setSrc] = useState<string | null>(cover && /^https?:\/\//i.test(cover) ? cover : null)
  useEffect(() => {
    if (!cover?.startsWith("site:")) { setSrc(cover && /^https?:\/\//i.test(cover) ? cover : null); return }
    const path = cover.slice(5)
    let current = true
    if (!pictures.has(path)) {
      pictures.set(path, bridgeFetch(`/site/file/${path.split("/").map(encodeURIComponent).join("/")}`)
        .then(r => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
        .then(blob => URL.createObjectURL(blob))
        .catch(e => { pictures.delete(path); throw e }))
    }
    pictures.get(path)!.then(url => { if (current) setSrc(url) }, () => { if (current) setSrc(null) })
    return () => { current = false }
  }, [cover])
  return src
}

/** A block's first page, as the reader shows writing, in miniature: the same card a writing gets. */
function BlockPage({ unit }: { unit: Unit }) {
  const doc = docOfUnit(unit)
  const title = doc ? titleOf(doc) : unit.title || "Untitled block"
  return (
    <span className={cn(face, "aspect-3/4")}>
      <ReaderScale className="mask-b-from-85%">
        <span className="block w-full px-14 pt-10 pb-40">
          <h1 className="text-h2 font-semibold tracking-tight break-words">{title}</h1>
          <span className="relative mt-6 block">
            {doc?.body
              ? <MarkdownView path={unit.path} text={doc.body} url={siteUrl} className="ohm-prose ohm-markdown" />
              : <span className="ohm-prose ohm-markdown block"><p>{unit.excerpt}</p></span>}
          </span>
        </span>
      </ReaderScale>
    </span>
  )
}

/** The tile itself: a cover as a picture at its own shape, a site page as its writing, a block as its page. */
function Face({ unit }: { unit: Unit }) {
  const cover = useCover(unit.cover)
  // A short post's card is its words, as on Bluesky: all of them, with links, mentions and tags marked.
  if (unit.kind === "short") return <span className={cn(face, "p-4 text-body leading-snug break-words whitespace-pre-wrap")}><Faceted text={unit.excerpt ?? ""} /></span>
  // A tool built for you is shown running, as the canvas shows it; it can't be used from its tile.
  if (unit.kind === "tool" && unit.id) return <span className={cn(face, "aspect-3/4")}><ToolFrame name={unit.id} live={false} className="pointer-events-none size-full" /></span>
  // A page of the site is writing: its text, as the reader shows it, never the picture it is shared with.
  if (unit.root === "site" && unit.kind === "page") {
    const path = unit.path.replace(/^site\//, "")
    return <BlockCard className="aspect-3/4 h-auto" item={{ kind: "article", path, title: unit.title ?? path, modified: unit.updated ?? "", usedIn: [] }} />
  }
  if (cover) return <span className={face}><img src={cover} alt="" draggable={false} className="block h-auto w-full" /></span>
  // A kept website with no picture of its own: its name and what it says about itself, as a card.
  if (unit.kind === "link") return (
    <span className={cn(face, "flex aspect-4/3 flex-col justify-end gap-1 p-4")}>
      <span className="text-small text-muted-foreground">{unit.origin && URL.canParse(unit.origin) ? new URL(unit.origin).hostname.replace(/^www\./, "") : ""}</span>
      <span className="line-clamp-3 text-body text-muted-foreground">{unit.excerpt}</span>
    </span>
  )
  return <BlockPage unit={unit} />
}

// What Bluesky makes a facet of: an address, an @handle, a #tag.
const FACET = /(https?:\/\/[^\s]+|@[a-z0-9][a-z0-9.-]*\.[a-z]{2,}|#[\p{L}\p{N}_]+)/giu
/** Your @handle, as Bluesky shows it: the account's, or the home's own name when that is a domain. */
const handleOf = () => { const handle = me.handle || (me.name.includes(".") ? me.name : ""); return handle ? `@${handle.replace(/^@/, "")}` : "" }

/** A short post's text with its links, mentions and tags marked, as Bluesky shows them. */
function Faceted({ text }: { text: string }) {
  // Marked by weight and a line, not a colour: in ohm, colour means done or failed.
  return <>{text.split(FACET).map((part, i) => (i % 2 ? <span key={i} className="font-medium underline decoration-foreground/30 underline-offset-2">{part}</span> : part))}</>
}

/** One tile of the masonry: the block, then its title, then who made it, when, and who sees it. */
export function FeedTile({ unit, onOpen }: { unit: Unit; onOpen(): void }) {
  const author = authorOf(unit)
  const seen = SEEN_BY[unit.visibility]
  // A block or an agent's file is named as everywhere in the app; anything else by its own title.
  const doc = docOfUnit(unit)
  const title = doc ? titleOf(doc) : unit.title || unit.path.split("/").at(-1)
  return (
    <article>
      <button type="button" onClick={onOpen} className="group flex w-full flex-col gap-2.5 text-left outline-none">
        <span className="block transition-transform duration-(--ohm-duration-state) group-hover:-translate-y-0.5 group-focus-visible:ring-2 group-focus-visible:ring-ring/40 rounded-2xl">
          <Face unit={unit} />
        </span>
        {/* A short post is its words, so it has no title under it: only who wrote it. */}
        {unit.kind !== "short" && <span className="line-clamp-2 px-1 text-body font-medium">{title}</span>}
        <span className="flex min-w-0 items-center gap-2 px-1 text-small text-muted-foreground">
          <Avatar className="size-5 flex-none">
            <AvatarFallback className={author.agent ? "bg-muted text-muted-foreground" : "bg-primary text-[10px] text-primary-foreground"}>
              {author.agent ? <Icon icon={BotIcon} size="xs" /> : author.name.slice(0, 1)}
            </AvatarFallback>
          </Avatar>
          <span className="truncate">{author.name}</span>
          {unit.kind === "short" && !author.agent && handleOf() && handleOf() !== `@${author.name}` && <span className="truncate">{handleOf()}</span>}
          <span className="ms-auto flex flex-none items-center gap-1.5">
            {unit.updated && <time dateTime={unit.updated}>{ago(unit.updated)}</time>}
            <Icon icon={seen.icon} size="xs" aria-label={seen.label} />
          </span>
        </span>
      </button>
    </article>
  )
}

// The plane's columns: a tile's width, the room between, and how many side by side.
const COLUMN = 240
const GAP = 28
const COLUMNS = 6
const PAGE = 60
/** A tile's height before it is drawn, to place it in the shortest column: a picture is guessed, a page is 3:4. */
const guess = (unit: Unit) => unit.kind === "short" ? 80 + (unit.excerpt?.length ?? 0) * 0.6
  : (unit.cover || unit.kind === "image" ? COLUMN * 1.25 : COLUMN * 4 / 3) + 64

/** Tiles placed newest first, each in the column that is shortest so far, so the plane fills evenly. */
function placed(units: Unit[]) {
  const heights = Array(COLUMNS).fill(0) as number[]
  const columns = Array.from({ length: COLUMNS }, () => [] as Unit[])
  for (const unit of units) {
    const at = heights.indexOf(Math.min(...heights))
    columns[at].push(unit)
    heights[at] += guess(unit) + GAP
  }
  return columns
}

/** The feed on its plane. Read again whenever something in the home changes, or the audience does. */
export function FeedView() {
  const { audience, rev } = useWorkspace()
  const [units, setUnits] = useState<Unit[] | null>(null)
  const [more, setMore] = useState(true)
  const loading = useRef(false)
  const plane = useRef<HTMLDivElement>(null)
  const layer = useRef<HTMLDivElement>(null)
  const [view, setView] = useState({ x: 0, y: 72, zoom: 1 })
  const width = COLUMNS * COLUMN + (COLUMNS - 1) * GAP

  useEffect(() => {
    let current = true
    setMore(true)
    void report(readFeed({ audience, limit: PAGE }).then(read => { if (current) { setUnits(read); setMore(read.length === PAGE) } }))
    return () => { current = false }
  }, [audience, rev])

  // Start with the tiles in the middle of the plane.
  useEffect(() => {
    const el = plane.current
    if (el) setView(v => ({ ...v, x: Math.max(24, (el.clientWidth - width) / 2) }))
  }, [width])

  // The next page, from where this one ends, once the bottom of the tiles comes near the bottom of the plane.
  const loadMore = useCallback(() => {
    if (!units?.length || !more || loading.current) return
    const before = units.at(-1)?.updated
    if (!before) { setMore(false); return }
    loading.current = true
    void report(readFeed({ audience, limit: PAGE, before }).then(read => {
      setUnits(now => [...(now ?? []), ...read.filter(unit => !now?.some(each => each.key === unit.key))])
      setMore(read.length === PAGE)
    }).finally(() => { loading.current = false }))
  }, [audience, more, units])
  useEffect(() => {
    const el = plane.current, content = layer.current
    if (!el || !content) return
    if (view.y + content.offsetHeight * view.zoom < el.clientHeight + 800) loadMore()
  }, [view, units, loadMore])

  const zoomAt = useCallback((by: number, px: number, py: number) => setView(v => {
    const zoom = Math.min(2, Math.max(0.3, v.zoom * by))
    return { zoom, x: px - (px - v.x) * (zoom / v.zoom), y: py - (py - v.y) * (zoom / v.zoom) }
  }), [])
  // Scroll moves the plane; ⌘-scroll or a pinch zooms where the pointer is, as on the site's canvas.
  useEffect(() => {
    const el = plane.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      if (e.ctrlKey || e.metaKey) { const r = el.getBoundingClientRect(); zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top) }
      else setView(v => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }))
    }
    el.addEventListener("wheel", onWheel, { passive: false })
    return () => el.removeEventListener("wheel", onWheel)
  }, [zoomAt])
  // Dragging anywhere moves the plane; a drag never opens the tile it started on.
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  const onPointerDown = (e: React.PointerEvent) => { if (e.button === 0) drag.current = { x: e.clientX, y: e.clientY, moved: false } }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d || !(e.buttons & 1)) return
    const dx = e.clientX - d.x, dy = e.clientY - d.y
    if (!d.moved && Math.hypot(dx, dy) < 4) return
    if (!d.moved) { d.moved = true; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) }
    d.x = e.clientX; d.y = e.clientY
    setView(v => ({ ...v, x: v.x + dx, y: v.y + dy }))
  }
  const onClickCapture = (e: React.MouseEvent) => { if (drag.current?.moved) { e.stopPropagation(); e.preventDefault() } drag.current = null }

  if (!units) return <div className="flex-1" aria-busy />
  return (
    <section aria-label="Feed" className="relative flex min-h-0 flex-1 flex-col">
      {units.length === 0 ? (
        <Empty className="flex-1">
          <EmptyHeader>
            <EmptyTitle>Nothing here yet</EmptyTitle>
            <EmptyDescription>Your writing and pictures show here, newest first.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div ref={plane} aria-label="Feed canvas" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onClickCapture={onClickCapture}
          className="relative min-h-0 flex-1 cursor-grab touch-none overflow-hidden bg-white select-none active:cursor-grabbing dark:bg-card">
          <div ref={layer} role="feed" aria-busy={more} className="absolute top-0 left-0 flex origin-top-left items-start"
            style={{ gap: GAP, width, transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}>
            {placed(units).map((column, i) => (
              <div key={i} className="flex flex-col" style={{ width: COLUMN, gap: GAP }}>
                {column.map(unit => <FeedTile key={unit.key} unit={unit} onOpen={() => void report(Promise.resolve().then(() => openUnit(unit)))} />)}
              </div>
            ))}
          </div>
          <h1 className="pointer-events-none absolute top-4 left-6 text-(length:--ohm-type-title-size) font-semibold">Feed</h1>
        </div>
      )}
    </section>
  )
}
