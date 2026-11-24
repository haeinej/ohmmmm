// The graph, as Obsidian's graph view: a live force layout you pan, zoom and drag; hovering lights a
// block and its lines and fades the rest; names come in as you zoom.
//
// Each node is a block (graph/model.ts), coloured by its label and sized by its backlinks; blocks
// with one label gather in one direction from you, with the label's name over them. Each line is a
// connect the person made. One an agent only observed is dashed, and drawn apart, bowed beside it.
// You are the circle in the middle; with the cortex on, what your agents know about you and their
// skills and tools (diamonds) gather close around you.
import { useEffect, useMemo, useRef, useState } from "react"
import {
  forceCollide, forceLink, forceManyBody, forceRadial, forceSimulation, forceX, forceY,
  type Simulation, type SimulationLinkDatum, type SimulationNodeDatum,
} from "d3-force"
import { select } from "d3-selection"
import { zoom as d3zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from "d3-zoom"
import { MaximizeIcon, MinusIcon, PlusIcon, SlidersHorizontalIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Icon } from "@/components/ui/icon"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Switch } from "@/components/ui/switch"
import { buildGraph, DEFAULT_FILTERS, type GraphEdge, type GraphLabel, type GraphNode, type Root } from "@/graph/model"
import { cn } from "@/lib/cn"
import { cortex, cortexState } from "@/data/workspace-data"
import { kept, me, open, revealFolder, setGraphCortex, showGraph, useWorkspace } from "./store"

type SimNode = GraphNode & SimulationNodeDatum
type SimLink = SimulationLinkDatum<SimNode> & GraphEdge
type Point = { x: number; y: number }

/** Where each node was last, so re-centring or filtering moves nodes instead of re-scattering them. */
const last = new Map<string, Point>()

/** Bigger the more the person connected to it. */
const radiusOf = (n: GraphNode) => 4 + Math.sqrt(n.backlinks) * 2.2
/** Thicker the stronger: one for each way two things are joined and each channel they share. */
const widthOf = (e: GraphEdge) => e.observed ? 1 : Math.min(3.5, 0.8 + (e.weight - 1) * 0.6)
/**
 * A label's colour, from the theme's chart tokens only: the forest and green family, at two
 * strengths. Red is never used, since it means failed.
 */
const SWATCH = [
  "fill-chart-1", "fill-chart-2", "fill-chart-3", "fill-chart-4",
  "fill-chart-1/55", "fill-chart-2/55", "fill-chart-3/55", "fill-chart-4/55",
]
/** An observed edge bows beside the straight line between the same two blocks. */
const bow = (a: Point, b: Point) => {
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1
  return `M${a.x},${a.y} Q${mx - (dy / len) * 14},${my + (dx / len) * 14} ${b.x},${b.y}`
}
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches
const polar = (a: number, r: number): Point => ({ x: Math.cos(a) * r, y: Math.sin(a) * r })

/** You, in the middle. */
const ME = 18
/** How far from you each kind of thing gathers: what is known about you close, what you wrote further out. */
const REACH: Record<Root, number> = { cortex: 78, vault: 190 }

/** Which way from you each label's blocks gather: an angle per label, by how many it holds. */
function directionsOf(labels: GraphLabel[]) {
  const at = new Map<string, number>()
  for (const root of ["vault", "cortex"] as Root[]) {
    const mine = labels.filter(label => label.root === root)
    const total = mine.reduce((sum, label) => sum + Math.max(1, label.members.length), 0)
    // The two kinds start apart, so their clusters interleave instead of lining up.
    let angle = root === "cortex" ? -Math.PI / 2 + 0.6 : -Math.PI / 2
    for (const label of mine) {
      const span = (Math.PI * 2 * Math.max(1, label.members.length)) / total
      at.set(`${root}:${label.name}`, angle + span / 2)
      angle += span
    }
  }
  return at
}

/** A floating control over the graph: the popover surface, solid in dark. */
const floating = "rounded-2xl bg-popover text-popover-foreground shade-3"

