// The main screen (flows/site.md): one endless white sheet that continues the person's website.
// Its blocks lie on it directly, not inside framed pages: the name on top, then the writings, the
// projects and the photographs, as the site's own gallery lays them out. The sheet pans and zooms;
// a block can be picked up and put anywhere, and a tile dropped from the side panel lands where it
// is let go. A click opens the block.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { MinusIcon, PlusIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Icon } from "@/components/ui/icon"
import { cn } from "@/lib/cn"
import { channelsIn, siteUrl, type SiteContent, type SiteItem, type SiteProfile } from "./source"

const ITEM = "application/x-ohm-site-item"
const ZOOM = { min: 0.08, max: 2 }
const SHEET = 1800, CARD = 260
const KEPT = "ohm-site:canvas"

type Camera = { x: number; y: number; k: number }
type Placed = Record<string, { x: number; y: number }>
const kept = (): Placed => { try { return JSON.parse(localStorage.getItem(KEPT) ?? "{}") as Placed } catch { return {} } }

/** One block on the sheet: a picture in its own shape, or a 3:4 card of writing in the site's ink. */
function Block({ item, ink }: { item: SiteItem; ink: string }) {
  if (item.kind === "image") return <img src={siteUrl(item.thumb ?? item.path)} alt="" loading="lazy" draggable={false} className="block h-auto w-full" />
  if (item.kind === "video") return <video src={siteUrl(item.thumb ?? item.path)} muted playsInline preload="metadata" className="block h-auto w-full" />
  return (
    <span className="flex aspect-[3/4] w-full flex-col gap-3 overflow-hidden bg-white p-5 text-left" style={{ color: ink || undefined, boxShadow: `inset 0 0 0 1.5px ${ink || "currentColor"}` }}>
      <span className="text-small opacity-70">{item.kind === "article" ? "Writing" : "Project"}</span>
      <span className="text-h3 leading-tight font-medium break-words">{item.title}</span>
      <span className="min-h-0 flex-1 overflow-hidden text-small leading-relaxed mask-b-from-60%">{item.excerpt}</span>
    </span>
  )
}

