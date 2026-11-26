// Hovering a [[link]] shows the block it points to, as Obsidian’s link preview does, and shades that
// block green in the side panel's tree while the pointer stays.
import { placeLine } from "@/data/units"
import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { createPortal } from "react-dom"
import { FileTextIcon } from "lucide-react"
import { Icon } from "@/components/ui/icon"
import { bySlug, titleOf, type Doc } from "@/data/workspace-data"

// The block under the pointer, for anything that shades it (the tree reads this).
let linked: string | null = null
const listeners = new Set<() => void>()
const setLinked = (id: string | null) => { if (id !== linked) { linked = id; listeners.forEach(l => l()) } }
export const useLinkedHover = () => useSyncExternalStore(l => (listeners.add(l), () => listeners.delete(l)), () => linked)

const excerpt = (d: Doc) =>
  d.body.replace(/^#\s+.*\n*/, "").replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[\[([a-z0-9-]+)(?:\|([^\]\n]+))?\]\]/gi, (_, s, words) => words ?? bySlug(s)?.title ?? s)
    .replace(/[#>*_`|-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 220)

export function LinkPreview({ container }: { container: HTMLElement | null }) {
  const [shown, setShown] = useState<{ doc: Doc; rect: DOMRect } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!container) return
    const over = (e: MouseEvent) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>(".ohm-link:not(.is-raw):not(.is-missing)")
      if (!el) return
      const doc = el.dataset.slug ? bySlug(el.dataset.slug) : undefined
      if (!doc) return
      el.classList.add("is-hovered")
      setLinked(doc.id)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setShown({ doc, rect: el.getBoundingClientRect() }), 250)
    }
    const out = (e: MouseEvent) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>(".ohm-link")
      if (!el || el.contains(e.relatedTarget as Node)) return
      el.classList.remove("is-hovered")
      if (timer.current) clearTimeout(timer.current)
      setLinked(null)
      setShown(null)
    }
    container.addEventListener("mouseover", over)
    container.addEventListener("mouseout", out)
    return () => {
      container.removeEventListener("mouseover", over)
      container.removeEventListener("mouseout", out)
      if (timer.current) clearTimeout(timer.current)
      setLinked(null)
    }
  }, [container])

  if (!shown) return null
  const { doc, rect } = shown
  const below = rect.bottom + 8 + 180 < window.innerHeight
  const path = placeLine(doc)
  return createPortal(
    <div role="tooltip" style={{ left: Math.min(rect.left, window.innerWidth - 336), top: below ? rect.bottom + 8 : rect.top - 8, translate: below ? undefined : "0 -100%" }}
      className="pointer-events-none fixed z-50 flex w-80 flex-col gap-1.5 rounded-2xl bg-popover p-3.5 text-popover-foreground shade-4 backdrop-blur-xl animate-in fade-in-0 zoom-in-95 duration-(--ohm-duration-open) ease-(--ohm-ease-out)">
      <span className="flex items-center gap-1.5 text-small text-muted-foreground">
        <Icon icon={FileTextIcon} size="xs" />{path}
      </span>
      <span className="text-body font-semibold">{doc.icon ? `${doc.icon} ` : ""}{titleOf(doc)}</span>
      {excerpt(doc) && <span className="line-clamp-4 text-small text-muted-foreground">{excerpt(doc)}</span>}
    </div>,
    document.body,
  )
}
