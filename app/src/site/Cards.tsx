// A block and a channel as cards: the one design the side panel and the canvas both use, so a thing
// looks the same wherever it is (docs/plans/information-and-viewer.md). Drawn to ohm-ui's DESIGN.md:
// no edges, lifted by shade, the card radius, Helvetica titles and small muted metadata, a channel's
// colour carried by its Mark and its name rather than by a line. Each card fills the box it is given.
import { LayoutGridIcon, ListIcon, RectangleHorizontalIcon, SquareIcon, type LucideIcon } from "lucide-react"
import { markColor, readMark } from "@/components/ui/mark"
import { cn } from "@/lib/cn"
import { useEffect, useRef, useState } from "react"
import "@/editor/editor.css"
import { MarkdownView } from "@/viewers/MarkdownView"
import { readArticle, siteUrl, type SiteArticle, type SiteItem, type SiteLink } from "./source"
import "@/viewers/markdown.css"

/** The size a card is drawn at unless it is made bigger: the panel's tile, 3:4. */
export const CARD = { w: 132, h: 176 }

const face = "ohm-card relative block size-full overflow-hidden rounded-2xl bg-card shade-2"
const blocks = (n: number) => (n === 1 ? "1 block" : `${n} blocks`)
const isPicture = (item: SiteItem) => item.kind === "image" || item.kind === "video"

/** The picture itself, filling the card; or the writing in miniature, as its first page would look. */
export function BlockCard({ item, className, natural }: { item: SiteItem; className?: string
  /** A picture at its own shape: the card follows the picture rather than cropping it to the box. */
  natural?: boolean }) {
  if (isPicture(item))
    return (
      <span className={cn(face, natural && "block h-auto w-auto", className)}>
        <img src={siteUrl(item.thumb ?? item.path)} alt="" loading="lazy" draggable={false} className={natural ? "block h-full w-auto max-w-none [.break-inside-avoid_&]:h-auto [.break-inside-avoid_&]:w-full" : "size-full object-cover"} />
      </span>
    )
  return <WritingCard item={item} className={className} />
}

/** Each writing's page, read once and kept: tiles of the same writing share it. */
const pages = new Map<string, Promise<SiteArticle>>()
function useArticle(path: string) {
  const [article, setArticle] = useState<SiteArticle | null>(null)
  useEffect(() => {
    let current = true
    if (!pages.has(path)) pages.set(path, readArticle(path).catch(e => { pages.delete(path); throw e }))
    pages.get(path)!.then(a => { if (current) setArticle(a) }, () => {})
    return () => { current = false }
  }, [path])
  return article
}

/** The article reader's page width (ArticleView: max-w-[720px]); a writing's card is that page, scaled. */
export const READER_WIDTH = 720

/**
 * The article reader's page, exactly, at its own width, scaled as a whole to the box it is in: the same
 * line breaks, spacing and type as the reader at every size. Its children are laid out at 720px.
 */
export function ReaderScale({ children, className, live }: { children: React.ReactNode; className?: string; live?: boolean }) {
  const box = useRef<HTMLSpanElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = box.current
    if (!el) return
    const seen = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }))
    seen.observe(el)
    return () => seen.disconnect()
  }, [])
  const scale = size.w ? size.w / READER_WIDTH : 0
  return (
    <span ref={box} className={cn("relative block size-full overflow-hidden", className)}>
      {scale > 0 && (
        <span className={cn("absolute top-0 left-0 flex origin-top-left flex-col", !live && "pointer-events-none")}
          style={{ width: READER_WIDTH, height: size.h / scale, transform: `scale(${scale})` }}>
          {children}
        </span>
      )}
    </span>
  )
}

/** A writing as the reader shows it: the reader's own title, subtitle and writing, at its width, scaled. */
function WritingCard({ item, className }: { item: SiteItem; className?: string }) {
  const article = useArticle(item.path)
  // Pictures are written at the site's own addresses; here they come from the site folder.
  const text = article?.markdown.replace(/(!\[[^\]]*\]\()<?\/(?!site\/)/g, "$1/site/") ?? ""
  return (
    <span className={cn(face, className)}>
      <ReaderScale className="mask-b-from-85%">
        {/* ArticleView's page, class for class: its padding, its title, its line under the title, its prose. */}
        <span className="block w-full px-14 pt-10 pb-40">
          <h1 className="text-h2 font-semibold tracking-tight break-words">{article?.title || item.title}</h1>
          {article?.details && <p className="pt-2 text-small text-muted-foreground">{article.details}</p>}
          <span className="relative mt-6 block">
            {article
              ? <MarkdownView path={item.path} text={text} url={siteUrl} className="ohm-prose ohm-markdown" />
              : <span className="ohm-prose ohm-markdown block"><p>{item.excerpt}</p></span>}
          </span>
        </span>
      </ReaderScale>
    </span>
  )
}

