// The side panel beside the Site view (flows/site.md): the person's profile fixed on top, then the site's content as the vault holds it, each
// channel one row of block tiles. It stays for as long as the Site view is open. A tile opens its block over the canvas;
// every tile can be picked up and dragged.
import { useEffect, useState } from "react"
import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, CopyIcon, LayoutGridIcon, ListTreeIcon, Maximize2Icon, Minimize2Icon, PlusIcon } from "lucide-react"
import { notify } from "@/components/ui/notice"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Mark, markColor, MARKS, readMark } from "@/components/ui/mark"
import { Button } from "@/components/ui/button"
import { Icon } from "@/components/ui/icon"
import { cn } from "@/lib/cn"
import { ProfileCard } from "./ProfileView"
import { currentBridge } from "@/data/bridge"
import { AgentMark, agentName, useLiveStatus } from "./AgentStatus"
import { connected } from "./live"
import { CollectionsTree } from "./CollectionsTree"
import { ToolFrame } from "./ToolFrame"
import { BlockCard, ChannelCard, LinkCard, PageCard } from "./Cards"
import { CHANNEL, FILE, ITEM, LINK, TOOL } from "./Board"
import { goTo } from "./nav"
import { SiteFiles } from "./SiteFiles"
import { SidePanelFrame } from "@/workspace/Surface"
import { askToOpenBlock, readTools, TOOLS_CHANGED, type SiteTool, LINKS_CHANGED, NEW_CHANNEL, readLinks, SITE_SAVED, type SiteLink, readProfile, channelsIn, readContent, readOwnChannels, saveOwnChannels, type OwnChannel, type OwnChannels, siteUrl as url, type SiteContent, type SiteItem } from "./source"


/** A card you can press: it settles slightly, as DESIGN.md's motion says, and shows focus as a ring. */
const press = "block rounded-2xl text-left outline-none transition-transform duration-(--ohm-duration-press) ease-(--ohm-ease-out) active:scale-(--ohm-press-scale) focus-visible:ring-2 focus-visible:ring-ring/40"


/**
 * One block: as tall as its channel's row, or, in an expanded channel, as wide as its column. An image or a video keeps its own shape, wide or tall. An article or a project is a 3:4 sheet holding the start of its own writing in miniature.
 */
export function Tile({ item, masonry }: { item: SiteItem; masonry?: boolean }) {
  const picture = item.kind === "image" || item.kind === "video"
  return (
    <button type="button" draggable title={item.title} aria-label={`Open ${item.title}`}
      onClick={() => askToOpenBlock(item.path)}
      onDragStart={e => {
        e.dataTransfer.setData(ITEM, JSON.stringify(item))
        e.dataTransfer.setData("text/plain", item.path)
        e.dataTransfer.effectAllowed = "copy"
      }}
      className={cn(press, picture
        // A picture keeps its own shape: the row's height at its own width, or the column's width at its own height.
        ? masonry ? "mb-2 block w-full break-inside-avoid" : "h-full w-auto shrink-0"
        : masonry ? "mb-2 aspect-[3/4] w-full break-inside-avoid" : "aspect-[3/4] h-full shrink-0")}>
      <BlockCard item={item} natural={picture} />

    </button>
  )
}

/**
 * A channel inside a channel, as a cover of one fixed size: a white block, with the block at the
 * channel's front laid on it as a small picture, and the channel's name and count centred under
 * it. It wears its channel's mark: an edge in that colour and its name written in it; with no
 * mark, a plain line and ink.
 */
/**
 * A web page as a tile, at a computer screen's shape (16:10), the page alone: the live page under a clear button (a drag that holds
 * a live page is refused by the browser, so the button is what is picked up). Opens in the reader;
 * drags onto the canvas as a live page.
 */
/**
 * What is seen under the pointer while a page is dragged: a small plain label. A drag whose picture
 * holds a live page (an iframe) is cancelled by the browser, so the page itself can't be the picture.
 */
