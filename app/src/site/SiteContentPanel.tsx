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
import { askToOpenBlock, channelsIn, readContent, siteUrl as url, type SiteContent, type SiteItem } from "./source"


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

/** A channel inside a channel, as Are.na shows one among blocks: its name and how many blocks it holds. */
function ChannelTile({ name, count, masonry, onOpen }: { name: string; count: number; masonry?: boolean; onOpen(): void }) {
  return (
    <button type="button" aria-label={`Open ${name}`} onClick={onOpen}
      className={cn(tile, "aspect-[3/4] flex-col items-center justify-center gap-1 p-2 text-center ring-1 ring-border ring-inset hover:bg-accent", masonry ? "mb-1.5 flex w-full break-inside-avoid" : "flex h-full shrink-0")}>
      <span className="line-clamp-3 font-medium break-words">{name}</span>
      <span className="text-small text-muted-foreground">{count === 1 ? "1 block" : `${count} blocks`}</span>
    </button>
  )
}

/**
 * One channel: its name and how many blocks it holds, then what is in it side by side in one row:
 * the channels inside it first, then the blocks filed in none of them. Expanded, it is the only
 * channel shown and fills the panel under the profile, as a masonry that scrolls down.
 */
function Channel({ name, items, inner, expanded, onExpand, onOpenInner }: {
  name: string; items: SiteItem[]; inner: { name: string; items: SiteItem[] }[]
  expanded: boolean; onExpand(on: boolean): void; onOpenInner(name: string): void
}) {
  const loose = items.filter(i => !i.channel)
  const tiles = (masonry?: boolean) => <>
    {inner.map(c => <ChannelTile key={c.name} name={c.name} count={c.items.length} masonry={masonry} onOpen={() => onOpenInner(c.name)} />)}
    {loose.map(item => <Tile key={item.path} item={item} masonry={masonry} />)}
  </>
  return (
    <section aria-label={name} className="flex flex-col gap-2 rounded-lg bg-muted/60 p-2">
      <header className="flex items-center justify-between gap-2 ps-1">
        <h3 className="truncate font-medium">{name}</h3>
        <span className="flex shrink-0 items-center gap-1 text-small text-muted-foreground">
          {items.length === 1 ? "1 block" : `${items.length} blocks`}
          <Button size="icon-xs" variant="ghost" aria-label={expanded ? `Back to all channels` : `Expand ${name}`} aria-pressed={expanded} onClick={() => onExpand(!expanded)}>
            <Icon icon={expanded ? Minimize2Icon : Maximize2Icon} size="xs" />
          </Button>
        </span>
      </header>
      {expanded ? (
        // Two columns in a narrow panel, more as it widens.
        <div className="gap-1.5" style={{ columnWidth: "7.5rem" }}>{tiles(true)}</div>
      ) : (
        <div className="flex h-36 gap-1.5 overflow-x-auto overscroll-x-contain pb-1">{tiles()}</div>
      )}
    </section>
  )
}

export function SiteContentPanel() {
  const [content, setContent] = useState<SiteContent | null>(null)
  /** What is expanded: a channel by name, or a channel inside it as `Photographs/Berlin`. */
  const [expanded, setExpanded] = useState<string | null>(null)
  useEffect(() => { readContent().then(setContent, () => setContent({ site: "", collections: [] })) }, [])
  const [outer, innerName] = expanded?.split("/") ?? []
  const within = innerName ? channelsIn(content?.collections.find(c => c.name === outer)?.items ?? []).find(c => c.name === innerName) : undefined
  return (
    // The profile is the panel's heading, so it stays in place while the channels scroll under it.
    <SidePanelFrame label="Your home" heading={<ProfileCard />}>
      <div className="flex flex-col gap-3 pt-1">
        {within ? (
          // A channel inside a channel, open: where it is, then its blocks.
          <section aria-label={`${outer} / ${within.name}`} className="flex flex-col gap-2 rounded-lg bg-muted/60 p-2">
            <header className="flex items-center justify-between gap-2 ps-1">
              <h3 className="flex min-w-0 items-baseline gap-1.5 font-medium">
                <button type="button" className="shrink-0 text-muted-foreground outline-none hover:text-foreground" onClick={() => setExpanded(outer)}>{outer}</button>
                <span aria-hidden className="text-muted-foreground">/</span>
                <span className="truncate">{within.name}</span>
              </h3>
              <span className="flex shrink-0 items-center gap-1 text-small text-muted-foreground">
                {within.items.length === 1 ? "1 block" : `${within.items.length} blocks`}
                <Button size="icon-xs" variant="ghost" aria-label="Back to all channels" onClick={() => setExpanded(null)}><Icon icon={Minimize2Icon} size="xs" /></Button>
              </span>
            </header>
            <div className="gap-1.5" style={{ columnWidth: "7.5rem" }}>{within.items.map(item => <Tile key={item.path} item={item} masonry />)}</div>
          </section>
        ) : content?.collections.filter(c => !expanded || c.name === expanded).map(c => (
          <Channel key={c.name} name={c.name} items={c.items} inner={channelsIn(c.items)} expanded={c.name === expanded}
            onExpand={on => setExpanded(on ? c.name : null)} onOpenInner={name => setExpanded(`${c.name}/${name}`)} />
        ))}
      </div>
    </SidePanelFrame>
  )
}
