// The side panel beside the Site view (flows/site.md): the person's profile fixed on top, then the site's content as the vault holds it, each
// channel one row of block tiles. It stays for as long as the Site view is open. A tile opens its block over the canvas;
// every tile can be picked up and dragged.
import { useEffect, useState } from "react"
import { ChevronLeftIcon, ChevronRightIcon, Maximize2Icon, Minimize2Icon, PlusIcon } from "lucide-react"
import { notify } from "@/components/ui/notice"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Mark, markColor, MARKS, readMark } from "@/components/ui/mark"
import { Button } from "@/components/ui/button"
import { Icon } from "@/components/ui/icon"
import { cn } from "@/lib/cn"
import { ProfileCard } from "./ProfileView"
import { SidePanelFrame } from "@/workspace/Surface"
import { askToOpenBlock, channelsIn, readContent, readOwnChannels, saveOwnChannels, type OwnChannel, type OwnChannels, siteUrl as url, type SiteContent, type SiteItem } from "./source"


const ITEM = "application/x-ohm-site-item"
const tile = "relative block overflow-hidden [contain:paint] rounded-md bg-background text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/40"

/** What a block looks like as a tile: the picture itself, or a small copy of the writing. */
function Face({ item, fill }: { item: SiteItem; fill: boolean }) {
  const media = fill ? "block h-full w-auto max-w-none" : "block h-auto w-full"
  if (item.kind === "image") return <img src={url(item.thumb ?? item.path)} alt="" loading="lazy" draggable={false} className={media} />
  if (item.kind === "video") return <video src={url(item.thumb ?? item.path)} muted playsInline preload="metadata" draggable={false} className={media} />
  return (
    // The sheet is laid out at twice the tile's width and shown at half size: a small copy of the page, not a label.
    <span aria-hidden className="absolute top-0 left-0 flex h-[200%] w-[200%] origin-top-left scale-50 flex-col gap-2 p-5 text-left">
      <span className="font-medium leading-tight">{item.title}</span>
      <span className="min-h-0 flex-1 overflow-hidden whitespace-pre-line text-small text-muted-foreground mask-b-from-70%">{item.excerpt}</span>
    </span>
  )
}

/**
 * One block: as tall as its channel's row, or, in an expanded channel, as wide as its column. An image or a video keeps its own shape, wide or tall. An article or a project is a 3:4 sheet holding the start of its own writing in miniature.
 */
function Tile({ item, masonry }: { item: SiteItem; masonry?: boolean }) {
  const page = item.kind === "article" || item.kind === "project"
  return (
    <button type="button" draggable title={item.title} aria-label={page ? `Open ${item.title}` : item.title}
      onClick={() => askToOpenBlock(item.path)}
      onDragStart={e => {
        e.dataTransfer.setData(ITEM, JSON.stringify(item))
        e.dataTransfer.setData("text/plain", item.path)
        e.dataTransfer.effectAllowed = "copy"
      }}
      className={cn(tile, masonry ? "mb-1.5 w-full break-inside-avoid" : "h-full shrink-0", page && "aspect-[3/4] hover:bg-accent")}>
      <Face item={item} fill={!masonry} />
    </button>
  )
}

/**
 * A channel inside a channel, as a cover of one fixed size: a white block, with the block at the
 * channel's front laid on it as a small picture, and the channel's name and count centred under
 * it. It wears its channel's mark: an edge in that colour and its name written in it; with no
 * mark, a plain line and ink.
 */