function dragLabel(e: React.DragEvent, text: string) {
  const label = document.createElement("div")
  label.textContent = text
  label.style.cssText = "position:fixed;top:-100px;left:0;padding:6px 12px;border-radius:999px;background:var(--ohm-paper);color:var(--ohm-ink);font:500 13px var(--ohm-font-sans);box-shadow:var(--ohm-shade-2, 0 2px 8px rgb(0 0 0/.15))"
  document.body.append(label)
  e.dataTransfer.setDragImage(label, 16, 14)
  setTimeout(() => label.remove())
}

/**
 * How a coding agent on this computer (Claude Code, Codex, …) reaches the site: its own key from
 * `ohm agents add`, and the bridge's /site/mcp. It edits files as saves the person can take back;
 * committing and publishing stay the person's.
 */
function ConnectAgent() {
  const bridge = currentBridge()?.url ?? "http://127.0.0.1:8766"
  const url = `${bridge}/site/mcp`
  const s = useLiveStatus()
  const on = connected(s)
  const agent = s.agents.at(-1)?.agent
  const copy = (text: string) => { void navigator.clipboard.writeText(text); notify({ message: "Copied." }) }
  return (
    <section aria-label="Your coding agent" className="flex flex-col gap-3 rounded-lg bg-muted p-3">
      <h3 className="flex items-center gap-2 font-medium">
        <span className="flex-1">Your coding agent</span>
        <span className="flex items-center gap-1.5 text-small font-normal text-muted-foreground">
          <AgentMark agent={agent ?? "claude-code"} on={on} size={14} />{!s.online ? "ohm serve isn't running" : on ? `${agentName(agent ?? "claude-code")} connected` : "Not connected"}
        </span>
      </h3>
      {/* Claude Code: the ohm plugin brings the connection, the build-tool skill, and hooks that show what it is doing here. */}
      <p className="text-small text-muted-foreground">In Claude Code, install the ohm plugin. It connects Claude Code to your canvas, channels, site and tools, and shows here what it is doing. Give it the key from <span className="font-mono text-[11px]">ohm agents add claude-code</span> when it asks.</p>
      <div className="flex gap-1.5">
        <span className="min-w-0 flex-1 truncate rounded-md bg-card px-2.5 py-2 font-mono text-[11px] shade-1">/plugin install ohm@ohm</span>
        <Button size="icon-sm" variant="secondary" aria-label="Copy the plugin command" onClick={() => copy("/plugin install ohm@ohm")}><Icon icon={CopyIcon} size="sm" /></Button>
      </div>
      {/* Any other agent (Codex, Cursor…): the MCP server alone. It works, without the live presence hooks give. */}
      <p className="text-small text-muted-foreground">Codex, Cursor or another agent: add this MCP server with its own key. Only you publish.</p>
      <div className="flex gap-1.5">
        <span className="min-w-0 flex-1 truncate rounded-md bg-card px-2.5 py-2 font-mono text-[11px] shade-1">{url}</span>
        <Button size="icon-sm" variant="secondary" aria-label="Copy the MCP address" onClick={() => copy(url)}><Icon icon={CopyIcon} size="sm" /></Button>
      </div>
      <p className="rounded-md bg-card px-2.5 py-2 text-small shade-1">Never share your agent's key: it opens your site and canvas.</p>
    </section>
  )
}

/** A kept link as a tile in Artifacts, a screen's shape: opens the page; drags onto the canvas. */
function LinkTile({ link }: { link: SiteLink }) {
  return (
    <button type="button" draggable title={link.url} aria-label={`Open ${link.title}`}
      onClick={() => goTo({ kind: "link", url: link.url, title: link.title })}
      onDragStart={e => { e.dataTransfer.setData(LINK, JSON.stringify(link)); e.dataTransfer.setData("text/uri-list", link.url); e.dataTransfer.effectAllowed = "copy"; dragLabel(e, link.title) }}
      className={cn(press, "relative aspect-[16/10] h-full shrink-0")}>
      <LinkCard link={link} />
      {/* A live page under it takes no clicks here: the tile opens it, or is dragged. */}
      <span aria-hidden className="absolute inset-0" />
    </button>
  )
}

