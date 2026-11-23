// A block's connections as a card that opens beside it, like an info panel: the graph around it, the
// part of the tree it sits in, and the list of its connections. It opens from the block's toolbar, and
// from the dot that shows at the right end of a block's row when you hover it. Pull a line from that
// dot to another block (in the tree, the graph or the open block) to connect the two.
import { useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { NetworkIcon, WaypointsIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { FileTree, type FileTreeNode } from "@/components/ui/file-tree"
import { Icon } from "@/components/ui/icon"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { notify } from "@/components/ui/notice"
import { blockKey, isBlock, channelRowId, byId, channelsOf, docForEvidence, evidenceKey, workspaceEvidence, cortex, blocks, docIdOf, titleOf, type Doc } from "@/data/workspace-data"
import { cn } from "@/lib/cn"
import { connectDocs, open, revealFolder, setRepoMode, showGraph, useWorkspace } from "@/workspace/store"
import { connectionCount, ConnectionList } from "./Connected"

type MiniNode = { id: string; name: string; kind: "self" | "channel" | "block" | "cortex"; go?: () => void }
type MiniEdge = { to: string; inferred: boolean }

/** Everything one step from the block: its channels, the blocks it connects with, and the observations about it. */
function neighbourhood(doc: Doc, go: (id: string) => void, reveal: (path: string) => void) {
  const self = evidenceKey(doc.id) ?? blockKey(doc.id)
  const nodes: MiniNode[] = [{ id: self, name: titleOf(doc), kind: "self" }]
  const edges: MiniEdge[] = []
  const add = (n: MiniNode, inferred = false) => {
    if (nodes.some(m => m.id === n.id)) return
    nodes.push(n)
    edges.push({ to: n.id, inferred })
  }
  for (const path of channelsOf(doc)) add({ id: `channel:${path}`, name: path.split("/").at(-1)!, kind: "channel", go: () => reveal(path) })
  for (const edge of workspaceEvidence()) {
    const other = edge.from === self ? edge.to : edge.to === self ? edge.from : ""
    if (!other.startsWith("block:")) continue
    const neighbour = docForEvidence(other)
    if (neighbour) add({ id: other, name: titleOf(neighbour), kind: "block", go: () => go(neighbour.id) })
  }
  for (const c of cortex) {
    if (c.kind === "observation" && c.about?.includes(doc.id)) {
      add({ id: `observation:${c.id}`, name: c.title, kind: "cortex", go: () => go(c.id) }, true)
    }
  }
  return { nodes, edges }
}

/** The graph around one block, in the main graph's colours: still, so it reads at a glance. */
function MiniGraph({ doc, go, reveal }: { doc: Doc; go: (id: string) => void; reveal: (path: string) => void }) {
  const { nodes, edges } = neighbourhood(doc, go, reveal)
  const [hover, setHover] = useState<string | null>(null)
  const W = 352, H = 196, cx = W / 2, cy = H / 2 - 6
  const ring = nodes.slice(1)
  const at = (i: number) => {
    const a = (i / Math.max(ring.length, 1)) * Math.PI * 2 - Math.PI / 2
    return { x: cx + Math.cos(a) * 128, y: cy + Math.sin(a) * 66 }
  }
  const pos = new Map(ring.map((n, i) => [n.id, at(i)]))
  const fill = (n: MiniNode) =>
    n.kind === "self" ? "fill-primary dark:fill-foreground" : n.kind === "channel" ? "fill-foreground" : n.kind === "cortex" ? "fill-(--ohm-green-light)" : "fill-muted-foreground"
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`What ${titleOf(doc)} connects with`} className="w-full rounded-xl bg-muted/50">
      {edges.map(e => {
        const p = pos.get(e.to)!
        const lit = hover === e.to
        return <line key={e.to} x1={cx} y1={cy} x2={p.x} y2={p.y} strokeWidth={lit ? 1.4 : 1}
          className={cn("transition-[stroke,opacity] duration-(--ohm-duration-state)", lit ? "stroke-primary dark:stroke-foreground" : e.inferred ? "stroke-(--ohm-green-light)" : "stroke-muted-foreground", !lit && "opacity-50")} />
      })}
      {nodes.map((n, i) => {
        const p = i === 0 ? { x: cx, y: cy } : pos.get(n.id)!
        const r = n.kind === "self" ? 7 : n.kind === "channel" ? 5 : 4
        const name = n.name.length > 18 ? `${n.name.slice(0, 17)}…` : n.name
        return (
          <g key={n.id} transform={`translate(${p.x},${p.y})`} role={n.go ? "button" : undefined} tabIndex={n.go ? 0 : undefined} aria-label={n.name}
            className={cn("outline-none", n.go && "cursor-pointer")}
            onPointerEnter={() => setHover(n.id)} onPointerLeave={() => setHover(null)} onClick={() => n.go?.()}
            onKeyDown={e => { if (n.go && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); n.go() } }}>
            <circle r={Math.max(r + 6, 11)} className="fill-transparent" />
            {hover === n.id && n.kind !== "self" && <circle r={r + 3} className="fill-none stroke-primary dark:stroke-foreground" strokeWidth={1.2} />}
            <circle r={r} className={fill(n)} />
            <text y={r + 12} textAnchor="middle"
              className={cn("text-[10px]", n.kind === "self" || n.kind === "channel" || hover === n.id ? "fill-foreground" : "fill-muted-foreground", n.kind === "self" && "font-semibold")}>
              {name}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

/** The part of the home tree the block sits in: each of its channels, with it and its neighbours there. */
function partialTree(doc: Doc): FileTreeNode[] {
  return channelsOf(doc).map((path, i) => {
    const inChannel = blocks.filter(p => channelsOf(p).includes(path))
    const shown = [doc, ...inChannel.filter(p => p.id !== doc.id)].slice(0, 5)
    const more = inChannel.length - shown.length
    const leafId = (d: Doc) => (d.id === doc.id && i === 0 ? d.id : channelRowId(d.id, path))
    return {
      id: `card:${path}`, name: path.replace("/", " › "),
      children: [
        ...shown.sort((a, b) => inChannel.indexOf(a) - inChannel.indexOf(b)).map(d => ({ id: leafId(d), name: `${d.icon ? `${d.icon} ` : ""}${titleOf(d)}` })),
        ...(more > 0 ? [{ id: `card-more:${path}`, name: `${more} more…` }] : []),
      ],
    }
  })
}

export function ConnectionsCard({ doc, editable, onClose }: { doc: Doc; editable: boolean; onClose: () => void }) {
  const { rev } = useWorkspace()
  const go = (id: string) => { onClose(); open(id) }
  const reveal = (path: string) => { onClose(); revealFolder("vault", path) }
  const tree = useMemo(() => partialTree(doc), [doc, rev]) // eslint-disable-line react-hooks/exhaustive-deps
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(tree.map(n => n.id)))
  const channels = channelsOf(doc).length
  const count = connectionCount(doc)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5 px-1">
        <span className="truncate text-body font-semibold">{doc.icon ? `${doc.icon} ` : ""}{titleOf(doc)}</span>
        <span className="text-small text-muted-foreground">
          {count} {count === 1 ? "connection" : "connections"} · in {channels} {channels === 1 ? "channel" : "channels"}
        </span>
      </div>

      <MiniGraph doc={doc} go={go} reveal={reveal} />

      <section aria-label="In channels" className="flex flex-col gap-1">
        <h3 className="px-1 text-small font-semibold text-muted-foreground">In channels</h3>
        <FileTree aria-label="Channels this block is in" nodes={tree} expanded={expanded} onExpandedChange={setExpanded} selected={doc.id}
          onSelect={id => {
            if (id.startsWith("card-more:")) return reveal(id.slice("card-more:".length))
            const target = docIdOf(id)
            if (target !== doc.id) go(target)
          }} />
      </section>

      <section aria-label="Connections" className="flex flex-col gap-1">
        <h3 className="px-1 text-small font-semibold text-muted-foreground">Connections</h3>
        <ConnectionList doc={doc} editable={editable} onOpen={onClose} />
      </section>

      <Button size="sm" variant="ghost" className="h-8 w-fit gap-1.5 px-2 font-normal text-muted-foreground"
        onClick={() => { onClose(); open(doc.id); setRepoMode("graph"); showGraph() }}>
        <Icon icon={NetworkIcon} size="sm" /> Open in the graph
      </Button>
    </div>
  )
}

/** The block a connecting line is over: a block's row in the tree, a graph node, or the open block. */
function blockAt(x: number, y: number, from: string): { el: HTMLElement; id: string } | null {
  const el = document.elementFromPoint(x, y) as HTMLElement | null
  const row = el?.closest<HTMLElement>("[data-slot=file-tree-item]")
  const holder = row ?? el?.closest<HTMLElement>("[data-doc-id]")
  const id = row ? (row.dataset.id?.includes(":") ? null : docIdOf(row.dataset.id ?? "")) : holder?.dataset.docId
  const doc = id ? byId(id) : undefined
  return holder && isBlock(doc) && doc.id !== from ? { el: holder, id: doc.id } : null
}

/**
 * Pulling a line from the dot: past a few pixels a press becomes a line that follows the pointer and
 * lights the block it is over; letting go there connects the two. Escape, or letting go anywhere
 * else, draws nothing. A press without movement is a click, which opens the card.
 */
function useConnectLine(doc: Doc, onLinking?: (on: boolean) => void) {
  const [line, setLine] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null)
  const drag = useRef<{ x0: number; y0: number; moved: boolean; target: { el: HTMLElement; id: string } | null } | null>(null)
  const pulled = useRef(false)
  const light = (next: { el: HTMLElement; id: string } | null) => {
    const d = drag.current
    if (d?.target?.el !== next?.el) { d?.target?.el.removeAttribute("data-link-target"); next?.el.setAttribute("data-link-target", "") }
    if (d) d.target = next
  }
  const stop = () => { light(null); drag.current = null; setLine(null); onLinking?.(false) }
  useEffect(() => {
    if (!line) return
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); stop() } }
    window.addEventListener("keydown", key)
    return () => window.removeEventListener("keydown", key)
  }, [!!line]) // eslint-disable-line react-hooks/exhaustive-deps

  const handlers = {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (e.button !== 0) return
      e.currentTarget.setPointerCapture(e.pointerId)
      drag.current = { x0: e.clientX, y0: e.clientY, moved: false, target: null }
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      const d = drag.current
      if (!d || (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 4)) return
      if (!d.moved) { d.moved = true; onLinking?.(true) }
      const r = e.currentTarget.getBoundingClientRect()
      setLine({ x1: r.left + r.width / 2, y1: r.top + r.height / 2, x2: e.clientX, y2: e.clientY })
      light(blockAt(e.clientX, e.clientY, doc.id))
    },
    onPointerUp: () => {
      const d = drag.current
      if (!d?.moved) { drag.current = null; return }
      pulled.current = true
      const target = d.target ? byId(d.target.id) : undefined
      stop()
      if (!target) return
      try {
        const { added } = connectDocs(doc.id, target.id)
        notify({ message: added ? `Connected “${titleOf(doc)}” to “${titleOf(target)}”` : `Already connected to “${titleOf(target)}”`, tone: "info" })
      } catch (err) { notify({ message: (err as Error).message }) }
    },
    onPointerCancel: () => stop(),
  }
  const overlay = line && createPortal(
    <svg aria-hidden className="pointer-events-none fixed inset-0 z-[60] size-full">
      <line x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} strokeWidth={1.5} strokeLinecap="round" className="stroke-primary dark:stroke-foreground" />
      <circle cx={line.x1} cy={line.y1} r={4} className="fill-primary dark:fill-foreground" />
      <circle cx={line.x2} cy={line.y2} r={4} className="fill-card stroke-primary dark:stroke-foreground" strokeWidth={1.5} />
    </svg>,
    document.body,
  )
  /** Whether the last press was a pull, not a click: the card stays shut after it. */
  const wasPull = () => { const p = pulled.current; pulled.current = false; return p }
  return { handlers, overlay, wasPull }
}