function ChannelTile({ name, items, mark, masonry, onOpen }: { name: string; items: SiteItem[]; mark?: string; masonry?: boolean; onOpen(): void }) {
  const front = items.find(i => i.kind === "image") ?? items[0]
  const worn = readMark(mark)
  const colour = worn ? markColor(worn.key) : undefined
  return (
    <button type="button" aria-label={`Open ${name}`} onClick={onOpen}
      className={cn(tile, "flex flex-col items-center justify-center gap-2 bg-background p-2 hover:bg-accent", masonry ? "mb-1.5 aspect-[3/4] w-full break-inside-avoid" : "h-full w-28 shrink-0")}>
      <span aria-hidden className="relative size-14 shrink-0 overflow-hidden rounded-md bg-muted">
        {front && (front.kind === "image" || front.kind === "video"
          ? <img src={url(front.thumb ?? front.path)} alt="" loading="lazy" draggable={false} className="size-full object-cover" />
          : <Face item={front} fill={false} />)}
      </span>
      <span className="flex max-w-full flex-col items-center gap-0.5 text-center" style={{ color: colour }}>
        <span className="line-clamp-2 font-medium leading-tight break-words">{name}</span>
        <span className="text-small opacity-80">{items.length === 1 ? "1 block" : `${items.length} blocks`}</span>
      </span>
      <span aria-hidden className="absolute inset-0 rounded-md" style={{ boxShadow: `inset 0 0 0 1.5px ${colour ?? "var(--border)"}` }} />
    </button>
  )
}

const swatch = "size-6 rounded-full flex items-center justify-center outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40"

/**
 * A channel's dot: ohm-ui's Mark, filled with one of the eight marks, an edge of it only, or a
 * faint ring when it has none. A click opens the set to choose from.
 */
function Dot({ color, name, onPick }: { color: string; name: string; onPick(color: string): void }) {
  const [open, setOpen] = useState(false)
  const mark = readMark(color)
  const pick = (value: string) => { onPick(value); setOpen(false) }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<button type="button" aria-label={`Mark of ${name}: ${mark ? `${mark.name}${mark.edge ? ", edge" : ""}` : "none"}`} className={cn(swatch, "size-5 shrink-0")} />}>
        <Mark color={mark?.key} edge={mark?.edge} />
      </PopoverTrigger>
      <PopoverContent align="start" className="flex w-auto flex-col gap-1 p-2">
        <div className="flex gap-0.5">{MARKS.map(m => <button key={m.key} type="button" aria-label={m.name} title={m.name} className={swatch} onClick={() => pick(m.key)}><Mark color={m.key} /></button>)}</div>
        <div className="flex gap-0.5">{MARKS.map(m => <button key={m.key} type="button" aria-label={`${m.name}, edge`} title={`${m.name}, edge`} className={swatch} onClick={() => pick(`${m.key}:edge`)}><Mark color={m.key} edge /></button>)}</div>
        <Button size="xs" variant="ghost" className="self-start text-small text-muted-foreground" onClick={() => pick("")}>None</Button>
      </PopoverContent>
    </Popover>
  )
}

/** A name being typed for a new channel. Enter makes it; Escape or leaving it empty gives up. */
function NewChannel({ label, onMake, onCancel }: { label: string; onMake(name: string): void; onCancel(): void }) {
  const [name, setName] = useState("")
  return (
    <form onSubmit={e => { e.preventDefault(); if (name.trim()) onMake(name.trim()); else onCancel() }}>
      <input autoFocus aria-label={label} placeholder={label} value={name} maxLength={80} onChange={e => setName(e.target.value.replace("/", ""))}
        onBlur={() => (name.trim() ? onMake(name.trim()) : onCancel())} onKeyDown={e => { if (e.key === "Escape") { setName(""); onCancel() } }}
        className="w-full rounded-lg bg-muted/60 px-3 py-2 font-medium outline-none placeholder:font-normal placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/40" />
    </form>
  )
}

/** A channel as the panel shows it: its blocks, the channels inside it, and whether the person made it. */
type Shown = { name: string; items: SiteItem[]; inner: { name: string; items: SiteItem[]; own: boolean }[]; loose: SiteItem[]; own: boolean }