export function PageTile({ path, title, site }: { path: string; title: string; site?: string }) {
  return (
    <div className="relative aspect-[16/10] h-full shrink-0 overflow-hidden rounded-2xl">
      <PageCard src={url(path)} title={title} address={site} live={false} />
      <button type="button" draggable aria-label={`Open ${title}`} title="Drag onto the canvas, or open it"
        onClick={() => goTo({ kind: "page", path })}
        onDragStart={e => {
          e.dataTransfer.setData(FILE, path); e.dataTransfer.setData("text/plain", path); e.dataTransfer.effectAllowed = "copy"
          dragLabel(e, title)
        }}
        className={cn(press, "absolute inset-0")} />
    </div>
  )
}

export function ChannelTile({ name, items, mark, masonry, onOpen, path }: { name: string; items: SiteItem[]; mark?: string; masonry?: boolean; onOpen(): void
  /** Its full name, `Photographs/Berlin`, carried when it is dragged onto the canvas. */
  path?: string }) {
  return (
    <button type="button" aria-label={`Open ${name}`} onClick={onOpen} draggable
      onDragStart={e => { e.dataTransfer.setData(CHANNEL, path ?? name); e.dataTransfer.setData("text/plain", path ?? name); e.dataTransfer.effectAllowed = "copy" }}
      className={cn(press, masonry ? "mb-2 aspect-[3/4] w-full break-inside-avoid" : "aspect-[3/4] h-full shrink-0")}>
      {/* Drawn as the feed draws a channel: its blocks in a grid, not one cover. */}
      <ChannelCard name={name} items={items} mark={mark} view="grid" />
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
        {/* On a section in its own colour the dot is white; on paper it is the mark itself. */}
        <span className="[[data-on-mark]_&]:hidden"><Mark color={mark?.key} edge={mark?.edge} /></span>
        <span aria-hidden className="hidden size-2.5 rounded-full bg-white [[data-on-mark]_&]:block" />
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
function Channel({ shown, dot, color, markOf, expanded, onExpand, onOpenInner, history, onFile, children }: {
  shown: Shown; dot: React.ReactNode; history?: React.ReactNode
  /** Its mark: the section is drawn in that colour, with its words in white. */
  color?: string
  /** The mark a channel inside this one wears: its own, or else this channel's. */
  markOf(inner: string): string
  expanded: boolean; onExpand(on: boolean): void; onOpenInner(name: string): void
  /** File a block here, by its path. Only a channel the person made takes one. */
  onFile?: (path: string) => void
  children?: React.ReactNode
}) {
  const [over, setOver] = useState(false)
  const tiles = (masonry?: boolean) => <>
    {shown.inner.map(c => <ChannelTile key={c.name} name={c.name} path={`${shown.name}/${c.name}`} items={c.items} mark={markOf(c.name)} masonry={masonry} onOpen={() => onOpenInner(c.name)} />)}
    {shown.loose.map(item => <Tile key={item.path} item={item} masonry={masonry} />)}
  </>
  const empty = !shown.inner.length && !shown.loose.length
  return (
    // A channel, by default: grey, its header its dot in its colour, its name and how many (● Writings 8), its tiles below.
    <section aria-label={shown.name} className={cn("flex flex-col gap-2 rounded-lg bg-muted p-2", over && "ring-2 ring-primary/40")}
      onDragOver={e => { if (onFile && e.dataTransfer.types.includes(ITEM)) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; setOver(true) } }}
      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false) }}
      onDrop={e => { setOver(false); const raw = e.dataTransfer.getData(ITEM); if (onFile && raw) { e.preventDefault(); onFile((JSON.parse(raw) as SiteItem).path) } }}>
      <header className="flex items-center justify-between gap-2">
        {/* The channel's header picks up the whole channel, to drop on the canvas. */}
        <h3 draggable title="Drag onto the canvas" className="flex min-w-0 flex-1 cursor-grab items-center gap-1 font-medium"
          onDragStart={e => { e.dataTransfer.setData(CHANNEL, shown.name); e.dataTransfer.setData("text/plain", shown.name); e.dataTransfer.effectAllowed = "copy"; dragLabel(e, shown.name) }}>{history}{dot}
          <span className="truncate">{shown.name}</span>
          <span className="shrink-0 ps-1 font-normal text-muted-foreground tabular-nums">{shown.items.length}</span></h3>
        <span className="flex min-w-0 items-center gap-1 text-small text-muted-foreground">
          <Button size="icon-xs" variant="ghost" aria-label={expanded ? `Back to all channels` : `Expand ${shown.name}`} aria-pressed={expanded} onClick={() => onExpand(!expanded)}>
            <Icon icon={expanded ? Minimize2Icon : Maximize2Icon} size="xs" />
          </Button>
        </span>
      </header>
      {empty ? (
        <p className="px-1 pb-1 text-small text-muted-foreground">{onFile ? "Nothing here yet. Drag a block onto this channel to file it here." : "Nothing here yet."}</p>
      ) : expanded ? (
        // Two columns in a narrow panel, more as it widens.
        <div className="columns-[8.25rem] gap-2">{tiles(true)}</div>
      ) : (
        <div className="-mx-1 flex h-[11.5rem] gap-2 overflow-x-auto overscroll-x-contain px-1 pt-0.5 pb-1.5">{tiles()}</div>
      )}
      {children}
    </section>
  )
}

