// The bar across the top of the window, as in the Codex app (docs/plans/information-and-viewer.md):
// the ohm dot, which is back and forward, a thin divider, then where the main area is. The main
// area writes its own title into `#ohm-title` (a portal), so the bar stays one row for every view.
import { useEffect, useRef, useState } from "react"
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"
import { Icon } from "@/components/ui/icon"
import { cn } from "@/lib/cn"
import { useSite } from "@/site/connect"
import { step, useNav } from "@/site/nav"
import { AgentLight } from "@/site/AgentStatus"
import { canGo, go, useWorkspace } from "./store"

/**
 * The ohm dot is back and forward. Hold it and arrows appear either side; drag it left or right, or swipe sideways with two fingers over the bar, as you
 * would turn a page: it follows you, and past a short distance it goes back or forward when you let
 * go. It springs back to its place either way, and leans less where there is nowhere to go.
 */
function NavDot({ back, forward, walk }: { back: boolean; forward: boolean; walk(by: -1 | 1): void }) {
  const [dx, setDx] = useState(0)
  const [held, setHeld] = useState(false)
  const start = useRef<number | null>(null)
  const moved = useRef(0)
  const showing = held || dx !== 0
  const wheel = useRef({ sum: 0, timer: 0, spent: false, rest: 0 })
  const REACH = 7, GO = 5
  const host = useRef<HTMLDivElement>(null)
  const now = useRef({ back, forward, walk })
  now.current = { back, forward, walk }
  // A two-finger sideways swipe anywhere on the bar: the dot follows, and when the fingers stop the
  // step is taken if it went far enough. Swiping right goes back, as when turning back a page.
  useEffect(() => {
    const bar = host.current?.closest("header")
    if (!bar) return
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return
      e.preventDefault()
      const { back, forward, walk } = now.current
      const w = wheel.current
      // One swipe, one step: the glide a trackpad sends after the fingers lift is part of the same
      // swipe, so once a step is taken the rest is ignored until the bar has been still a moment.
      if (w.spent) { clearTimeout(w.rest); w.rest = window.setTimeout(() => { w.spent = false }, 250); return }
      w.sum = Math.max(back ? -REACH : -4, Math.min(forward ? REACH : 4, w.sum + e.deltaX * 0.4))
      setDx(w.sum)
      clearTimeout(w.timer)
      w.timer = window.setTimeout(() => {
        const stepped = (w.sum <= -GO && back) || (w.sum >= GO && forward)
        if (w.sum <= -GO && back) walk(-1); else if (w.sum >= GO && forward) walk(1)
        w.sum = 0; setDx(0)
        if (stepped) { w.spent = true; clearTimeout(w.rest); w.rest = window.setTimeout(() => { w.spent = false }, 250) }
      }, 140)
    }
    bar.addEventListener("wheel", onWheel, { passive: false })
    return () => bar.removeEventListener("wheel", onWheel)
  }, [])
  /** How far the dot may follow: all the way toward a step that exists, a little toward one that doesn't. */
  const lean = (x: number) => Math.max(back ? -REACH : -4, Math.min(forward ? REACH : 4, x))
  const finish = (x: number) => {
    if (x <= -GO && back) walk(-1)
    else if (x >= GO && forward) walk(1)
    setDx(0)
  }
  return (
    <div className="group relative flex h-full w-[68px] shrink-0 items-center justify-center"
      ref={host}>
      {/* Shown while the dot is held or swiped: bright where there is a step, faint where there isn't, and
          brightest once letting go would take it. */}
      <span aria-hidden className={cn("pointer-events-none absolute left-0.5 transition-opacity duration-150", showing ? "opacity-100" : "opacity-0",
        !back ? "text-muted-foreground/35" : dx <= -GO ? "text-foreground" : "text-muted-foreground")}>
        <Icon icon={ChevronLeftIcon} size="sm" />
      </span>
      <span role="slider" aria-label="Back and forward: drag the dot" aria-valuemin={-1} aria-valuemax={1} aria-valuenow={0} tabIndex={0}
        onKeyDown={e => { if (e.key === "ArrowLeft" && back) walk(-1); if (e.key === "ArrowRight" && forward) walk(1) }}
        onPointerDown={e => { start.current = e.clientX; setHeld(true); e.currentTarget.setPointerCapture(e.pointerId) }}
        onPointerMove={e => { if (start.current !== null) { moved.current = lean(e.clientX - start.current); setDx(moved.current) } }}
        onPointerUp={e => {
          if (start.current === null) return
          const x = lean(e.clientX - start.current)
          start.current = null; moved.current = 0; setHeld(false); finish(x)
        }}
        onPointerCancel={() => { start.current = null; setHeld(false); setDx(0) }}
        style={{ transform: `translateX(${dx}px) scale(${held || dx ? 1.15 : 1})`, transition: held || wheel.current.sum ? "none" : "transform 260ms cubic-bezier(.3,1.4,.5,1)" }}
        className="size-icon cursor-grab touch-none rounded-full bg-primary outline-none focus-visible:ring-2 focus-visible:ring-ring/40 active:cursor-grabbing dark:bg-foreground" />
      {/* Shown while the dot is held or swiped: bright where there is a step, faint where there isn't, and
          brightest once letting go would take it. */}
      <span aria-hidden className={cn("pointer-events-none absolute right-0.5 transition-opacity duration-150", showing ? "opacity-100" : "opacity-0",
        !forward ? "text-muted-foreground/35" : dx >= GO ? "text-foreground" : "text-muted-foreground")}>
        <Icon icon={ChevronRightIcon} size="sm" />
      </span>
    </div>
  )
}

export function TopBar() {
  const { view, side, sideWidth } = useWorkspace()
  const site = useSite().connected
  const nav = useNav()
  // Beside the site, back and forward walk the site's own places; elsewhere, the blocks opened.
  const onSite = site && view.kind === "empty"
  const back = onSite ? nav.canBack : canGo(-1)
  const forward = onSite ? nav.canForward : canGo(1)
  const walk = (by: -1 | 1) => (onSite ? step(by) : void go(by))
  return (
    <header className="flex h-14 shrink-0 items-center pt-2 pe-3">
      <NavDot back={back} forward={forward} walk={walk} />
      {/* The title starts where the main area does. */}
      <div className="flex shrink-0 items-center" style={{ width: side && !onSite ? sideWidth + 12 : 12 }}>
        <span aria-hidden className="ms-auto h-5 w-px bg-border" />
      </div>
      <div id="ohm-title" className="flex min-w-0 flex-1 items-center ps-4" />
      <div id="ohm-actions" className="flex shrink-0 items-center gap-2" />
      {/* Your coding agent, always in view: green while connected, red when not. */}
      {onSite && <span className="ms-2"><AgentLight /></span>}
    </header>
  )
}
