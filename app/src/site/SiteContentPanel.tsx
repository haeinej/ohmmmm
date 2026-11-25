// The side panel beside the Site view (flows/site.md): the person's profile fixed on top, then the site's content as the vault holds it, each
// channel one row of block tiles. It stays for as long as the Site view is open. A tile opens its block over the canvas;
// every tile can be picked up and dragged.
import { useEffect, useState } from "react"
import { Maximize2Icon, Minimize2Icon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Icon } from "@/components/ui/icon"
import { cn } from "@/lib/cn"
import { ProfileCard } from "./ProfileView"
import { SidePanelFrame } from "@/workspace/Surface"
import { askToOpenBlock, readContent, siteUrl as url, type SiteContent, type SiteItem } from "./source"


const tile = "relative block overflow-hidden rounded-md bg-background text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/40"

/**
 * One block: as tall as its channel's row, or, in an expanded channel, as wide as its column. An image or a video keeps its own shape, wide or tall. An article or a project is a 3:4 sheet holding the start of its own writing in miniature.
 */
function Tile({ item, masonry }: { item: SiteItem; masonry?: boolean }) {
  const page = item.kind === "article" || item.kind === "project"
  return (
    <button type="button" draggable title={item.title} aria-label={page ? `Open ${item.title}` : item.title}
      onClick={() => askToOpenBlock(item.path)}
      onDragStart={e => {
        e.dataTransfer.setData("application/x-ohm-site-item", JSON.stringify(item))
        e.dataTransfer.setData("text/plain", item.path)
        e.dataTransfer.effectAllowed = "copy"
      }}
      className={cn(tile, masonry ? "mb-1.5 w-full break-inside-avoid" : "h-full shrink-0", page && "aspect-[3/4] hover:bg-accent")}>
      {item.kind === "image" ? (
        <img src={url(item.thumb ?? item.path)} alt="" loading="lazy" draggable={false} className={masonry ? "block h-auto w-full" : "block h-full w-auto max-w-none"} />
      ) : item.kind === "video" ? (
        <video src={url(item.thumb ?? item.path)} muted playsInline preload="metadata" draggable={false} className={masonry ? "block h-auto w-full" : "block h-full w-auto max-w-none"} />
      ) : (
        // The sheet is laid out at twice the tile's width and shown at half size: a small copy of the page, not a label.
        <span aria-hidden className="absolute top-0 left-0 flex h-[200%] w-[200%] origin-top-left scale-50 flex-col gap-2 p-5">
          <span className="font-medium leading-tight">{item.title}</span>
          <span className="min-h-0 flex-1 overflow-hidden whitespace-pre-line text-small text-muted-foreground mask-b-from-70%">{item.excerpt}</span>
        </span>
      )}
    </button>
  )
}

/**
 * One channel: its name and how many blocks it holds, then its blocks side by side in one row.
 * Expanded, it is the only channel shown and fills the panel under the profile, its blocks in a
 * two-column masonry that scrolls down.
 */
function Channel({ name, items, expanded, onExpand }: { name: string; items: SiteItem[]; expanded: boolean; onExpand(on: boolean): void }) {
  return (
    <section aria-label={name} className="flex flex-col gap-2 rounded-lg bg-muted/60 p-2">
      <header className="flex items-center justify-between gap-2 ps-1">
        <h3 className="truncate font-medium">{name}</h3>
        <span className="flex shrink-0 items-center gap-1 text-small text-muted-foreground">
          {items.length === 1 ? "1 block" : `${items.length} blocks`}
          <Button size="icon-xs" variant="ghost" aria-label={expanded ? `Back to all channels` : `Expand ${name}`} aria-pressed={expanded} onClick={() => onExpand(!expanded)}>
            <Icon icon={expanded ? Minimize2Icon : Maximize2Icon} />
          </Button>
        </span>
      </header>
      {expanded ? (
        <div className="columns-2 gap-1.5">{items.map(item => <Tile key={item.path} item={item} masonry />)}</div>
      ) : (
        <div className="flex h-36 gap-1.5 overflow-x-auto overscroll-x-contain pb-1">{items.map(item => <Tile key={item.path} item={item} />)}</div>
      )}
    </section>
  )
}

export function SiteContentPanel() {
  const [content, setContent] = useState<SiteContent | null>(null)
  /** The one channel that is expanded, by name. */
  const [expanded, setExpanded] = useState<string | null>(null)
  useEffect(() => { readContent().then(setContent, () => setContent({ site: "", collections: [] })) }, [])
  return (
    // The profile is the panel's heading, so it stays in place while the channels scroll under it.
    <SidePanelFrame label="Your home" heading={<ProfileCard />}>
      <div className="flex flex-col gap-3 pt-1">
        {content?.collections.filter(c => !expanded || c.name === expanded).map(c => (
          <Channel key={c.name} name={c.name} items={c.items} expanded={c.name === expanded} onExpand={on => setExpanded(on ? c.name : null)} />
        ))}
      </div>
    </SidePanelFrame>
  )
}