export type ChannelView = "cover" | "grid" | "row" | "list"
export const CHANNEL_VIEWS: { view: ChannelView; label: string; icon: LucideIcon }[] = [
  { view: "cover", label: "Cover", icon: SquareIcon },
  { view: "grid", label: "Grid", icon: LayoutGridIcon },
  { view: "row", label: "Row", icon: RectangleHorizontalIcon },
  { view: "list", label: "List", icon: ListIcon },
]

/** A channel's name line: its name and how many it holds beside it ("collisions 4"), white on its colour. */
function ChannelName({ name, count, mark, center }: { name: string; count: number; mark?: string; center?: boolean }) {
  const worn = readMark(mark)
  return (
    <span className={cn("flex min-w-0 items-center gap-1.5", center && "justify-center")}>
      {/* The dot, always: white on a coloured card, the mark's colour (or ink) on paper. */}
      <span aria-hidden className={cn("size-2 shrink-0 rounded-full", worn ? "bg-white" : "bg-foreground")} />
      <span className={cn("truncate text-small font-semibold", worn && "text-white")}>{name}</span>
      <span className={cn("shrink-0 text-small tabular-nums", worn ? "text-white/70" : "text-muted-foreground")}>{count}</span>
    </span>
  )
}

/** A channel's card: solid in its own colour with white words, or grey with dark words when it has none. No shade. */
const tinted = (mark?: string): React.CSSProperties | undefined => {
  const worn = readMark(mark)
  return worn ? { backgroundColor: markColor(worn.key), boxShadow: "none" } : { backgroundColor: "var(--muted)", boxShadow: "none" }
}

/**
 * A channel as a card, in one of four views:
 *   cover  its front picture with its name under it (the panel's view)
 *   grid   its blocks as tiles, as many as the card has room for
 *   row    its blocks side by side, scrolled sideways
 *   list   its blocks as rows: a small picture and a title
 */
export function ChannelCard({ name, items, mark, view = "cover", onOpenBlock, className, pages = [] }: {
  name: string; items: SiteItem[]; mark?: string; view?: ChannelView
  /** Web pages the channel holds (Artifacts), drawn live before its blocks. */
  pages?: { src: string; title: string }[]
  /** A block inside it, chosen. Only grid, row and list show blocks one by one. */
  onOpenBlock?(item: SiteItem): void
  className?: string
}) {
  const front = items.find(isPicture) ?? items[0]
  const label = name.split("/").at(-1)!
  const count = items.length + pages.length
  if (view === "cover")
    return (
      <span className={cn(face, "flex flex-col gap-1.5 p-1.5", className)} style={tinted(mark)}>
        {/* Its header, as a channel's section has: the dot, the name, how many. Then what it holds, inside. */}
        <span className="px-1.5 pt-1"><ChannelName name={label} count={count} mark={mark} /></span>
        <span className="relative min-h-0 w-full flex-1 overflow-hidden rounded-xl bg-card">
          {!front && pages[0] && <PageCard src={pages[0].src} title={pages[0].title} live={false} className="rounded-xl shadow-none" />}
          {front && (isPicture(front)
            ? <img src={siteUrl(front.thumb ?? front.path)} alt="" loading="lazy" draggable={false} className="size-full object-cover" />
            : <BlockCard item={front} className="rounded-xl shadow-none" />)}
        </span>
      </span>
    )
  const open = (item: SiteItem) => (e: React.MouseEvent) => { if (onOpenBlock) { e.stopPropagation(); onOpenBlock(item) } }
  return (
    <span className={cn(face, "flex flex-col gap-2 p-3", className)} style={tinted(mark)}>
      <ChannelName name={label} count={count} mark={mark} />
      {view === "grid" && (
        <span className="grid min-h-0 flex-1 auto-rows-[4.5rem] grid-cols-[repeat(auto-fill,minmax(3.4rem,1fr))] gap-1.5 overflow-hidden">
          {pages.map(p => <span key={p.src} className="col-span-2 row-span-1 min-w-0"><PageCard src={p.src} title={p.title} live={false} className="rounded-lg shade-1" /></span>)}
          {items.map(i => <span key={i.path} onDoubleClick={open(i)} className="min-w-0"><BlockCard item={i} className="rounded-lg shade-1" /></span>)}
        </span>
      )}
      {view === "row" && (
        <span className="flex min-h-0 flex-1 gap-1.5 overflow-x-auto overscroll-x-contain" onPointerDown={e => e.stopPropagation()}>
          {pages.map(p => <span key={p.src} className="aspect-[16/10] h-full shrink-0"><PageCard src={p.src} title={p.title} live={false} className="rounded-lg shade-1" /></span>)}
          {items.map(i => <span key={i.path} onDoubleClick={open(i)} className="aspect-[3/4] h-full shrink-0"><BlockCard item={i} className="rounded-lg shade-1" /></span>)}
        </span>
      )}
      {view === "list" && (
        <span className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overscroll-contain" onPointerDown={e => e.stopPropagation()}>
          {pages.map(p => (
            <span key={p.src} className="flex min-w-0 items-center gap-2 rounded-md p-1">
              <span className="h-8 w-12 shrink-0"><PageCard src={p.src} title={p.title} live={false} className="rounded-sm shade-1" /></span>
              <span className="truncate text-small">{p.title}</span>
            </span>
          ))}
          {items.map(i => (
            <span key={i.path} onDoubleClick={open(i)} className="flex min-w-0 items-center gap-2 rounded-md p-1 hover:bg-muted">
              <span className="size-8 shrink-0"><BlockCard item={i} className="rounded-sm shade-1" /></span>
              <span className="truncate text-small">{i.title}</span>
            </span>
          ))}
        </span>
      )}
    </span>
  )
}