/**
 * One channel: its dot, its name and how many blocks it holds, then what is in it side by side in
 * one row: the channels inside it first, then the blocks filed in none of them. Expanded, it is
 * the only channel shown and fills the panel under the profile, as a masonry that scrolls down.
 * A tile dropped on a channel the person made is filed in it.
 */
function Channel({ shown, dot, markOf, expanded, onExpand, onOpenInner, history, onFile, children }: {
  shown: Shown; dot: React.ReactNode; history?: React.ReactNode
  /** The mark a channel inside this one wears: its own, or else this channel's. */
  markOf(inner: string): string
  expanded: boolean; onExpand(on: boolean): void; onOpenInner(name: string): void
  /** File a block here, by its path. Only a channel the person made takes one. */
  onFile?: (path: string) => void
  children?: React.ReactNode
}) {
  const [over, setOver] = useState(false)
  const tiles = (masonry?: boolean) => <>
    {shown.inner.map(c => <ChannelTile key={c.name} name={c.name} items={c.items} mark={markOf(c.name)} masonry={masonry} onOpen={() => onOpenInner(c.name)} />)}
    {shown.loose.map(item => <Tile key={item.path} item={item} masonry={masonry} />)}
  </>
  const empty = !shown.inner.length && !shown.loose.length
  return (
    <section aria-label={shown.name} className={cn("flex flex-col gap-2 rounded-lg bg-muted/60 p-2", over && "ring-2 ring-primary/40")}
      onDragOver={e => { if (onFile && e.dataTransfer.types.includes(ITEM)) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; setOver(true) } }}
      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false) }}
      onDrop={e => { setOver(false); const raw = e.dataTransfer.getData(ITEM); if (onFile && raw) { e.preventDefault(); onFile((JSON.parse(raw) as SiteItem).path) } }}>
      <header className="flex items-center justify-between gap-2">
        <h3 className="flex min-w-0 flex-1 items-center gap-1 font-medium">{history}{dot}<span className="truncate">{shown.name}</span></h3>
        <span className="flex min-w-0 items-center gap-1 text-small text-muted-foreground">
          {/* In a narrow panel the count gives way before the name does. */}
          <span className="truncate">{shown.items.length === 1 ? "1 block" : `${shown.items.length} blocks`}</span>
          <Button size="icon-xs" variant="ghost" aria-label={expanded ? `Back to all channels` : `Expand ${shown.name}`} aria-pressed={expanded} onClick={() => onExpand(!expanded)}>
            <Icon icon={expanded ? Minimize2Icon : Maximize2Icon} size="xs" />
          </Button>
        </span>
      </header>
      {empty ? (
        <p className="px-1 pb-1 text-small text-muted-foreground">{onFile ? "Nothing here yet. Drag a block onto this channel to file it here." : "Nothing here yet."}</p>
      ) : expanded ? (
        // Two columns in a narrow panel, more as it widens.
        <div className="gap-1.5" style={{ columnWidth: "7.5rem" }}>{tiles(true)}</div>
      ) : (
        <div className="flex h-36 gap-1.5 overflow-x-auto overscroll-x-contain pb-1">{tiles()}</div>
      )}
      {children}
    </section>
  )
}