/**
 * The button that opens a block's connections card, and the card. `variant` picks how the button
 * looks: a dot on a tree row, which also pulls a line to connect, or a pill button with a count in
 * the block's toolbar.
 */
export function ConnectionsButton({ doc, editable, variant, open: openProp, onOpenChange, onLinking, side = "right", className }: {
  doc: Doc
  editable: boolean
  variant: "dot" | "toolbar"
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** While a line is being pulled from the dot. */
  onLinking?: (on: boolean) => void
  side?: "right" | "bottom" | "left"
  className?: string
}) {
  const [own, setOwn] = useState(false)
  const isOpen = openProp ?? own
  const { handlers, overlay, wasPull } = useConnectLine(doc, onLinking)
  const setOpen = (o: boolean) => {
    if (o && variant === "dot" && wasPull()) return
    setOwn(o); onOpenChange?.(o)
  }
  const count = connectionCount(doc)
  return (
    <Popover open={isOpen} onOpenChange={setOpen}>
      {overlay}
      <PopoverTrigger render={variant === "dot"
        ? <button type="button" aria-label={`Connections of “${titleOf(doc)}”. Drag to another block to connect`}
            title="Drag to another block to connect · click for its connections" {...handlers}
            className={cn("group/dot flex size-6 cursor-crosshair touch-none items-center justify-center rounded-md animate-in fade-in-0 hover:bg-foreground/10 aria-expanded:bg-foreground/10", className)} />
        : <Button size="sm" variant="ghost" aria-label={`Connections: ${count}`}
            className={cn("h-8 gap-1.5 rounded-full px-2.5 font-normal text-muted-foreground hover:bg-background hover:text-foreground aria-expanded:bg-background aria-expanded:text-foreground", className)} />
      }>
        {variant === "dot"
          ? <span aria-hidden className={cn("size-2.5 rounded-full border-[1.5px] transition-transform duration-(--ohm-duration-press) group-hover/dot:scale-125",
              count ? "border-primary bg-primary dark:border-foreground dark:bg-foreground" : "border-muted-foreground bg-card")} />
          : <><Icon icon={WaypointsIcon} size="sm" /><span className="tabular-nums">{count}</span></>}
      </PopoverTrigger>
      <PopoverContent side={side} align={side === "bottom" ? "end" : "start"} sideOffset={8} className="max-h-[min(680px,82vh)] w-96 gap-0 overflow-y-auto p-3">
        <ConnectionsCard doc={doc} editable={editable} onClose={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  )
}