/** The width a web page is laid out at on a card: a laptop's, so it looks as it does in a browser. */
const PAGE_WIDTH = 1024

/**
 * A web page as a block: the page itself, live, laid out at a laptop's width and scaled as a whole to
 * the card, so it looks as it does in a browser at every size and works as one (links, scrolling, its
 * own scripts). Pure content: nothing drawn around it. `live` false lays a still sheet over it, so the card
 * can be picked up without the page taking the pointer.
 */
export function PageCard({ src, title, address, live = true, className }: {
  src: string; title: string; address?: string; live?: boolean; className?: string
}) {
  const box = useRef<HTMLSpanElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = box.current
    if (!el) return
    const seen = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }))
    seen.observe(el)
    return () => seen.disconnect()
  }, [])
  const scale = size.w ? size.w / PAGE_WIDTH : 0
  return (
    <span className={cn(face, "@container flex flex-col", className)}>
      <span ref={box} className="relative min-h-0 flex-1 overflow-hidden bg-white">
        {scale > 0 && (
          <iframe src={src} title={title} loading="lazy" className="absolute top-0 left-0 origin-top-left border-0"
            style={{ width: PAGE_WIDTH, height: size.h / scale, transform: `scale(${scale})` }} />
        )}
        {!live && <span aria-hidden className="absolute inset-0" />}
      </span>
    </span>
  )
}

/**
 * A page that isn't yours, kept as a link: what it says about itself (its picture, its title, its
 * site), as a card. Open, it shows the page itself.
 */
export function LinkCard({ link, className, live = false }: { link: SiteLink; className?: string
  /** Shown live and usable (links, scrolling): on the canvas once it is chosen. */
  live?: boolean }) {
  // A page whose site lets it be framed is the page itself, from its own address, as your website is:
  // its front page, and further in once chosen. Its scripts stay on its own origin, away from ohm.
  if (link.frameable) return <PageCard src={link.url} title={link.title} live={live} className={className} />
  return (
    <span className={cn(face, "flex flex-col", className)}>
      <span className="relative min-h-0 flex-1 overflow-hidden bg-muted">
        {link.image
          ? <img src={link.image} alt="" loading="lazy" draggable={false} referrerPolicy="no-referrer" className="size-full object-cover" />
          : <span className="flex size-full items-center justify-center p-3 text-center text-small text-muted-foreground">{link.site}</span>}
      </span>
      <span className="flex shrink-0 flex-col gap-0.5 px-3 py-2">
        <span className="line-clamp-2 text-small font-semibold leading-tight">{link.title}</span>
        <span className="truncate text-[11px] text-muted-foreground">{link.site}</span>
      </span>
    </span>
  )
}
