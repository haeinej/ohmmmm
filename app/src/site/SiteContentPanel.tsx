// The side panel beside the Site view (flows/site.md): the site's content as the vault holds it, each
// channel one row of block tiles. It stays for as long as the Site view is open. A tile opens its block over the canvas;
// every tile can be picked up and dragged.
import { useEffect, useState } from "react"
import { cn } from "@/lib/cn"
import { panelTitle, SidePanelFrame } from "@/workspace/Surface"
import { shortTitle } from "./BlockView"
import { askToOpenBlock, readContent, siteUrl as url, type SiteContent, type SiteItem } from "./source"


const tile = "relative block h-full shrink-0 overflow-hidden rounded-md bg-background text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/40"

/**
 * One block, as tall as its channel's row. An image or a video keeps its own shape, wide or tall. A page is a 3:4 sheet holding the start of its own writing in miniature.
 */
function Tile({ item }: { item: SiteItem }) {
  const page = item.kind === "page"
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
          <span className="font-medium leading-tight">{shortTitle(item.title)}</span>
          <span className="min-h-0 flex-1 overflow-hidden whitespace-pre-line text-small text-muted-foreground mask-b-from-70%">{item.excerpt}</span>
        </span>
      )}
    </button>
  )
}

/** One channel is one row: its name and how many blocks it holds, then its blocks side by side. */
function Channel({ name, items }: { name: string; items: SiteItem[] }) {
  return (
    <section aria-label={name} className="flex flex-col gap-2 rounded-lg bg-muted/60 p-2">
      <header className="flex items-baseline justify-between gap-2 px-1 pt-1">
        <h3 className="truncate font-medium">{name}</h3>
        <span className="shrink-0 text-small text-muted-foreground">{items.length === 1 ? "1 block" : `${items.length} blocks`}</span>
      </header>
      <div className="flex h-36 gap-1.5 overflow-x-auto overscroll-x-contain pb-1">
        {items.map(item => <Tile key={item.path} item={item} />)}
      </div>
    </section>
  )
}

export function SiteContentPanel() {
  const [content, setContent] = useState<SiteContent | null>(null)
  useEffect(() => { readContent().then(setContent, () => setContent({ site: "", collections: [] })) }, [])
  return (
    <SidePanelFrame label="Site content" heading={<h2 className={cn(panelTitle, "truncate px-1")}>{content?.site || "Your site"}</h2>}>
      <div className="flex flex-col gap-3 pt-1">
        {content?.collections.map(c => <Channel key={c.name} name={c.name || "Pages"} items={c.items} />)}
      </div>
    </SidePanelFrame>
  )
}
