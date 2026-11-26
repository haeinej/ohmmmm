// Over a site page in its frame: where each coding agent says it is working (an outline with its name, as
// a collaborator's cursor), what the person picked, and, while pointing, the element under their pointer.
// The page is on the app's own origin (public/site-sw.js), so its elements can be found and measured.
import { useEffect, useRef, useState } from "react"
import { agentName } from "./AgentStatus"
import { framePath, LIVE_FOCUS, LIVE_POINTED, point, selectorOf, type LiveFocus, type LivePick } from "./live"

type Box = { x: number; y: number; w: number; h: number }
const boxOf = (frame: HTMLIFrameElement, el: Element): Box => {
  const r = el.getBoundingClientRect(), f = frame.getBoundingClientRect(), host = frame.offsetParent?.getBoundingClientRect() ?? f
  return { x: r.left + f.left - host.left, y: r.top + f.top - host.top, w: r.width, h: r.height }
}

/**
 * A collaborator as a cursor, as in a shared canvas: an arrow at the element it is working on, with its name
 * (and what it is doing) beside it, gliding as it moves. The element itself is only faintly marked.
 */
function Cursor({ box, label, color }: { box: Box; label: string; color: string }) {
  return (
    <>
      <div aria-hidden className="pointer-events-none absolute z-10 rounded-md transition-all duration-300 ease-(--ohm-ease-out)"
        style={{ left: box.x - 3, top: box.y - 3, width: box.w + 6, height: box.h + 6, background: `color-mix(in oklab, ${color} 10%, transparent)` }} />
      <div aria-hidden className="pointer-events-none absolute z-20 flex items-start gap-1 transition-all duration-300 ease-(--ohm-ease-out)"
        style={{ left: box.x + box.w - 6, top: box.y + box.h - 6 }}>
        <svg width="18" height="18" viewBox="0 0 18 18" className="drop-shadow-sm"><path d="M2 2 L16 8 L9.5 9.5 L8 16 Z" fill={color} stroke="white" strokeWidth="1.5" strokeLinejoin="round" /></svg>
        <span className="mt-3 max-w-64 truncate rounded-md px-2 py-0.5 text-[12px] font-medium text-white shadow-sm" style={{ background: color }}>{label}</span>
      </div>
    </>
  )
}

function Outline({ box, label, tone }: { box: Box; label: string; tone: "agent" | "you" | "hover" }) {
  const color = tone === "agent" ? "var(--ohm-mark-clay)" : tone === "you" ? "var(--ohm-mark-navy)" : "var(--foreground)"
  return (
    <div aria-hidden className="pointer-events-none absolute z-10 rounded-md transition-all duration-(--ohm-duration-state) ease-(--ohm-ease-out)"
      style={{ left: box.x - 3, top: box.y - 3, width: box.w + 6, height: box.h + 6, boxShadow: `0 0 0 2px ${color}`, opacity: tone === "hover" ? 0.5 : 1 }}>
      {tone !== "hover" && (
        <span className="absolute -top-6 left-0 max-w-64 truncate rounded-md px-1.5 py-0.5 text-[11px] font-medium text-white" style={{ background: color }}>{label}</span>
      )}
    </div>
  )
}

export function LiveLayer({ frame, pointing, onPointed }: { frame: React.RefObject<HTMLIFrameElement | null>; pointing: boolean; onPointed(): void }) {
  const [focus, setFocus] = useState<Record<string, LiveFocus>>({})
  const [pick, setPick] = useState<LivePick | null>(null)
  const [hover, setHover] = useState<Box | null>(null)
  const [, redraw] = useState(0)
  const hovered = useRef<Element | null>(null)

  useEffect(() => {
    const onFocus = (e: Event) => { const f = (e as CustomEvent<LiveFocus>).detail; setFocus(all => ({ ...all, [f.agent]: f })) }
    const onPick = (e: Event) => { const p = (e as CustomEvent<LivePick & { cleared?: boolean }>).detail; setPick(p.cleared ? null : p) }
    window.addEventListener(LIVE_FOCUS, onFocus); window.addEventListener(LIVE_POINTED, onPick)
    return () => { window.removeEventListener(LIVE_FOCUS, onFocus); window.removeEventListener(LIVE_POINTED, onPick) }
  }, [])

  // Outlines follow the page as it scrolls, resizes or loads.
  useEffect(() => {
    let frameId = 0
    const tick = () => { redraw(n => n + 1); frameId = requestAnimationFrame(tick) }
    frameId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frameId)
  }, [])

  // Pointing: the element under the pointer is outlined; a click picks it, for the person's agent.
  useEffect(() => {
    const f = frame.current
    const doc = f?.contentDocument
    if (!pointing || !f || !doc) { setHover(null); return }
    const over = (e: MouseEvent) => { hovered.current = e.target as Element; setHover(boxOf(f, e.target as Element)) }
    const click = (e: MouseEvent) => {
      e.preventDefault(); e.stopPropagation()
      const el = e.target as Element
      const picked: LivePick = { path: framePath(f), selector: selectorOf(el), text: (el.textContent ?? "").trim().slice(0, 2000), html: el.outerHTML.slice(0, 6000) }
      setPick(picked); void point(picked); onPointed()
    }
    doc.addEventListener("mouseover", over, true); doc.addEventListener("click", click, true)
    doc.documentElement.style.cursor = "crosshair"
    return () => { doc.removeEventListener("mouseover", over, true); doc.removeEventListener("click", click, true); doc.documentElement.style.cursor = "" }
  }, [pointing, frame, onPointed])

  const f = frame.current
  const doc = (() => { try { return f?.contentDocument ?? null } catch { return null } })()
  const here = framePath(f)
  const find = (path: string, selector: string) => {
    if (!f || !doc || !selector || (path && path !== here)) return null
    try { const el = doc.querySelector(selector); return el ? boxOf(f, el) : null } catch { return null }
  }
  return (
    <>
      {Object.values(focus).map(a => { const b = find(a.path, a.selector); return b && <Cursor key={a.agent} box={b} color="var(--ohm-mark-clay)" label={a.note ? `${agentName(a.agent)} · ${a.note}` : agentName(a.agent)} /> })}
      {pick && (() => { const b = find(pick.path, pick.selector); return b && <Outline box={b} tone="you" label="you" /> })()}
      {pointing && hover && <Outline box={hover} tone="hover" label="" />}
    </>
  )
}