export function SiteContentPanel() {
  const [content, setContent] = useState<SiteContent | null>(null)
  const [own, setOwn] = useState<OwnChannels>({ channels: [], colors: {} })
  /** Where a new channel's name is being typed: at the top (""), or inside the channel named. */
  const [naming, setNaming] = useState<string | null>(null)
  /**
   * Where the panel has been, and where in that it is now: all channels (null), a channel by name,
   * or a channel inside it as `Photographs/Berlin`. Back and forward walk it, as in a browser.
   */
  const [trail, setTrail] = useState<{ been: (string | null)[]; at: number }>({ been: [null], at: 0 })
  const expanded = trail.been[trail.at]
  const setExpanded = (to: string | null) => setTrail(t => t.been[t.at] === to ? t : { been: [...t.been.slice(0, t.at + 1), to], at: t.at + 1 })
  const step = (by: -1 | 1) => setTrail(t => ({ ...t, at: Math.max(0, Math.min(t.been.length - 1, t.at + by)) }))
  useEffect(() => {
    readContent().then(setContent, () => setContent({ site: "", collections: [] }))
    readOwnChannels().then(setOwn, () => {})
  }, [])

  /** Change the person's own channels: shown at once, then kept in their folder. */
  const keep = (next: OwnChannels) => { setOwn(next); saveOwnChannels(next).then(setOwn, e => notify({ message: (e as Error).message, tone: "error" })) }
  const make = (name: string, parent?: string) => {
    setNaming(null)
    const taken = [...(content?.collections.map(c => c.name) ?? []), ...own.channels.filter(c => (c.parent ?? "") === (parent ?? "")).map(c => c.name)]
    if (taken.some(t => t.toLowerCase() === name.toLowerCase())) return notify({ message: `There is a channel called “${name}” here already.`, tone: "error" })
    keep({ ...own, channels: [...own.channels, { name, parent, items: [] }] })
  }
  const file = (channel: OwnChannel, path: string) => keep({ ...own, channels: own.channels.map(c => c === channel ? { ...c, items: [...new Set([...c.items, path])] } : c) })
  const remove = (channel: OwnChannel) => { keep({ ...own, channels: own.channels.filter(c => c !== channel && c.parent !== channel.name) }); setExpanded(channel.parent ?? null) }
  const paint = (name: string, channel: OwnChannel | undefined, color: string) =>
    keep(channel ? { ...own, channels: own.channels.map(c => c === channel ? { ...c, color } : c) } : { ...own, colors: { ...own.colors, [name]: color } })

  // Every channel the panel shows: the site's own three, then the ones the person made.
  const all = new Map((content?.collections ?? []).flatMap(c => c.items).map(i => [i.path, i]))
  const blocks = (c: OwnChannel) => c.items.map(p => all.get(p)).filter((i): i is SiteItem => !!i)
  const made = (parent: string) => own.channels.filter(c => (c.parent ?? "") === parent).map(c => ({ name: c.name, items: blocks(c), own: true }))
  const shown: Shown[] = [
    ...(content?.collections ?? []).map(c => ({ name: c.name, items: c.items, inner: [...channelsIn(c.items).map(i => ({ ...i, own: false })), ...made(c.name)], loose: c.items.filter(i => !i.channel), own: false })),
    ...own.channels.filter(c => !c.parent).map(c => ({ name: c.name, items: blocks(c), inner: made(c.name), loose: blocks(c), own: true })),
  ]
  const ownOf = (name: string, parent?: string) => own.channels.find(c => c.name === name && (c.parent ?? "") === (parent ?? ""))

  const [outer, innerName] = expanded?.split("/") ?? []
  const within = innerName ? shown.find(c => c.name === outer)?.inner.find(c => c.name === innerName) : undefined
  // Back and forward, small, at the head of the line that says where the panel is. Only inside a channel.
  const history = expanded && (
    <span className="-ms-1 flex shrink-0 items-center text-muted-foreground">
      <button type="button" aria-label="Back" disabled={trail.at === 0} onClick={() => step(-1)} className="rounded-md p-0.5 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-30"><Icon icon={ChevronLeftIcon} size="xs" /></button>
      <button type="button" aria-label="Forward" disabled={trail.at === trail.been.length - 1} onClick={() => step(1)} className="rounded-md p-0.5 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-30"><Icon icon={ChevronRightIcon} size="xs" /></button>
    </span>
  )
  const quiet = "self-start text-small text-muted-foreground"
  const withinOwn = within?.own ? ownOf(within.name, outer) : undefined

  return (
    // The profile is the panel's heading, so it stays in place while the channels scroll under it.
    <SidePanelFrame label="Your home" heading={<ProfileCard />}>
      <div className="flex flex-col gap-3 pt-1">
        {within ? (
          // A channel inside a channel, open: where it is, then its blocks.
          <section aria-label={`${outer} / ${within.name}`} className="flex flex-col gap-2 rounded-lg bg-muted/60 p-2"
            onDragOver={e => { if (withinOwn && e.dataTransfer.types.includes(ITEM)) { e.preventDefault(); e.dataTransfer.dropEffect = "copy" } }}
            onDrop={e => { const raw = e.dataTransfer.getData(ITEM); if (withinOwn && raw) { e.preventDefault(); file(withinOwn, (JSON.parse(raw) as SiteItem).path) } }}>
            <header className="flex items-center justify-between gap-2">
              <h3 className="flex min-w-0 items-center gap-1 font-medium">
                {history}
                <Dot name={within.name} color={withinOwn ? withinOwn.color ?? "" : own.colors[`${outer}/${within.name}`] ?? ""} onPick={color => paint(`${outer}/${within.name}`, withinOwn, color)} />
                <button type="button" className="shrink-0 text-muted-foreground outline-none hover:text-foreground" onClick={() => setExpanded(outer)}>{outer}</button>
                <span aria-hidden className="text-muted-foreground">/</span>
                <span className="truncate">{within.name}</span>
              </h3>
              <span className="flex shrink-0 items-center gap-1 text-small text-muted-foreground">
                {within.items.length === 1 ? "1 block" : `${within.items.length} blocks`}
                <Button size="icon-xs" variant="ghost" aria-label="Back to all channels" onClick={() => setExpanded(null)}><Icon icon={Minimize2Icon} size="xs" /></Button>
              </span>
            </header>
            {within.items.length
              ? <div className="gap-1.5" style={{ columnWidth: "7.5rem" }}>{within.items.map(item => <Tile key={item.path} item={item} masonry />)}</div>
              : <p className="px-1 pb-1 text-small text-muted-foreground">Nothing here yet. Go back, and drag a block onto this channel to file it here.</p>}
            {withinOwn && <Button size="xs" variant="ghost" className={quiet} onClick={() => remove(withinOwn)}>Remove this channel</Button>}
          </section>
        ) : shown.filter(c => !expanded || c.name === expanded).map((c, i) => {
          const mineHere = c.own ? ownOf(c.name) : undefined
          return (
            <Channel key={c.name} shown={c} history={i === 0 ? history : null} expanded={c.name === expanded}
              dot={<Dot name={c.name} color={mineHere ? mineHere.color ?? "" : own.colors[c.name] ?? ""} onPick={color => paint(c.name, mineHere, color)} />}
              markOf={inner => ownOf(inner, c.name)?.color || own.colors[`${c.name}/${inner}`] || (mineHere ? mineHere.color ?? "" : own.colors[c.name] ?? "")}
              onExpand={on => setExpanded(on ? c.name : null)} onOpenInner={name => setExpanded(`${c.name}/${name}`)}
              onFile={mineHere ? path => file(mineHere, path) : undefined}>
              {c.name === expanded && (naming === c.name
                ? <NewChannel label={`New channel in ${c.name}`} onMake={name => make(name, c.name)} onCancel={() => setNaming(null)} />
                : <span className="flex gap-1">
                    <Button size="xs" variant="ghost" className={quiet} onClick={() => setNaming(c.name)}><Icon icon={PlusIcon} size="xs" />New channel here</Button>
                    {mineHere && <Button size="xs" variant="ghost" className={quiet} onClick={() => remove(mineHere)}>Remove this channel</Button>}
                  </span>)}
            </Channel>
          )
        })}
        {!expanded && (naming === ""
          ? <NewChannel label="New channel" onMake={name => make(name)} onCancel={() => setNaming(null)} />
          : <Button size="sm" variant="ghost" className={quiet} onClick={() => setNaming("")}><Icon icon={PlusIcon} size="xs" />New channel</Button>)}
      </div>
    </SidePanelFrame>
  )
}
