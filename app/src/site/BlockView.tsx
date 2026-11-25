// One block, opened over the canvas (flows/site.md): what it is on the left, as large as it fits,
// and what is known about it on the right, with its connections. A page opens as the page itself.
import { useEffect } from "react"
import { ChevronLeftIcon, ChevronRightIcon, XIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Icon } from "@/components/ui/icon"
import { siteUrl, type SiteItem } from "./source"

const KIND = { page: "Page", image: "Image", video: "Video" } as const
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })
/** A page's title without the site's name after it. */
export const shortTitle = (title: string) => title.replace(/\s+[—|-]\s+[^—|-]+$/, "")

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 text-small">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right">{children}</span>
    </div>
  )
}

export function BlockView({ item, channel, titleOf, onStep, onClose, onShowPage }: {
  item: SiteItem
  /** The channel it was opened from, and where it stands in it. */
  channel: { name: string; at: number; of: number }
  /** A page's title, for naming a connection. */
  titleOf(path: string): string
  onStep(by: -1 | 1): void
  onClose(): void
  /** Bring a page's frame into view on the canvas. */
  onShowPage(path: string): void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === "Escape") { e.preventDefault(); onClose() }
      if (e.key === "ArrowLeft") { e.preventDefault(); onStep(-1) }
      if (e.key === "ArrowRight") { e.preventDefault(); onStep(1) }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose, onStep])

  const title = item.kind === "page" ? shortTitle(item.title) : item.title
  return (
    <div role="dialog" aria-label={title} className="absolute inset-0 z-10 flex min-h-0 bg-card">
      <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center bg-muted p-6">
        {item.kind === "image" ? (
          <img src={siteUrl(item.path)} alt={title} className="max-h-full max-w-full object-contain" />
        ) : item.kind === "video" ? (
          <video src={siteUrl(item.path)} controls playsInline className="max-h-full max-w-full" />
        ) : (
          // The page as it is published: its own splash, if it has one, is stepped past as on the canvas.
          <iframe key={item.path} title={title} src={siteUrl(item.path)} className="size-full rounded-lg bg-background"
            onLoad={e => e.currentTarget.contentDocument?.getElementById("splash-name")?.click()} />
        )}
      </div>

      <aside aria-label="About this block" className="flex w-80 shrink-0 flex-col gap-4 overflow-y-auto p-5">
        <div className="flex items-center justify-end gap-0.5">
          <span className="me-auto text-small text-muted-foreground tabular-nums">{channel.at + 1} of {channel.of}</span>
          <Button size="icon-sm" variant="ghost" aria-label="Previous block" disabled={channel.at === 0} onClick={() => onStep(-1)}><Icon icon={ChevronLeftIcon} /></Button>
          <Button size="icon-sm" variant="ghost" aria-label="Next block" disabled={channel.at === channel.of - 1} onClick={() => onStep(1)}><Icon icon={ChevronRightIcon} /></Button>
          <Button size="icon-sm" variant="ghost" aria-label="Close" onClick={onClose}><Icon icon={XIcon} /></Button>
        </div>

        <div className="flex flex-col gap-1">
          <h2 className="break-words">{title}</h2>
          <p className="break-all text-small text-muted-foreground">{item.path}</p>
        </div>

        <div className="flex flex-col">
          <Row label="Kind">{KIND[item.kind]}</Row>
          <Row label="Channel">{channel.name}</Row>
          <Row label="Modified">{day(item.modified)}</Row>
        </div>

        {item.kind === "page" && <Button variant="secondary" className="self-start" onClick={() => onShowPage(item.path)}>Show on canvas</Button>}

        <section aria-label="Connections" className="flex flex-col gap-1">
          <h3 className="flex items-baseline gap-2 text-small font-medium">Connections <span className="font-normal text-muted-foreground">{item.usedIn.length}</span></h3>
          {item.kind === "page" ? (
            <p className="text-small text-muted-foreground">A page's connections aren't read yet.</p>
          ) : item.usedIn.length === 0 ? (
            <p className="text-small text-muted-foreground">No page shows this yet.</p>
          ) : item.usedIn.map(page => (
            <button key={page} type="button" onClick={() => onShowPage(page)}
              className="flex items-baseline justify-between gap-3 rounded-lg bg-muted px-3 py-2 text-left text-small outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/40">
              <span className="min-w-0 truncate">{shortTitle(titleOf(page))}</span>
              <span className="shrink-0 text-muted-foreground">{page}</span>
            </button>
          ))}
        </section>
      </aside>
    </div>
  )
}
