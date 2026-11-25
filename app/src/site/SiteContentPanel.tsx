// The side panel beside the Site view (flows/site.md): the person's profile fixed on top, then the site's content as the vault holds it, each
// channel one row of block tiles. It stays for as long as the Site view is open. A tile opens its block over the canvas;
// every tile can be picked up and dragged.
import { useEffect, useState } from "react"
import { ChevronLeftIcon, ChevronRightIcon, Maximize2Icon, Minimize2Icon } from "lucide-react"
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

/**
 * A channel inside a channel, as a cover: what is at its front, blurred and dimmed, with its name
 * and how many blocks it holds written over it.
 */
function ChannelTile({ name, items, masonry, onOpen }: { name: string; items: SiteItem[]; masonry?: boolean; onOpen(): void }) {
  const front = items.find(i => i.thumb) ?? items[0]
  return (
    <button type="button" aria-label={`Open ${name}`} onClick={onOpen}
      className={cn(tile, "group/cover aspect-[3/4]", masonry ? "mb-1.5 w-full break-inside-avoid" : "h-full shrink-0")}>
      {front?.thumb && front.kind === "image" ? (
        <img src={url(front.thumb)} alt="" loading="lazy" draggable={false} className="absolute inset-0 size-full scale-125 object-cover blur-sm" />
      ) : (
        <span aria-hidden className="absolute inset-0 flex scale-110 flex-col gap-1 p-2 text-left text-small leading-tight blur-[2px]">
          <span className="font-medium">{front?.title}</span>
          <span className="text-muted-foreground">{front?.excerpt}</span>
        </span>
      )}
      <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/45 p-2 text-center text-white transition-colors group-hover/cover:bg-black/60">
        <span className="line-clamp-3 font-medium break-words">{name}</span>
        <span className="text-small opacity-80">{items.length === 1 ? "1 block" : `${items.length} blocks`}</span>
      </span>
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
    {inner.map(c => <ChannelTile key={c.name} name={c.name} items={c.items} masonry={masonry} onOpen={() => onOpenInner(c.name)} />)}
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
  /**
   * Where the panel has been, and where in that it is now: all channels (null), a channel by name,
   * or a channel inside it as `Photographs/Berlin`. Back and forward walk it, as in a browser.
   */
  const [trail, setTrail] = useState<{ been: (string | null)[]; at: number }>({ been: [null], at: 0 })
  const expanded = trail.been[trail.at]
  const setExpanded = (to: string | null) => setTrail(t => t.been[t.at] === to ? t : { been: [...t.been.slice(0, t.at + 1), to], at: t.at + 1 })
  const step = (by: -1 | 1) => setTrail(t => ({ ...t, at: Math.max(0, Math.min(t.been.length - 1, t.at + by)) }))
  useEffect(() => { readContent().then(setContent, () => setContent({ site: "", collections: [] })) }, [])
  const [outer, innerName] = expanded?.split("/") ?? []
  const within = innerName ? channelsIn(content?.collections.find(c => c.name === outer)?.items ?? []).find(c => c.name === innerName) : undefined
  return (
    // The profile is the panel's heading, so it stays in place while the channels scroll under it.
    <SidePanelFrame label="Your home" heading={<ProfileCard />}>
      <div className="flex flex-col gap-3 pt-1">
        {trail.been.length > 1 && (
          <nav aria-label="Channel history" className="flex items-center gap-0.5">
            <Button size="icon-xs" variant="ghost" aria-label="Back" disabled={trail.at === 0} onClick={() => step(-1)}><Icon icon={ChevronLeftIcon} size="xs" /></Button>
            <Button size="icon-xs" variant="ghost" aria-label="Forward" disabled={trail.at === trail.been.length - 1} onClick={() => step(1)}><Icon icon={ChevronRightIcon} size="xs" /></Button>
            <span className="truncate ps-1 text-small text-muted-foreground">{expanded ? expanded.replace("/", " / ") : "All channels"}</span>
          </nav>
        )}
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