/** Lives in the side panel, in the home. What it draws follows the home's scope and who you are looking as. */
export function GraphView() {
  const { rev, scope, audience, graphCenter: center, graphCortex, view, filters: repoFilters } = useWorkspace()
  // The open item is ringed in the graph too: one active item, everywhere.
  const activeId = view.kind === "doc" ? view.id : null
  const include = useMemo(() => ({ vault: scope.vault, cortex: graphCortex }), [scope.vault, graphCortex])
  const [showLinks, setShowLinks] = useState(DEFAULT_FILTERS.links)
  const [layout, setLayout] = useState(0)
  const graph = useMemo(() => buildGraph({ center, vault: include.vault, cortex: include.cortex, audience, links: showLinks, keep: kept }), [center, include, audience, showLinks, repoFilters, rev]) // eslint-disable-line react-hooks/exhaustive-deps

  const svgRef = useRef<SVGSVGElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null)
  const userMoved = useRef(false)
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [t, setT] = useState<ZoomTransform>(zoomIdentity)
  const [, setFrame] = useState(0)
  const [hover, setHover] = useState<string | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)

  useEffect(() => {
    const el = boxRef.current!
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const directions = useMemo(() => directionsOf(graph.labels), [graph])
  const swatchOf = useMemo(() => new Map(graph.labels.map(label => [`${label.root}:${label.name}`, label.swatch])), [graph])
  const aimOf = (n: GraphNode) => polar(directions.get(`${n.root}:${n.label}`) ?? -Math.PI / 2, REACH[n.root])

  const { nodes, links } = useMemo(() => {
    const nodes: SimNode[] = graph.nodes.map(n => {
      const target = aimOf(n)
      return { ...n, ...(last.get(n.id) ?? { x: target.x + (Math.random() - 0.5) * 20, y: target.y + (Math.random() - 0.5) * 20 }) }
    })
    const links: SimLink[] = graph.edges.map(e => ({ ...e }))
    // Observed edges are drawn but do not pull: the layout is what the person made.
    return { nodes, links }
  }, [graph, layout]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const sim = forceSimulation<SimNode, SimLink>(nodes)
      .force("link", forceLink<SimNode, SimLink>(links).id(d => d.id).distance(60).strength(l => l.observed ? 0 : Math.min(0.1, 0.025 * l.weight)))
      .force("charge", forceManyBody<SimNode>().strength(-40).distanceMax(120))
      .force("collide", forceCollide<SimNode>(n => radiusOf(n) + 9).strength(0.9))
      // Soft pulls, not fixed places: toward the folder's direction, and to the kind's distance from you.
      .force("aimX", forceX<SimNode>(n => aimOf(n).x).strength(0.1))
      .force("aimY", forceY<SimNode>(n => aimOf(n).y).strength(0.1))
      .force("reach", forceRadial<SimNode>(n => REACH[n.root]).strength(0.12))
      // Nothing sits on you.
      .force("clear", () => {
        for (const n of nodes) {
          const r = Math.hypot(n.x!, n.y!) || 1, lo = ME + radiusOf(n) + 22
          if (r < lo) { n.x! *= lo / r; n.y! *= lo / r }
        }
      })
      .velocityDecay(0.35)
      .alphaDecay(0.02)
      .alphaMin(0.002)
    simRef.current = sim
    // Settle before the first frame, so it opens in place and fitted, then breathe a little.
    sim.stop().tick(300)
    const remember = () => nodes.forEach(n => last.set(n.id, { x: n.x!, y: n.y! }))
    remember()
    setFrame(f => f + 1)
    requestAnimationFrame(() => { if (!userMoved.current) fitRef.current() })
    if (!reducedMotion()) sim.on("tick", () => { remember(); setFrame(f => f + 1) }).alpha(0.03).restart()
    return () => { sim.stop() }
  }, [nodes, links]) // eslint-disable-line react-hooks/exhaustive-deps

  // Zoom and pan; pointer-downs on nodes drag them instead.
  useEffect(() => {
    const svg = select(svgRef.current!)
    const z = d3zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.25, 5])
      .filter(e => e.type === "wheel" || (!(e.target as Element).closest("[data-node]") && !e.button))
      .on("zoom", e => {
        setT(e.transform)
        // Once you pan or zoom yourself, the view stays where you put it.
        if (e.sourceEvent) userMoved.current = true
      })
    zoomRef.current = z
    svg.call(z).on("dblclick.zoom", null)
    return () => { svg.on(".zoom", null) }
  }, [])

  const fit = () => {
    if (!svgRef.current || !zoomRef.current || !size.w) return
    const xs = [0, ...nodes.map(n => n.x!)], ys = [0, ...nodes.map(n => n.y!)]
    const pad = 48
    const minX = Math.min(...xs) - pad, maxX = Math.max(...xs) + pad, minY = Math.min(...ys) - pad - 10, maxY = Math.max(...ys) + pad
    const k = Math.min(1.8, Math.max(0.25, Math.min(size.w / (maxX - minX), size.h / (maxY - minY))))
    select(svgRef.current).call(zoomRef.current.transform,
      zoomIdentity.translate(size.w / 2 - (k * (minX + maxX)) / 2, size.h / 2 - (k * (minY + maxY)) / 2).scale(k))
  }
  // Keep the whole graph in view as the panel resizes and the layout settles, until you pan or
  // zoom yourself; a change in what is drawn starts that over.
  const shape = `${center}|${include.vault}|${include.cortex}|${audience}`
  useEffect(() => { userMoved.current = false }, [shape])
  const fitRef = useRef(fit)
  fitRef.current = fit
  useEffect(() => { if (size.w && !userMoved.current) fit() }, [size, shape]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const sim = simRef.current
    sim?.on("end.fit", () => { if (!userMoved.current) fitRef.current() })
    return () => { sim?.on("end.fit", null) }
  }, [nodes])

  const zoomBy = (factor: number) => select(svgRef.current!).call(zoomRef.current!.scaleBy, factor)

  // The lit item: the one under the pointer, or the one being dragged.
  const lit = dragging ?? hover
  const byId = useMemo(() => new Map(nodes.map(n => [n.id, n])), [nodes])
  const near = useMemo(() => {
    if (!lit) return null
    const s = new Set([lit])
    for (const l of links) {
      const a = (l.source as SimNode).id, b = (l.target as SimNode).id
      if (a === lit) s.add(b)
      if (b === lit) s.add(a)
    }
    return s
  }, [lit, links])
  const litLabel = lit ? byId.get(lit) : undefined

  // Dragging pins the node under the pointer and keeps the layout warm, so neighbours follow on
  // their springs; letting go releases it to ease back. A press without movement is a click.
  const drag = useRef<{ id: string; moved: boolean; x0: number; y0: number } | null>(null)
  const toGraph = (e: React.PointerEvent) => {
    const r = svgRef.current!.getBoundingClientRect()
    return t.invert([e.clientX - r.left, e.clientY - r.top])
  }
  const onDown = (e: React.PointerEvent, n: SimNode) => {
    if (e.button !== 0) return
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    drag.current = { id: n.id, moved: false, x0: e.clientX, y0: e.clientY }
  }
  const onMove = (e: React.PointerEvent, n: SimNode) => {
    const d = drag.current
    if (!d || d.id !== n.id) return
    if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 4) return
    if (!d.moved) { d.moved = true; setDragging(n.id) }
    const [x, y] = toGraph(e)
    n.fx = x; n.fy = y
    if (!reducedMotion()) simRef.current?.alphaTarget(0.12).restart()
    else { simRef.current?.tick(1); setFrame(f => f + 1) }
  }
  const onUp = (n: SimNode) => {
    const d = drag.current
    drag.current = null
    setDragging(null)
    n.fx = null; n.fy = null
    simRef.current?.alphaTarget(0)
    if (d && !d.moved) open(n.doc.id)
  }

  const isMe = graph.center.did === me.did
  const profileDoc = cortex.find(doc => doc.kind === "profile")
  const k = t.k
  // Names fade in between these zoom levels; cluster names always show.
  const detail = Math.max(0, Math.min(1, (k - 1.1) / 0.4))
  const reveal = (label: GraphLabel) => revealFolder(label.root, label.name)

  return (
    <div ref={boxRef} className="relative min-h-0 flex-1 overflow-hidden">
      <svg ref={svgRef} role="img" aria-label={isMe ? "Graph of your home around you, and how it connects" : `Graph of what mentions @${graph.center.handle}`}
        className={cn("absolute inset-0 size-full touch-none select-none", dragging ? "cursor-grabbing" : "cursor-grab")}>
        <g transform={t.toString()}>
          {/* Everything known about you hangs from you. */}
          {nodes.filter(n => n.root === "cortex").map(n => {
            const on = lit ? lit === n.id : null
            return (
              <line key={`you|${n.id}`} x1={0} y1={0} x2={n.x} y2={n.y} vectorEffect="non-scaling-stroke" strokeWidth={0.8} strokeLinecap="round"
                className={cn("stroke-primary transition-opacity duration-(--ohm-duration-open) ease-(--ohm-ease-out) dark:stroke-foreground",
                  on ? "opacity-70" : on === false ? "opacity-[.05]" : "opacity-15")} />
            )
          })}
          {links.map((l, i) => {
            const a = l.source as SimNode, b = l.target as SimNode
            const on = lit ? a.id === lit || b.id === lit : null
            const observed = Boolean(l.observed?.length)
            const said = [l.why, ...(l.observed ?? []).map(text => `Observed: ${text}`)].filter(Boolean).join("\n")
            const look = cn("fill-none transition-[opacity,stroke] duration-(--ohm-duration-open) ease-(--ohm-ease-out)",
              on || observed ? "stroke-primary dark:stroke-foreground" : "stroke-muted-foreground",
              on === false ? "opacity-[.07]" : on ? "opacity-100" : observed ? "opacity-55" : "opacity-40")
            // What an agent observed is its own line: dashed, and bowed apart from any the person made.
            return observed ? (
              <path key={i} d={bow({ x: a.x!, y: a.y! }, { x: b.x!, y: b.y! })} vectorEffect="non-scaling-stroke"
                strokeWidth={widthOf(l) + (on ? 0.4 : 0)} strokeLinecap="round" strokeDasharray="3 3" className={look}>
                {said && <title>{said}</title>}
              </path>
            ) : (
              <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} vectorEffect="non-scaling-stroke"
                strokeWidth={widthOf(l) + (on ? 0.4 : 0)} strokeLinecap="round" className={look}>
                {said && <title>{said}</title>}
              </line>
            )
          })}
          {/* You: clicking opens your profile. */}
          <g className={cn("cursor-pointer outline-none transition-opacity duration-(--ohm-duration-open)", lit && "opacity-50")} data-node role="button" tabIndex={0}
            aria-label={isMe ? `Your profile, ${graph.center.name}` : graph.center.name}
            onClick={() => profileDoc && isMe && open(profileDoc.id)} onKeyDown={e => (e.key === "Enter" || e.key === " ") && profileDoc && isMe && (e.preventDefault(), open(profileDoc.id))}>
            <title>{isMe ? `You, ${graph.center.name}` : `@${graph.center.handle}`}</title>
            <circle r={ME + 5} className="fill-card" />
            <circle r={ME} className="fill-primary dark:fill-foreground" />
            <text textAnchor="middle" dy="0.35em" className="fill-primary-foreground text-body font-semibold dark:fill-background">
              {(graph.center.name || graph.center.handle || "?").slice(0, 1).toUpperCase()}
            </text>
          </g>
          {nodes.map(n => {
            const r = radiusOf(n)
            const isLit = n.id === lit
            const active = n.doc.id === activeId
            const faded = near && !near.has(n.id)
            const on = isLit || active
            const known = n.root === "cortex"
            return (
              <g key={n.id} data-node data-doc-id={n.doc.id} transform={`translate(${n.x},${n.y})`} role="button" tabIndex={0} aria-label={n.name}
                className={cn("cursor-pointer outline-none transition-opacity duration-(--ohm-duration-open) ease-(--ohm-ease-out)", faded && "opacity-20")}
                onPointerEnter={() => setHover(n.id)} onPointerLeave={() => setHover(h => (h === n.id ? null : h))}
                onFocus={() => setHover(n.id)} onBlur={() => setHover(null)}
                onPointerDown={e => onDown(e, n)} onPointerMove={e => onMove(e, n)} onPointerUp={() => onUp(n)}
                onKeyDown={e => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), open(n.doc.id))}>
                {/* A larger, invisible target: small nodes are easy to hit. */}
                <circle r={Math.max(r + 6, 12)} className="fill-transparent" />
                {known ? (
                  // What your agents know about you: a green diamond with a light core.
                  <>
                    {on && <rect x={-(r + 4)} y={-(r + 4)} width={(r + 4) * 2} height={(r + 4) * 2} rx={2.5} transform="rotate(45)"
                      className="fill-none stroke-primary dark:stroke-foreground" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />}
                    <rect x={-r} y={-r} width={r * 2} height={r * 2} rx={1.5} transform="rotate(45)"
                      className={cn("transition-[fill] duration-(--ohm-duration-open) ease-(--ohm-ease-out)", on ? "fill-primary dark:fill-foreground" : "fill-primary/90 dark:fill-chart-2")} />
                    <rect x={-r * 0.35} y={-r * 0.35} width={r * 0.7} height={r * 0.7} transform="rotate(45)" className="fill-card" />
                  </>
                ) : (
                  // A block: a dot in its label's colour.
                  <>
                    {on && <circle r={r + 3.5} className="fill-none stroke-primary dark:stroke-foreground" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />}
                    <circle r={r} className={cn("transition-[fill] duration-(--ohm-duration-open) ease-(--ohm-ease-out)", SWATCH[swatchOf.get(`${n.root}:${n.label}`) ?? 0])} />
                  </>
                )}
              </g>
            )
          })}
        </g>
        {/* Item names in screen space, so they stay one size at any zoom. */}
        <g className="pointer-events-none">
          {(() => {
            // Names that must show go first; any other that would sit on one already placed is left out.
            const placed: { x: number; y: number; w: number }[] = []
            const must = (n: SimNode) => n.id === lit || n.doc.id === activeId
            return [...nodes].sort((p, q) => Number(must(q)) - Number(must(p)) || Number(near?.has(q.id) ?? 0) - Number(near?.has(p.id) ?? 0) || q.backlinks - p.backlinks || q.degree - p.degree).map(n => {
              const show = near?.has(n.id) || n.doc.id === activeId ? 1 : detail
              if (!show) return null
              const [x, y] = t.apply([n.x!, n.y!])
              const r = radiusOf(n) * k * (n.root === "cortex" ? 1.4 : 1)
              const name = n.name.length > 28 ? `${n.name.slice(0, 27)}…` : n.name
              const w = name.length * 6.8
              if (!must(n) && placed.some(p => Math.abs(p.x - x) < (p.w + w) / 2 + 6 && Math.abs(p.y - (y + r)) < 17)) return null
              placed.push({ x, y: y + r, w })
              const faded = near && !near.has(n.id)
              return (
                <text key={n.id} x={x} y={y + r + 13} textAnchor="middle" opacity={faded ? 0.15 : show}
                  className={cn("text-small transition-opacity duration-(--ohm-duration-open) ease-(--ohm-ease-out)", n.id === lit ? "fill-foreground" : "fill-muted-foreground")}>
                  {name}
                </text>
              )
            })
          })()}
        </g>
      </svg>

      {/* Each label's name, above its blocks. Clicking one shows its channel in the list. */}
      <div className="pointer-events-none absolute inset-0">
        {(() => {
          const placed: { x: number; y: number; w: number }[] = []
          return graph.labels.filter(label => label.members.length).map(label => {
            const pts = label.members.map(id => byId.get(id)).filter(Boolean) as SimNode[]
            if (!pts.length) return null
            const [x, y] = t.apply([pts.reduce((s, n) => s + n.x!, 0) / pts.length, Math.min(...pts.map(n => n.y!)) - 22])
            const w = label.name.length * 7 + 10
            if (placed.some(p => Math.abs(p.x - x) < (p.w + w) / 2 && Math.abs(p.y - y) < 16)) return null
            placed.push({ x, y, w })
            const faded = litLabel && (litLabel.label !== label.name || litLabel.root !== label.root)
            return (
              <button key={`${label.root}:${label.name}`} type="button" onClick={() => reveal(label)} title={`Show ${label.name} in the list`}
                style={{ left: x, top: y, opacity: faded ? 0.35 : 1 }}
                className="pointer-events-auto absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 whitespace-nowrap rounded-md px-1 text-small leading-4 font-semibold text-foreground/70 transition-opacity duration-(--ohm-duration-open) ease-(--ohm-ease-out) hover:bg-muted">
                {label.root === "vault" && <svg aria-hidden width="8" height="8"><circle cx="4" cy="4" r="4" className={SWATCH[label.swatch]} /></svg>}
                {label.name}
              </button>
            )
          })
        })()}
      </div>

      {/* Chrome floats over the graph; only the controls carry a material. */}
      <div className="pointer-events-none absolute inset-x-2 top-2 flex items-start justify-between gap-2">
        {!isMe ? (
          <div className={cn(floating, "pointer-events-auto flex items-center gap-2 py-1 ps-3 pe-1 text-small")}>
            <span className="truncate font-semibold">Mentioning @{graph.center.handle}</span>
            <Button size="xs" variant="ghost" onClick={() => showGraph()}>Back to me</Button>
          </div>
        ) : <span />}
        <Popover>
          <PopoverTrigger render={<Button size="icon-sm" variant="ghost" aria-label="Graph settings" className={cn(floating, "pointer-events-auto")} />}>
            <Icon icon={SlidersHorizontalIcon} size="sm" />
          </PopoverTrigger>
          <PopoverContent align="end" className="w-56 gap-0 p-2">
            <label className="flex min-h-8 items-center justify-between gap-3 rounded-lg px-1.5 text-body hover:bg-muted">
              Connections
              <Switch checked={showLinks} onCheckedChange={setShowLinks} />
            </label>
            {/* Your cortex, around you. Off by default; it opens only on a device that unlocked your keys. */}
            <label className="flex min-h-8 items-center justify-between gap-3 rounded-lg px-1.5 text-body hover:bg-muted">
              Cortex
              <Switch checked={graphCortex} disabled={cortexState !== "open"} onCheckedChange={setGraphCortex} />
            </label>
            <Button size="sm" variant="secondary" className="mt-1.5 h-8 w-full"
              onClick={() => { last.clear(); userMoved.current = false; setLayout(n => n + 1) }}>
              Lay out again
            </Button>
          </PopoverContent>
        </Popover>
      </div>

      <div className={cn(floating, "absolute end-2 bottom-2 flex flex-col p-0.5")} role="group" aria-label="Zoom">
        <Button size="icon-sm" variant="ghost" aria-label="Zoom in" onClick={() => zoomBy(1.3)}><Icon icon={PlusIcon} size="sm" /></Button>
        <Button size="icon-sm" variant="ghost" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.3)}><Icon icon={MinusIcon} size="sm" /></Button>
        <Button size="icon-sm" variant="ghost" aria-label="Fit to view" onClick={fit}><Icon icon={MaximizeIcon} size="sm" /></Button>
      </div>
    </div>
  )
}