export function BlockCanvas({ content, profile, onOpen }: {
  content: SiteContent
  profile: SiteProfile | null
  /** Open one block, by its path. */
  onOpen(path: string): void
}) {
  const stage = useRef<HTMLDivElement>(null)
  const [camera, setCamera] = useState<Camera>({ x: 48, y: 48, k: 0.5 })
  const [placed, setPlaced] = useState<Placed>(kept)
  const pan = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null)
  const held = useRef<{ path: string; dx: number; dy: number; moved: boolean; sx: number; sy: number } | null>(null)
  const ink = profile?.color ?? ""
  const items = content.collections.flatMap(c => c.items)
  const byPath = new Map(items.map(i => [i.path, i]))

  // The first look: the sheet's width fills the panel.
  useLayoutEffect(() => {
    const el = stage.current
    // Never so small that the writing can't be read: a narrow panel shows the sheet's left side, and it pans.
    if (el?.clientWidth) setCamera({ x: 48, y: 48, k: Math.max(0.4, Math.min(1, (el.clientWidth - 96) / SHEET)) })
  }, [])
  useEffect(() => { try { localStorage.setItem(KEPT, JSON.stringify(placed)) } catch { /* a browser that keeps nothing */ } }, [placed])

  const zoomAt = useCallback((factor: number, px: number, py: number) => setCamera(c => {
    const k = Math.max(ZOOM.min, Math.min(ZOOM.max, c.k * factor))
    return { k, x: px - (px - c.x) * (k / c.k), y: py - (py - c.y) * (k / c.k) }
  }), [])
  useEffect(() => {
    const el = stage.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const box = el.getBoundingClientRect()
      if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX - box.left, e.clientY - box.top)
      else setCamera(c => ({ ...c, x: c.x - e.deltaX, y: c.y - e.deltaY }))
    }
    el.addEventListener("wheel", onWheel, { passive: false })
    return () => el.removeEventListener("wheel", onWheel)
  }, [zoomAt])

  /** A point of the panel as a point of the sheet. */
  const toSheet = (clientX: number, clientY: number) => {
    const box = stage.current!.getBoundingClientRect()
    return { x: (clientX - box.left - camera.x) / camera.k, y: (clientY - box.top - camera.y) / camera.k }
  }

  const blockProps = (item: SiteItem) => ({
    "data-block": item.path,
    title: item.title,
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (e.button !== 0) return
      e.stopPropagation()
      e.currentTarget.setPointerCapture(e.pointerId)
      const box = e.currentTarget.getBoundingClientRect()
      held.current = { path: item.path, dx: (e.clientX - box.left) / camera.k, dy: (e.clientY - box.top) / camera.k, moved: false, sx: e.clientX, sy: e.clientY }
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      const h = held.current
      if (!h || h.path !== item.path) return
      // A small tremor of the hand is still a click.
      if (!h.moved && Math.hypot(e.clientX - h.sx, e.clientY - h.sy) < 5) return
      h.moved = true
      const at = toSheet(e.clientX, e.clientY)
      setPlaced(p => ({ ...p, [item.path]: { x: at.x - h.dx, y: at.y - h.dy } }))
    },
    onPointerUp: () => {
      const h = held.current
      held.current = null
      if (h && !h.moved) onOpen(item.path)
    },
  })

  const free = Object.keys(placed).filter(path => byPath.has(path))
  const inFlow = (list: SiteItem[]) => list.filter(i => !placed[i.path])
  const section = (name: string) => content.collections.find(c => c.name === name)?.items ?? []

  return (
    <div ref={stage} className="relative min-h-0 flex-1 touch-none overflow-hidden bg-white"
      onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); pan.current = { x: e.clientX, y: e.clientY, cx: camera.x, cy: camera.y } }}
      onPointerMove={e => { const d = pan.current; if (d) setCamera(c => ({ ...c, x: d.cx + e.clientX - d.x, y: d.cy + e.clientY - d.y })) }}
      onPointerUp={() => { pan.current = null }}
      onDragOver={e => { if (e.dataTransfer.types.includes(ITEM)) { e.preventDefault(); e.dataTransfer.dropEffect = "copy" } }}
      onDrop={e => {
        const raw = e.dataTransfer.getData(ITEM)
        if (!raw) return
        e.preventDefault()
        const item = JSON.parse(raw) as SiteItem
        const at = toSheet(e.clientX, e.clientY)
        setPlaced(p => ({ ...p, [item.path]: { x: at.x - CARD / 2, y: at.y - CARD / 2 } }))
      }}>
      <div className="absolute top-0 left-0 origin-top-left" style={{ width: SHEET, transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.k})`, color: ink || undefined }}>
        {/* The site's own top: the name, and under it what the person does. */}
        <header className="flex items-baseline justify-between pb-16">
          <span className="font-medium" style={{ fontSize: 56, lineHeight: 1 }}>{profile?.name || content.site}</span>
          <span style={{ fontSize: 22 }}>{content.collections.map(c => c.name).join("   ")}</span>
        </header>

        {(["Writings", "Projects"] as const).map(name => inFlow(section(name)).length > 0 && (
          <section key={name} aria-label={name} className="pb-20">
            <h2 className="pb-6 font-medium" style={{ fontSize: 28, fontFamily: "inherit", color: "inherit" }}>{name}</h2>
            <div className="flex flex-wrap gap-6">
              {inFlow(section(name)).map(item => (
                <button key={item.path} type="button" {...blockProps(item)} className="cursor-grab outline-none active:cursor-grabbing" style={{ width: CARD }}><Block item={item} ink={ink} /></button>
              ))}
            </div>
          </section>
        ))}

        {inFlow(section("Photographs")).length > 0 && (
          <section aria-label="Photographs">
            <h2 className="pb-6 font-medium" style={{ fontSize: 28, fontFamily: "inherit", color: "inherit" }}>Photographs</h2>
            {/* Each channel inside Photographs is its own run of the sheet, under its name. */}
            {[...channelsIn(section("Photographs")), { name: "", items: section("Photographs").filter(i => !i.channel) }].map(group => inFlow(group.items).length > 0 && (
              <div key={group.name} className="pb-16">
                {group.name && <h3 className="pb-4" style={{ fontSize: 20, color: "inherit" }}>{group.name} <span className="opacity-60">{group.items.length}</span></h3>}
                <div style={{ columnWidth: CARD, columnGap: 24 }}>
                  {inFlow(group.items).map(item => (
                    <button key={item.path} type="button" {...blockProps(item)} className="mb-6 block w-full cursor-grab break-inside-avoid outline-none active:cursor-grabbing"><Block item={item} ink={ink} /></button>
                  ))}
                </div>
              </div>
            ))}
          </section>
        )}

        {/* Blocks the person has put somewhere themselves lie over the rest, where they were left. */}
        {free.map(path => {
          const item = byPath.get(path)!
          return (
            <button key={path} type="button" {...blockProps(item)} className={cn("absolute cursor-grab outline-none active:cursor-grabbing")} style={{ left: placed[path].x, top: placed[path].y, width: CARD }}>
              <Block item={item} ink={ink} />
            </button>
          )
        })}
      </div>

      <div className="absolute right-4 bottom-4 flex items-center gap-0.5 rounded-2xl bg-card p-1 text-small shade-2" onPointerDown={e => e.stopPropagation()}>
        {free.length > 0 && <Button size="sm" variant="ghost" onClick={() => setPlaced({})}>Tidy</Button>}
        <Button size="icon-sm" variant="ghost" aria-label="Zoom out" onClick={() => zoomAt(1 / 1.25, (stage.current?.clientWidth ?? 0) / 2, (stage.current?.clientHeight ?? 0) / 2)}><Icon icon={MinusIcon} /></Button>
        <span className="w-10 text-center text-muted-foreground tabular-nums">{Math.round(camera.k * 100)}%</span>
        <Button size="icon-sm" variant="ghost" aria-label="Zoom in" onClick={() => zoomAt(1.25, (stage.current?.clientWidth ?? 0) / 2, (stage.current?.clientHeight ?? 0) / 2)}><Icon icon={PlusIcon} /></Button>
      </div>
    </div>
  )
}