export function SiteContentPanel({ floating }: {
  /** On the canvas: the profile card floats over it, and opens downward into the rest of the panel. */
  floating?: { open: boolean; onOpen(open: boolean): void
    /** The open panel's width in px, and changing it from its right edge. The card inside keeps its size. */
    width: number; onWidth(width: number): void }
} = {}) {
  const [content, setContent] = useState<SiteContent | null>(null)
  const [own, setOwn] = useState<OwnChannels>({ channels: [], colors: {} })
  /** Where a new channel's name is being typed: at the top (""), or inside the channel named. */
  const [naming, setNaming] = useState<string | null>(null)
  /**
   * Where the panel has been, and where in that it is now: all channels (null), a channel by name,
   * or a channel inside it as `Photographs/Berlin`. Back and forward walk it, as in a browser.
   */
  const [showing, setShowing] = useState<"collections" | "sources" | "mind">("collections")
  const [layout, setLayout] = useState<"tiles" | "tree">("tiles")
  const [links, setLinks] = useState<SiteLink[]>([])
  const [tools, setTools] = useState<SiteTool[]>([])
  useEffect(() => {
    const read = () => { readTools().then(setTools, () => {}) }
    read(); window.addEventListener(TOOLS_CHANGED, read)
    return () => window.removeEventListener(TOOLS_CHANGED, read)
  }, [])
  useEffect(() => {
    const read = () => { readLinks().then(setLinks, () => {}) }
    read()
    window.addEventListener(LINKS_CHANGED, read)
    return () => window.removeEventListener(LINKS_CHANGED, read)
  }, [])
  useEffect(() => {
    const onNew = () => { floating?.onOpen(true); setShowing("collections"); setLayout("tiles"); setTrail({ been: [null], at: 0 }); setNaming("") }
    window.addEventListener(NEW_CHANNEL, onNew)
    return () => window.removeEventListener(NEW_CHANNEL, onNew)
  }, [floating])
  const [trail, setTrail] = useState<{ been: (string | null)[]; at: number }>({ been: [null], at: 0 })
  const expanded = trail.been[trail.at]
  const setExpanded = (to: string | null) => setTrail(t => t.been[t.at] === to ? t : { been: [...t.been.slice(0, t.at + 1), to], at: t.at + 1 })
  const step = (by: -1 | 1) => setTrail(t => ({ ...t, at: Math.max(0, Math.min(t.been.length - 1, t.at + by)) }))
  useEffect(() => {
    const read = () => { readOwnChannels().then(setOwn, () => {}); return readContent().then(setContent, () => setContent({ site: "", collections: [] })) }
    void read()
    readOwnChannels().then(setOwn, () => {})
    // Any save (a picture added, a file changed) is read again, so what was added shows at once.
    window.addEventListener(SITE_SAVED, read)
    return () => window.removeEventListener(SITE_SAVED, read)
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

  const [cardColor, setCardColor] = useState("var(--ohm-mark-navy)")
  useEffect(() => { readProfile().then(p => { if (p.color) setCardColor(p.color) }, () => {}) }, [])
  const body = (<>
      {/* What to show, as pills: your channels (Collections), the places they come from (Sources:
          the site's git folder and its files), or what your agent knows and thinks (Mind). */}
      <div role="tablist" aria-label="Show" className="flex flex-wrap gap-2 pt-1 pb-2">
        {(["collections", "sources", "mind"] as const).map(v => (
          <button key={v} type="button" role="tab" aria-selected={showing === v} onClick={() => setShowing(v)}
            className="h-8 rounded-full bg-muted px-3.5 text-small outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/40 aria-selected:bg-primary aria-selected:text-primary-foreground">
            {v === "collections" ? "Collections" : v === "sources" ? "Sources" : "Mind"}
          </button>
        ))}
        {/* Collections as tiles or as a file tree: the same channels and blocks, two ways to read them. */}
        {showing === "collections" && (
          <span role="radiogroup" aria-label="Show collections as" className="ms-auto flex items-center gap-0.5 rounded-full bg-muted p-0.5">
            {([["tiles", LayoutGridIcon, "Tiles"], ["tree", ListTreeIcon, "File tree"]] as const).map(([v, icon, label]) => (
              <button key={v} type="button" role="radio" aria-checked={layout === v} aria-label={label} title={label} onClick={() => setLayout(v)}
                className="inline-flex size-7 items-center justify-center rounded-full text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 aria-checked:bg-card aria-checked:text-foreground aria-checked:shade-1">
                <Icon icon={icon} size="sm" />
              </button>
            ))}
          </span>
        )}
      </div>
      {showing === "mind" ? <p className="px-1 pt-2 text-small text-muted-foreground">What your agent knows about you and is thinking will show here, as blocks you can read and correct. It isn't connected yet.</p> :
      layout === "tree" && showing === "collections" ? <div className="pt-1"><CollectionsTree content={content} /></div> :
      showing === "sources" ? <div className="flex flex-col gap-3 pt-1">
        {/* Your site itself, as a block: live, and draggable onto the canvas like any other. */}
        <section aria-label="Your site" className="flex flex-col gap-2 rounded-lg bg-muted p-2">
          <h3 className="flex items-center justify-between gap-2 font-medium"><span>Your site</span><span className="text-small font-normal text-muted-foreground">Source · git</span></h3>
          {/* The live preview sits under a clear button: a drag that holds a live page is refused by the
              browser, so what is picked up is the button, and the page stays where it is. */}
          <div className="relative aspect-[4/3] w-full">
            <PageCard src={url("index.html")} title="Home" address={content?.site} live={false} />
            <button type="button" draggable aria-label={`Open ${content?.site || "your site"}`} title="Drag onto the canvas, or open it"
              onClick={() => goTo({ kind: "page", path: "index.html" })}
              onDragStart={e => {
                e.dataTransfer.setData(FILE, "index.html"); e.dataTransfer.setData("text/plain", "index.html"); e.dataTransfer.effectAllowed = "copy"
                dragLabel(e, content?.site || "Home")
              }}
              className="absolute inset-0 rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-ring/40" />
          </div>
        </section>
        <ConnectAgent />
        <section aria-label="Files" className="rounded-lg bg-muted p-2"><SiteFiles content={content} /></section>
      </div> : <div className="flex flex-col gap-3 pt-1">
        {/* Tools: small apps your agent built for you, kept in your home, run sandboxed. A channel like the others. */}
        {!expanded && tools.length > 0 && (
          <section aria-label="Tools" className="flex flex-col gap-2 rounded-lg bg-muted p-2">
            <header className="flex items-center gap-1 font-medium">
              <span aria-hidden className="size-2.5 rounded-full bg-foreground" /><span className="ps-1">Tools</span>
              <span className="ps-1 font-normal text-muted-foreground tabular-nums">{tools.length}</span>
            </header>
            <div className="-mx-1 flex h-[11.5rem] gap-2 overflow-x-auto px-1 pt-0.5 pb-1.5">
              {tools.map(t => (
                <button key={t.name} type="button" draggable title={t.description || t.title} aria-label={`Open ${t.title}`} onClick={() => goTo({ kind: "tool", name: t.name, title: t.title })}
                  onDragStart={e => { e.dataTransfer.setData(TOOL, t.name); e.dataTransfer.setData("text/plain", t.name); e.dataTransfer.effectAllowed = "copy"; dragLabel(e, t.title) }}
                  className={cn(press, "relative flex aspect-[16/11] h-full shrink-0 flex-col overflow-hidden rounded-2xl bg-card text-left shade-2")}>
                  <span className="relative min-h-0 flex-1"><ToolFrame name={t.name} live={false} /></span>
                  <span className="truncate px-2.5 py-1.5 text-small font-medium">{t.title}</span>
                </button>
              ))}
            </div>
          </section>
        )}
        {/* Artifacts: a channel of the things you have made that live as pages (your website first), each a
            live page block, drawn as every channel is: its dot, its name, how many it holds, its row of tiles. */}
        {(!expanded || expanded === "Artifacts") && (
          <section aria-label="Artifacts" className="flex flex-col gap-2 rounded-lg bg-muted p-2">
            <header className="flex items-center justify-between gap-2">
              <h3 draggable title="Drag onto the canvas" className="flex min-w-0 flex-1 cursor-grab items-center gap-1 font-medium"
                onDragStart={e => { e.dataTransfer.setData(CHANNEL, "Artifacts"); e.dataTransfer.setData("text/plain", "Artifacts"); e.dataTransfer.effectAllowed = "copy"; dragLabel(e, "Artifacts") }}>
                <Dot name="Artifacts" color={own.colors["Artifacts"] ?? ""} onPick={color => paint("Artifacts", undefined, color)} />
                <span className="truncate">Artifacts</span>
                <span className="shrink-0 ps-1 font-normal text-muted-foreground tabular-nums">{1 + links.length}</span>
              </h3>
              <span className="flex min-w-0 items-center gap-1 text-small text-muted-foreground">
                <Button size="icon-xs" variant="ghost" aria-label={expanded === "Artifacts" ? "Back to all channels" : "Expand Artifacts"} aria-pressed={expanded === "Artifacts"}
                  onClick={() => setExpanded(expanded === "Artifacts" ? null : "Artifacts")}>
                  <Icon icon={expanded === "Artifacts" ? Minimize2Icon : Maximize2Icon} size="xs" />
                </Button>
              </span>
            </header>
            <div className={expanded === "Artifacts" ? "grid grid-cols-[repeat(auto-fill,8.25rem)] auto-rows-[11rem] gap-2" : "-mx-1 flex h-[11.5rem] gap-2 overflow-x-auto px-1 pt-0.5 pb-1.5"}>
              <PageTile path="index.html" title="Home" site={content?.site} />
              {links.map(l => <LinkTile key={l.id} link={l} />)}
            </div>
          </section>
        )}
        {within ? (
          // A channel inside a channel, open: where it is, then its blocks.
          <section aria-label={`${outer} / ${within.name}`} className="flex flex-col gap-2 rounded-lg bg-muted p-2"
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
              ? <div className="columns-[8.25rem] gap-2">{within.items.map(item => <Tile key={item.path} item={item} masonry />)}</div>
              : <p className="px-1 pb-1 text-small text-muted-foreground">Nothing here yet. Go back, and drag a block onto this channel to file it here.</p>}
            {withinOwn && <Button size="xs" variant="ghost" className={quiet} onClick={() => remove(withinOwn)}>Remove this channel</Button>}
          </section>
        ) : shown.filter(c => !expanded || c.name === expanded).map((c, i) => {
          const mineHere = c.own ? ownOf(c.name) : undefined
          return (
            <Channel key={c.name} shown={c} history={i === 0 ? history : null} expanded={c.name === expanded}
              color={mineHere ? mineHere.color ?? "" : own.colors[c.name] ?? ""}
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
      </div>}
  </>)

  if (floating) return (
    // The card is the panel, folded: open, it extends downward into the pills and channels, one surface
    // floating over the canvas, lifted by a menu's shade. Closed, it is only the card.
    <aside aria-label="Your home" className={cn("absolute z-20 flex max-h-[calc(100%-1.5rem)] flex-col rounded-3xl transition-[background-color,box-shadow] duration-(--ohm-duration-open) ease-(--ohm-ease-out)",
      // Open, a white panel grows around the card; the card itself keeps its size.
      // The panel's padding is taken from its place, so the card sits exactly where it does when folded.
      floating.open ? "top-1 left-1 bg-card p-2 shade-4" : "top-3 left-3 w-[20rem]")}
      style={floating.open ? { width: floating.width } : undefined}>

      <div className="relative w-[20rem] shrink-0">
        <ProfileCard />
        {/* A dropdown at the card's bottom right corner: your home opens down from the card, and folds back. */}
        <button type="button" aria-expanded={floating.open} aria-label={floating.open ? "Fold your home into the card" : "Expand your home"}
          title={floating.open ? "Fold" : "Expand"} onClick={() => floating.onOpen(!floating.open)}
          className="absolute right-3 bottom-3 z-10 inline-flex size-8 items-center justify-center rounded-full bg-white/15 text-white outline-none transition-[background-color,transform] duration-(--ohm-duration-press) hover:bg-white/25 focus-visible:ring-2 focus-visible:ring-white/60 active:scale-(--ohm-press-scale)">
          <Icon icon={ChevronDownIcon} size="sm" className={cn("transition-transform duration-(--ohm-duration-state) ease-(--ohm-ease-out)", floating.open && "rotate-180")} />
        </button>
      </div>
      {/* The right edge: drag it to make the open panel wider, as wide as half the window. */}
      {floating.open && (
        <span role="separator" aria-orientation="vertical" aria-label="Resize your home" title="Drag to widen"
          onPointerDown={e => {
            e.preventDefault()
            const startX = e.clientX, from = floating.width
            const move = (m: PointerEvent) => floating.onWidth(Math.max(336, Math.min(window.innerWidth * 0.5, from + m.clientX - startX)))
            const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up) }
            window.addEventListener("pointermove", move); window.addEventListener("pointerup", up)
          }}
          className="absolute inset-y-6 -right-1.5 z-10 w-3 cursor-ew-resize rounded-full after:absolute after:inset-y-0 after:left-1/2 after:w-0.5 after:-translate-x-1/2 after:rounded-full after:bg-transparent hover:after:bg-border" />
      )}
      {floating.open && <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overscroll-contain px-2 pt-5 pb-3 animate-in fade-in-0 slide-in-from-top-2">{body}</div>}
    </aside>
  )
  return (
    // The profile is the panel's heading, so it stays in place while the channels scroll under it.
    <SidePanelFrame label="Your home" heading={<ProfileCard />}>{body}</SidePanelFrame>
  )
}
