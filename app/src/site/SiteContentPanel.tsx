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


const tile = "relative block h-full shrink-0 overflow-hidden rounded-md bg-background text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/40"

/**
 * One block, as tall as its channel's row. An image or a video keeps its own shape, wide or tall. An article or a project is a 3:4 sheet holding the start of its own writing in miniature.
 */
function Tile({ item }: { item: SiteItem }) {
  const page = item.kind === "article" || item.kind === "project"
  return (
    <button type="button" draggable title={item.title} aria-label={page ? `Open ${item.title}` : item.title}
      onClick={() => askToOpenBlock(item.path)}
      onDragStart={e => {
        e.dataTransfer.setData("application/x-ohm-site-item", JSON.stringify(item))
        e.dataTransfer.setData("text/plain", item.path)
        e.dataTransfer.effectAllowed = "copy"
      }}
      className={cn(tile, page && "aspect-[3/4] hover:bg-accent")}>
      {item.kind === "image" ? (
        <img src={url(item.thumb ?? item.path)} alt="" loading="lazy" draggable={false} className="block h-full w-auto max-w-none" />
      ) : item.kind === "video" ? (
        <video src={url(item.thumb ?? item.path)} muted playsInline preload="metadata" draggable={false} className="block h-full w-auto max-w-none" />
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
 * Expanded, the row becomes two, the blocks dealt between them, so more of the channel is in view.
 */
function Channel({ name, items }: { name: string; items: SiteItem[] }) {
  const [expanded, setExpanded] = useState(false)
  const rows = expanded ? [items.filter((_, i) => i % 2 === 0), items.filter((_, i) => i % 2 === 1)] : [items]
  return (
    <section aria-label={name} className="flex flex-col gap-2 rounded-lg bg-muted/60 p-2">
      <header className="flex items-center justify-between gap-2 ps-1">
        <h3 className="truncate font-medium">{name}</h3>
        <span className="flex shrink-0 items-center gap-1 text-small text-muted-foreground">
          {items.length === 1 ? "1 block" : `${items.length} blocks`}
          <Button size="icon-xs" variant="ghost" aria-label={expanded ? `Show ${name} in one row` : `Expand ${name}`} aria-pressed={expanded} onClick={() => setExpanded(!expanded)}>
            <Icon icon={expanded ? Minimize2Icon : Maximize2Icon} />
          </Button>
        </span>
      </header>
      <div className="overflow-x-auto overscroll-x-contain pb-1">
        <div className="flex w-max flex-col gap-1.5">
          {rows.map((row, i) => (
            <div key={i} className="flex h-36 gap-1.5">{row.map(item => <Tile key={item.path} item={item} />)}</div>
          ))}
        </div>
      </div>
    </section>
  )
}

export function SiteContentPanel() {
  const [content, setContent] = useState<SiteContent | null>(null)
  useEffect(() => { readContent().then(setContent, () => setContent({ site: "", collections: [] })) }, [])
  return (
    // The profile is the panel's heading, so it stays in place while the channels scroll under it.
    <SidePanelFrame label="Your home" heading={<ProfileCard />}>
      <div className="flex flex-col gap-3 pt-1">
        {content?.collections.map(c => <Channel key={c.name} name={c.name || "Pages"} items={c.items} />)}
      </div>
    </SidePanelFrame>
  )
}
