// The feed (app/flows/feed.md, docs/plans/units.md step 6): your blocks worth seeing, newest first, laid
// out on an endless plane like the site's canvas (site/Board.tsx): drag or scroll to move around, ⌘-scroll
// or pinch to zoom, and more comes as you go down. It takes the whole page; there is no side panel beside
// it. Each tile is the card the canvas already uses (site/Cards.tsx): a picture as itself, a writing as its
// first page in miniature, and under it its title and who made it. A tile opens what it shows. What it
// shows follows View as: a friend sees public and friends blocks, anyone public ones.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import type { LucideIcon } from "lucide-react"
import { ExternalLinkIcon, GlobeIcon, HeartIcon, LockIcon, MessageCircleIcon, RefreshCwIcon, UsersIcon, XIcon } from "lucide-react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Icon } from "@/components/ui/icon"
import { bridgeFetch } from "@/data/bridge"
import { docOfUnit, folderOf, readFeed, readLevel, type Unit } from "@/data/units"
import { blueskyUrl, readDiscover, readLive, type NetPost } from "@/data/network"
import { titleOf } from "@/data/workspace-data"
import { cn } from "@/lib/cn"
import { BlockCard, ChannelCard, LinkCard, PageCard, ReaderScale } from "@/site/Cards"
import { ToolFrame } from "@/site/ToolFrame"
import { ago } from "@/site/SitePublish"
import { MarkdownView } from "@/viewers/MarkdownView"
import { siteUrl } from "@/site/source"
import "@/editor/editor.css"
import "@/viewers/markdown.css"
import { me, report, useWorkspace } from "./store"
import { Button } from "@/components/ui/button"
import { notify } from "@/components/ui/notice"
import { PageEditor } from "@/editor/PageEditor"
import { ArticleView } from "@/site/ArticleView"
import { pictureUrl, readContent, readLinks, readOwnChannels, readProfile, readTools, saveChange, type Change, type SiteContent, type SiteItem, type SiteLink, type SiteProfile, type SiteTool } from "@/site/source"
import { IdentityCard } from "@/components/ui/identity-card"
import { ProfileView } from "@/site/ProfileView"
import { unitPlace } from "@/data/units"

const SEEN_BY: Record<Unit["visibility"], { label: string; icon: LucideIcon }> = {
  private: { label: "Only you", icon: LockIcon },
  friends: { label: "Friends", icon: UsersIcon },
  public: { label: "Everyone", icon: GlobeIcon },
}
// The tiles' face, as site/Cards.tsx draws it: no edges, lifted by shade, the card radius.
const face = "ohm-card relative block w-full overflow-hidden rounded-2xl bg-card shade-2"

/**
 * Who made it, as the tile says it: you, by your name. What your coding agent made for you is yours too,
 * so it is shown as yours. The name is your profile's (FeedView reads it), never a handle.
 */
let you = { name: "", picture: "" }
const authorOf = (_unit?: Unit) => ({ name: you.name || me.name, picture: you.picture })

/**
 * A cover's address the page can show. A site file comes through the bridge, so it shows whether or not
 * the site's worker runs; read once and kept, as tiles of one picture share it.
 */
const pictures = new Map<string, Promise<string>>()
function useCover(cover?: string) {
  const [src, setSrc] = useState<string | null>(cover && /^https?:\/\//i.test(cover) ? cover : null)
  useEffect(() => {
    if (!cover?.startsWith("site:")) { setSrc(cover && /^https?:\/\//i.test(cover) ? cover : null); return }
    const path = cover.slice(5)
    let current = true
    if (!pictures.has(path)) {
      pictures.set(path, bridgeFetch(`/site/file/${path.split("/").map(encodeURIComponent).join("/")}`)
        .then(r => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
        .then(blob => URL.createObjectURL(blob))
        .catch(e => { pictures.delete(path); throw e }))
    }
    pictures.get(path)!.then(url => { if (current) setSrc(url) }, () => { if (current) setSrc(null) })
    return () => { current = false }
  }, [cover])
  return src
}

/** A block's first page, as the reader shows writing, in miniature: the same card a writing gets. */
function BlockPage({ unit }: { unit: Unit }) {
  const doc = docOfUnit(unit)
  const title = doc ? titleOf(doc) : unit.title || "Untitled block"
  return (
    <span className={cn(face, "aspect-3/4")}>
      <ReaderScale className="mask-b-from-85%">
        <span className="block w-full px-14 pt-10 pb-40">
          <h1 className="text-h2 font-semibold tracking-tight break-words">{title}</h1>
          <span className="relative mt-6 block">
            {doc?.body
              ? <MarkdownView path={unit.path} text={doc.body} url={siteUrl} className="ohm-prose ohm-markdown" />
              : <span className="ohm-prose ohm-markdown block"><p>{unit.excerpt}</p></span>}
          </span>
        </span>
      </ReaderScale>
    </span>
  )
}

/** The tile itself: a cover as a picture at its own shape, a site page as its writing, a block as its page. */
/** A writing or a project of the site, read as writing; every other page is a page. */
const isWriting = (path: string) => /^(writings|projects)\/[^/]+\/(?:[^/]+\/)?index\.html?$|\.(md|mdx|markdown)$/i.test(path) && !/^(writings|projects)\/index\.html?$/i.test(path)

function Face({ unit }: { unit: Unit }) {
  const cover = useCover(unit.cover)
  if (unit.type === "channel") return <ChannelFace unit={unit} />
  // A short post's card is its words, as on Bluesky: all of them, with links, mentions and tags marked.
  if (unit.kind === "short") return <span className={cn(face, "p-4 text-body leading-snug break-words whitespace-pre-wrap")}><Faceted text={unit.excerpt ?? ""} /></span>
  // A tool built for you is shown running, as the canvas shows it; it can't be used from its tile.
  if (unit.kind === "tool" && unit.id) return <span className={cn(face, "aspect-3/4")}><ToolFrame name={unit.id} live={false} className="pointer-events-none size-full" /></span>
  // A page of the site: a writing or a project is its text, as the reader shows it; any other page (the
  // home page, a section's index) is the page itself, live in a frame, as your Artifacts channel shows it.
  if (unit.root === "site" && unit.kind === "page") {
    const path = unit.path.replace(/^site\//, "")
    if (!isWriting(path)) return <span className={cn(face, "aspect-16/10")}><PageCard src={siteUrl(path)} title={unit.title ?? path} live={false} className="rounded-none shadow-none" /></span>
    return <BlockCard className="aspect-3/4 h-auto" item={{ kind: "article", path, title: unit.title ?? path, modified: unit.updated ?? "", usedIn: [] }} />
  }
  // A kept website that lets itself be framed is shown live, as the site's canvas shows it.
  if (unit.kind === "link" && unit.frameable && unit.origin) return <span className={cn(face, "aspect-16/10")}><PageCard src={unit.origin} title={unit.title ?? unit.origin} live={false} className="rounded-none shadow-none" /></span>
  if (cover) return <span className={face}><img src={cover} alt="" draggable={false} className="block h-auto w-full" /></span>
  // A kept website with no picture of its own: its name and what it says about itself, as a card.
  if (unit.kind === "link") return (
    <span className={cn(face, "flex aspect-4/3 flex-col justify-end gap-1 p-4")}>
      <span className="text-small text-muted-foreground">{unit.origin && URL.canParse(unit.origin) ? new URL(unit.origin).hostname.replace(/^www\./, "") : ""}</span>
      <span className="line-clamp-3 text-body text-muted-foreground">{unit.excerpt}</span>
    </span>
  )
  return <BlockPage unit={unit} />
}

// What Bluesky makes a facet of: an address, an @handle, a #tag.
const FACET = /(https?:\/\/[^\s]+|@[a-z0-9][a-z0-9.-]*\.[a-z]{2,}|#[\p{L}\p{N}_]+)/giu

/** A short post's text with its links, mentions and tags marked, as Bluesky shows them. */
function Faceted({ text }: { text: string }) {
  // Marked by weight and a line, not a colour: in ohm, colour means done or failed.
  return <>{text.split(FACET).map((part, i) => (i % 2 ? <span key={i} className="font-medium underline decoration-foreground/30 underline-offset-2">{part}</span> : part))}</>
}

/** A channel as a block: its name and how many it holds, then its newest titles, as a card. */
function ChannelFace({ unit }: { unit: Unit }) {
  return (
    <span className={cn(face, "flex aspect-4/3 flex-col gap-2 p-4")}>
      <span className="flex min-w-0 items-center gap-1.5">
        <span aria-hidden className="size-2 shrink-0 rounded-full bg-foreground" />
        <span className="truncate text-small font-semibold">{unit.title}</span>
        <span className="shrink-0 text-small text-muted-foreground tabular-nums">{unit.count ?? ""}</span>
      </span>
      {unit.excerpt && (
        <span className="flex min-h-0 flex-col gap-1 overflow-hidden">
          {unit.excerpt.split(" · ").map((name, i) => <span key={i} className="truncate rounded-md bg-muted px-2 py-1 text-small">{name}</span>)}
        </span>
      )}
    </span>
  )
}

/** You, as a block: your identity card, the first tile of the feed. It opens your profile. */
function ProfileTile({ profile, onOpen }: { profile: SiteProfile; onOpen(): void }) {
  return (
    <article>
      <FixedScale width={CARD_WIDTH}>
        <IdentityCard className="w-full" finish="matt" color={profile.color || null} name={profile.name || me.name}
          address={profile.handle || null} did={profile.did || null} wallet={profile.wallet || null}
          avatarSrc={profile.image ? pictureUrl(profile.image) : null} onOpen={onOpen} />
      </FixedScale>
    </article>
  )
}

// The identity card is drawn at one size, as your profile shows it, and only scaled to fit its column:
// its name, address and wallet keep their places whatever the column's width.
const CARD_WIDTH = 400
function FixedScale({ width, children }: { width: number; children: React.ReactNode }) {
  const outer = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const [fit, setFit] = useState({ scale: 1, height: 0 })
  // Measured before the page is painted, and again whenever the room or the content changes size, so
  // the scaled page never shows at the wrong size first.
  useLayoutEffect(() => {
    const measure = () => {
      const room = outer.current?.clientWidth ?? width
      const scale = room / width
      setFit({ scale, height: (inner.current?.offsetHeight ?? 0) * scale })
    }
    measure()
    const seen = new ResizeObserver(measure)
    if (outer.current) seen.observe(outer.current)
    if (inner.current) seen.observe(inner.current)
    return () => seen.disconnect()
  }, [width])
  return (
    <div ref={outer} className="relative w-full" style={{ height: fit.height || undefined }}>
      <div ref={inner} className="absolute top-0 left-0 origin-top-left" style={{ width, transform: `scale(${fit.scale})` }}>{children}</div>
    </div>
  )
}

/**
 * Every post of the feed, framed the same way, as on Twitter: the picture beside it, the name in bold and
 * when on top, then what was posted (words, a writing, a picture, a channel). Yours and everyone's alike.
 */
function PostFrame({ name, picture, when, seen, children }: {
  name: string; picture?: string | null; when?: string; seen?: Unit["visibility"]; children: React.ReactNode
}) {
  const mark = seen ? SEEN_BY[seen] : null
  return (
    <div className="flex w-full gap-2.5 px-1 py-1.5 text-left">
      <Avatar className="size-9 flex-none">
        {picture && <AvatarImage src={picture} alt="" referrerPolicy="no-referrer" />}
        <AvatarFallback className="bg-muted text-small">{name.slice(0, 1)}</AvatarFallback>
      </Avatar>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className="truncate text-body font-semibold">{name}</span>
          {when && <span className="flex-none text-small text-muted-foreground">{ago(when)}</span>}
          {mark && <Icon icon={mark.icon} size="xs" aria-label={mark.label} className="ms-auto flex-none self-center text-muted-foreground" />}
        </span>
        {children}
      </div>
    </div>
  )
}

/** One tile of the masonry: the block, then its title, then who made it, when, and who sees it. */
export function FeedTile({ unit, onOpen }: { unit: Unit; onOpen(): void }) {
  const author = authorOf(unit)
  if (unit.kind === "short") return <PostLayout name={author.name} picture={author.picture} when={unit.updated} text={unit.excerpt ?? ""} onOpen={onOpen} />
  // A block or an agent's file is named as everywhere in the app; anything else by its own title.
  const doc = docOfUnit(unit)
  const title = doc ? titleOf(doc) : unit.title || unit.path.split("/").at(-1)
  return (
    <article>
      <button type="button" onClick={onOpen} aria-label={title} className="group block w-full rounded-2xl text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
        <PostFrame name={author.name} picture={author.picture} when={unit.updated} seen={unit.visibility}>
          <span className="mt-1 block"><Face unit={unit} /></span>
        </PostFrame>
      </button>
    </article>
  )
}

/** A save to a site page from the reader: the same one the Site view makes, kept until you publish. */
async function savePage(page: string, change: Change) {
  await saveChange(page, change)
  notify({ message: `Saved to ${page}. It is on your computer only until you publish your site.` })
  return { page, saved: true }
}

/** What a tile opens to, in the popup: the editor, the reader, the picture, the tool or the page. */
function Opened({ unit, onOpen, onClose }: { unit: Unit; onOpen(unit: Unit): void; onClose(): void }) {
  if (unit.type === "channel") return <ChannelOpened unit={unit} onOpen={onOpen} />
  if (unit.type === "profile") return <div className="min-h-0 flex-1 overflow-y-auto"><ProfileView onClose={onClose} /></div>
  return <OpenedBlock unit={unit} />
}

/** A channel opened: its blocks and the channels in it, as tiles; each opens in this same popup. */
function ChannelOpened({ unit, onOpen }: { unit: Unit; onOpen(unit: Unit): void }) {
  const [inside, setInside] = useState<Unit[] | null>(null)
  useEffect(() => {
    let current = true
    void report(readLevel(folderOf(unit)).then(level => {
      if (current) setInside([...level.folders.flatMap(f => (f.unit ? [{ ...f.unit, count: f.count }] : [])), ...level.units])
    }))
    return () => { current = false }
  }, [unit])
  if (!inside) return <div className="flex-1" aria-busy />
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-8">
      <h2 className="pb-5 text-(length:--ohm-type-title-size) font-semibold">{unit.title} <span className="text-muted-foreground">{unit.count}</span></h2>
      <div className="columns-[200px] gap-5">
        {inside.map(each => <div key={each.key} className="mb-5 break-inside-avoid"><FeedTile unit={each} onOpen={() => onOpen(each)} /></div>)}
      </div>
    </div>
  )
}

/** A block, a site page, a picture, a tool or a kept website, opened. */
function OpenedBlock({ unit }: { unit: Unit }) {
  const doc = docOfUnit(unit)
  const cover = useCover(unit.kind === "image" ? unit.cover : undefined)
  if (doc) return <PageEditor key={doc.id} doc={doc} />
  if (unit.root === "site" && unit.kind === "page") {
    const path = unit.path.replace(/^site\//, "")
    return <div className="min-h-0 flex-1 overflow-y-auto"><ArticleView reading item={{ kind: "article", path, title: unit.title ?? path, modified: unit.updated ?? "", usedIn: [] }} channel={unitPlace(unit)} onSave={savePage} /></div>
  }
  if (unit.kind === "tool" && unit.id) return <ToolFrame name={unit.id} className="relative min-h-0 flex-1" />
  if (unit.kind === "link" && unit.origin)
    return <iframe title={unit.title ?? unit.origin} src={unit.origin} sandbox="allow-scripts allow-same-origin allow-forms" referrerPolicy="no-referrer" className="min-h-0 flex-1 border-0 bg-white" />
  if (cover) return <div className="flex min-h-0 flex-1 items-center justify-center bg-muted p-6"><img src={cover} alt={unit.title ?? ""} className="max-h-full max-w-full rounded-lg object-contain" /></div>
  return <Empty className="flex-1"><EmptyHeader><EmptyTitle>{unit.title}</EmptyTitle><EmptyDescription>It is in your home at {unit.path}.</EmptyDescription></EmptyHeader></Empty>
}

/** A tile opened over the feed, in the window the site's canvas opens a block in; the feed stays beneath. */
function Popup({ unit, onOpen, onClose }: { unit: Unit; onOpen(unit: Unit): void; onClose(): void }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape" && !(e.target as HTMLElement)?.closest?.("[contenteditable=true], textarea, input")) onClose() }
    addEventListener("keydown", key)
    return () => removeEventListener("keydown", key)
  }, [onClose])
  return (
    <div role="dialog" aria-label={unit.title ?? unit.path} className="absolute inset-0 z-30 flex bg-black/15 p-3 animate-in fade-in-0"
      onPointerDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="relative mx-auto flex h-full w-full max-w-4xl flex-col overflow-hidden rounded-3xl bg-card shade-5">
        <header className="flex h-12 shrink-0 items-center gap-2 ps-5 pe-3">
          <span className="flex-1" />
          {unit.kind === "link" && unit.origin && <Button size="icon-sm" variant="ghost" aria-label="Open the page in a new tab" onClick={() => window.open(unit.origin, "_blank", "noopener")}><Icon icon={ExternalLinkIcon} /></Button>}
          <Button size="icon-sm" variant="ghost" aria-label="Close" onClick={onClose}><Icon icon={XIcon} /></Button>
        </header>
        <Opened unit={unit} onOpen={onOpen} onClose={onClose} />
      </div>
    </div>
  )
}

// ---- Posts from the network: other people's, shown as theirs ----

/**
 * A post as people read one on Twitter or Bluesky: the picture beside it, the name in bold and when, then
 * the words as they were written, no card around them; pictures and a link inside, and how much it was
 * talked about. Your short posts and other people's are drawn the same way.
 */
function PostLayout({ name, picture, when, text, images, link, replies, likes, onOpen }: {
  name: string; picture?: string | null; when?: string; text: string
  images?: { thumb: string; alt: string; ratio?: number }[]; link?: NetPost["link"]; replies?: number; likes?: number; onOpen(): void
}) {
  const image = images?.[0]
  return (
    <article>
      <button type="button" onClick={onOpen} className="block w-full rounded-2xl text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
        <PostFrame name={name} picture={picture} when={when}>
          {text && <span className="text-body leading-snug break-words whitespace-pre-wrap"><Faceted text={text} /></span>}
          {image && <img src={image.thumb} alt={image.alt} draggable={false} referrerPolicy="no-referrer" decoding="async" className="mt-1.5 block h-auto w-full rounded-2xl bg-muted" style={{ aspectRatio: image.ratio ?? 4 / 3 }} />}
          {!image && link && (
            <span className="mt-1.5 flex flex-col gap-0.5 rounded-2xl bg-muted px-3 py-2.5">
              <span className="line-clamp-2 text-small font-medium">{link.title || link.uri}</span>
              {link.description && <span className="line-clamp-2 text-small text-muted-foreground">{link.description}</span>}
            </span>
          )}
          {(replies || likes) ? (
            <span className="mt-1 flex items-center gap-4 text-small text-muted-foreground tabular-nums">
              <span className="flex items-center gap-1"><Icon icon={MessageCircleIcon} size="xs" />{replies ?? 0}</span>
              <span className="flex items-center gap-1"><Icon icon={HeartIcon} size="xs" />{likes ?? 0}</span>
            </span>
          ) : null}
        </PostFrame>
      </button>
    </article>
  )
}

/** Someone else's post, from the network: theirs, by their name and picture. */
function NetTile({ post, onOpen }: { post: NetPost; onOpen(): void }) {
  return <PostLayout name={post.author.name || post.author.handle || "Someone"} picture={post.author.avatar} when={post.createdAt}
    text={post.text} images={post.images} link={post.link} replies={post.replies} likes={post.likes} onOpen={onOpen} />
}

/** Someone else's post, opened: theirs, so it is read here and answered on Bluesky. */
function NetPopup({ post, onClose }: { post: NetPost; onClose(): void }) {
  const name = post.author.name || post.author.handle || "Someone"
  return (
    <div role="dialog" aria-label={`${name}'s post`} className="absolute inset-0 z-30 flex bg-black/15 p-3 animate-in fade-in-0"
      onPointerDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="relative mx-auto flex h-full w-full max-w-2xl flex-col overflow-hidden rounded-3xl bg-card shade-5">
        <header className="flex h-14 shrink-0 items-center gap-2.5 ps-5 pe-3">
          <Avatar className="size-8 flex-none">
            {post.author.avatar && <AvatarImage src={post.author.avatar} alt="" referrerPolicy="no-referrer" />}
            <AvatarFallback className="bg-muted text-small">{name.slice(0, 1)}</AvatarFallback>
          </Avatar>
          <span className="flex min-w-0 flex-1 flex-col leading-tight">
            <span className="truncate text-body font-semibold">{name}</span>
            <span className="truncate text-small text-muted-foreground">{ago(post.createdAt)} · on Bluesky</span>
          </span>
          <Button size="sm" variant="ghost" onClick={() => window.open(blueskyUrl(post), "_blank", "noopener")}><Icon icon={ExternalLinkIcon} />Open on Bluesky</Button>
          <Button size="icon-sm" variant="ghost" aria-label="Close" onClick={onClose}><Icon icon={XIcon} /></Button>
        </header>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 pb-8">
          {post.replyTo && <p className="text-small text-muted-foreground">A reply</p>}
          <p className="text-body leading-relaxed break-words whitespace-pre-wrap"><Faceted text={post.text} /></p>
          {post.images?.map((image, i) => <img key={i} src={image.thumb} alt={image.alt} referrerPolicy="no-referrer" className="w-full rounded-xl bg-muted" style={{ aspectRatio: image.ratio ?? 4 / 3 }} />)}
          {post.link && (
            <a href={post.link.uri} target="_blank" rel="noopener noreferrer" className="flex flex-col gap-1 rounded-xl bg-muted p-4">
              <span className="text-body font-medium">{post.link.title || post.link.uri}</span>
              {post.link.description && <span className="text-small text-muted-foreground">{post.link.description}</span>}
            </a>
          )}
        </div>
      </div>
    </div>
  )
}

// ---- Your channels as blocks, as your home panel shows them ----

/** A channel of your home, as one block of the feed: Tools, Artifacts (your website and the pages you
 * kept), or a collection of your site. Opening it shows everything it holds. */
type ChannelBlock =
  | { kind: "tools"; name: "Tools"; tools: SiteTool[]; mark?: string }
  | { kind: "artifacts"; name: "Artifacts"; pages: { src: string; title: string }[]; links: SiteLink[]; mark?: string }
  | { kind: "collection"; name: string; items: SiteItem[]; mark?: string }

/** A channel block's face: the home panel's own channel card; its web pages live, where they are. */
function ChannelBlockTile({ block, onOpen }: { block: ChannelBlock; onOpen(): void }) {
  // Not a button: a live page inside takes its own clicks and scrolling; anywhere else opens the channel.
  return (
    <article role="button" tabIndex={0} aria-label={`Open ${block.name}`} onClick={onOpen}
      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen() } }}
      className="block w-full cursor-pointer rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
      <PostFrame name={authorOf().name} picture={authorOf().picture}>
      <div className="mt-1 aspect-[3/4] w-full">
      {block.kind === "tools" ? (
        <span className="flex size-full flex-col gap-1.5 rounded-2xl bg-muted p-1.5 shade-2">
          <span className="flex items-center gap-1.5 px-1.5 pt-1 text-small font-semibold">
            <span aria-hidden className="size-2 rounded-full bg-foreground" />Tools
            <span className="font-normal text-muted-foreground tabular-nums">{block.tools.length}</span>
          </span>
          <span className="flex min-h-0 flex-1 flex-col gap-1.5">
            {block.tools.slice(0, 2).map(tool => (
              <span key={tool.name} className="relative min-h-0 flex-1 overflow-hidden rounded-xl bg-card"><ToolFrame name={tool.name} live={false} className="pointer-events-none size-full" /></span>
            ))}
          </span>
        </span>
      ) : (
        // Drawn at the size your home panel draws a channel, and scaled to the column, so it looks the same.
        <FixedScale width={HOME_TILE}>
          <span className="block aspect-[3/4]" style={{ width: HOME_TILE }}>
            <ChannelCard name={block.name} view="grid" livePages className="size-full" mark={block.mark || undefined}
              items={block.kind === "collection" ? block.items : []}
              pages={block.kind === "artifacts" ? block.pages : []} />
          </span>
        </FixedScale>
      )}
      </div>
      </PostFrame>
    </article>
  )
}
// The width your home panel's channel tiles are drawn at (a 3:4 tile in its row of 11.5rem).
const HOME_TILE = 168

/** A channel block opened: everything it holds, as the home panel shows a channel expanded. */
function ChannelBlockOpened({ block, onOpenItem }: { block: ChannelBlock; onOpenItem(item: SiteItem): void }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-8">
      <h2 className="pb-5 text-(length:--ohm-type-title-size) font-semibold">{block.name}</h2>
      {block.kind === "tools" ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-4">
          {block.tools.map(tool => <div key={tool.name} className="aspect-[4/3] overflow-hidden rounded-2xl bg-card shade-2"><ToolFrame name={tool.name} className="relative size-full" /></div>)}
        </div>
      ) : block.kind === "artifacts" ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(18rem,1fr))] gap-4">
          {block.pages.map(page => <div key={page.src} className="aspect-[16/10]"><PageCard src={page.src} title={page.title} live /></div>)}
          {block.links.map(link => <div key={link.id} className="aspect-[16/10]"><LinkCard link={link} live /></div>)}
        </div>
      ) : (
        <div className="columns-[12rem] gap-4">
          {block.items.map(item => (
            <button key={item.path} type="button" onClick={() => onOpenItem(item)} aria-label={`Open ${item.title}`}
              className={cn("mb-4 block w-full break-inside-avoid", item.kind === "image" || item.kind === "video" ? "" : "aspect-[3/4]")}>
              <BlockCard item={item} natural={item.kind === "image" || item.kind === "video"} />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// What the feed places: one of your units, or a post from the network. `at` orders them.
type Item = { key: string; at: string; unit?: Unit; post?: NetPost; block?: ChannelBlock }
/** One of the site's blocks (a writing, a project, a photograph) as the unit it is, to open it. */
const unitOfItem = (item: SiteItem): Unit => ({
  key: `site:${item.path}`, type: "artifact", kind: item.kind === "image" || item.kind === "video" ? "image" : "page", root: "site",
  path: `site/${item.path.split("#")[0]}`, title: item.title, visibility: "public",
  ...(item.kind === "image" || item.kind === "video" ? { cover: `site:${item.path}` } : {}),
})
const itemOf = (unit: Unit): Item => ({ key: unit.key, at: unit.updated ?? "", unit })
const postItem = (post: NetPost): Item => ({ key: post.uri, at: post.createdAt, post })

// The page's columns, as a website's: they fill the window's width, and zoom sets how many.
// One block is about as wide as a post on Twitter reads well at.
const COLUMN = 360
const GAP = 28
const FEWEST_COLUMNS = 1
const MOST_COLUMNS = 8
const columnsFor = (room: number) => Math.min(4, Math.max(1, Math.floor((room + GAP) / (COLUMN + GAP))))
const PAGE = 60
/** A tile's height before it is drawn, in a column's widths, to place it in the shortest column. */
const guess = ({ unit, post, block }: Item) => block ? 4 / 3 + 0.2 : post ? 0.3 + (post.images?.length ? 1 : 0) + post.text.length / 400
  : unit!.kind === "short" ? 0.35 + (unit!.excerpt?.length ?? 0) / 400
  : (unit!.cover || unit!.kind === "image" ? 1.25 : 4 / 3) + 0.25

/** Tiles placed newest first, each in the column that is shortest so far, so the page fills evenly. */
function placed(items: Item[], count: number) {
  const heights = Array(count).fill(0) as number[]
  const columns = Array.from({ length: count }, () => [] as Item[])
  for (const item of items) {
    const at = heights.indexOf(Math.min(...heights))
    columns[at].push(item)
    heights[at] += guess(item) + 0.1
  }
  return columns
}

/** The feed, as a page: read again whenever something in the home changes, or the audience does. */
export function FeedView() {
  const { audience: viewAs, rev } = useWorkspace()
  // The feed is what you share: public and friends-only, never what only you see. Viewed as anyone, public.
  const audience = viewAs === "public" ? "public" : "friends"
  const [units, setUnits] = useState<Unit[] | null>(null)
  const [more, setMore] = useState(true)
  const loading = useRef(false)
  const page = useRef<HTMLDivElement>(null)
  const [opened, setOpened] = useState<Unit | null>(null)
  const [channels, setChannels] = useState<Unit[]>([])
  // Your channels, as your home panel reads them: the site's collections, the pages you kept, your tools.
  // Their marks too: each channel wears the colour you gave it there.
  const [site, setSite] = useState<{ content: SiteContent | null; links: SiteLink[]; tools: SiteTool[]; marks: Record<string, string> }>({ content: null, links: [], tools: [], marks: {} })
  useEffect(() => {
    let current = true
    Promise.all([readContent().catch(() => null), readLinks().catch(() => []), readTools().catch(() => []), readOwnChannels().then(own => own.colors).catch(() => ({}))])
      .then(([content, links, tools, marks]) => { if (current) setSite({ content, links, tools, marks }) })
    return () => { current = false }
  }, [rev])
  const [openedBlock, setOpenedBlock] = useState<ChannelBlock | null>(null)
  // Following: yours and who you follow, together. Discover: a feed generator's.
  const [tab, setTab] = useState<"following" | "discover">("following")
  const [live, setLive] = useState<NetPost[]>([])
  const [found, setFound] = useState<NetPost[] | null>(null)
  const [openedPost, setOpenedPost] = useState<NetPost | null>(null)
  // Who you follow is read now and every half minute while the feed is open: Jetstream keeps it current.
  useEffect(() => {
    let current = true
    const read = () => { readLive().then(said => { if (current) setLive(said.posts) }, () => {}) }
    read()
    const every = setInterval(read, 30_000)
    return () => { current = false; clearInterval(every) }
  }, [])
  // Discover is read as soon as the feed opens, so switching to it is instant, and again every two minutes.
  useEffect(() => {
    let current = true
    const read = (fresh = false) => { readDiscover(fresh).then(posts => { if (current) setFound(posts) }, () => {}) }
    read()
    const every = setInterval(() => read(true), 120_000)
    return () => { current = false; clearInterval(every) }
  }, [])
  // Refresh: the tab you are on, read again now, past every cache.
  const [refreshing, setRefreshing] = useState(false)
  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      if (tab === "discover") setFound(await readDiscover(true))
      else {
        const [mine, said] = await Promise.all([readFeed({ audience, limit: PAGE }), readLive().catch(() => null)])
        setUnits(mine); setMore(mine.length === PAGE)
        if (said) setLive(said.posts)
      }
      page.current?.scrollTo({ top: 0, behavior: "smooth" })
    } catch (problem) { void report(Promise.reject(problem)) } finally { setRefreshing(false) }
  }, [tab, audience])
  // You, first: your profile as the feed's first tile, read as the profile view reads it.
  const [profile, setProfile] = useState<SiteProfile | null>(null)
  useEffect(() => {
    readProfile().then(read => {
      you = { name: read.name, picture: read.image ? pictureUrl(read.image) : "" }
      setProfile(read)
    }, () => setProfile(null))
  }, [rev])
  const youUnit: Unit = { key: "profile:you", type: "profile", root: "profile", path: "profile/profile.md", title: profile?.name || me.name, visibility: "public" }
  const close = useCallback(() => setOpened(null), [])
  // Zoom is how many columns, as on haeinjung.com: in for fewer and larger, out for more and smaller.
  // It starts at what the window holds, and stays as you set it.
  const [count, setCount] = useState(() => columnsFor((document.querySelector("main")?.clientWidth ?? 1200) - 48))
  const zoomIn = useCallback(() => setCount(n => Math.max(FEWEST_COLUMNS, n - 1)), [])
  // Where you were, as a share of the page, when the zoom changed; put back once the page has its new size.
  const place = useRef<number | null>(null)
  useLayoutEffect(() => {
    const el = page.current
    if (place.current === null || !el) return
    el.scrollTop = place.current * (el.scrollHeight - el.clientHeight)
    place.current = null
  }, [count])
  const zoomOut = useCallback(() => setCount(n => Math.min(MOST_COLUMNS, n + 1)), [])

  useEffect(() => {
    let current = true
    setMore(true)
    void report(readFeed({ audience, limit: PAGE }).then(read => { if (current) { setUnits(read); setMore(read.length === PAGE) } }))
    // Your channels come first, after you, as a site's sections do; the rest follows newest first.
    void report(readFeed({ audience, limit: 50, types: ["channel"] }).then(read => { if (current) setChannels(read.filter(unit => (unit.count ?? 0) > 0)) }))
    return () => { current = false }
  }, [audience, viewAs, rev])

  // The next page, from where this one ends, once you scroll near the bottom.
  const loadMore = useCallback(() => {
    if (!units?.length || !more || loading.current) return
    const before = units.at(-1)?.updated
    if (!before) { setMore(false); return }
    loading.current = true
    void report(readFeed({ audience, limit: PAGE, before }).then(read => {
      setUnits(now => [...(now ?? []), ...read.filter(unit => !now?.some(each => each.key === unit.key))])
      setMore(read.length === PAGE)
    }).finally(() => { loading.current = false }))
  }, [audience, more, units])
  const onScroll = () => {
    const el = page.current
    // Well before the end: the next page and its pictures are on their way while you still read this one.
    if (el && el.scrollTop + el.clientHeight > el.scrollHeight - 2400) loadMore()
  }
  // ⌘-scroll or a pinch zooms: a column fewer or more, one step at a time. A plain scroll scrolls the page.
  useEffect(() => {
    const el = page.current
    if (!el) return
    // One step per gesture: a pinch sends many small events, so a step waits for a firm move and then rests.
    let held = 0
    let resting = 0
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      if (Date.now() < resting) return
      held += e.deltaY
      if (Math.abs(held) < 60) return
      // Keep your place: the same share of the way down the page, at the new size.
      place.current = el.scrollHeight > el.clientHeight ? el.scrollTop / (el.scrollHeight - el.clientHeight) : 0
      if (held < 0) zoomIn(); else zoomOut()
      held = 0
      resting = Date.now() + 350
    }
    el.addEventListener("wheel", onWheel, { passive: false })
    return () => el.removeEventListener("wheel", onWheel)
  }, [zoomIn, zoomOut, units === null, !profile && (units?.length ?? 0) === 0])

  // Your channels, first, as your home panel lists them: Tools and Artifacts (yours alone, so only when you
  // look as yourself), then the site's collections, which are public as the site is.
  const mine = viewAs === "private"
  const blocks: ChannelBlock[] = [
    ...(mine && site.tools.length ? [{ kind: "tools" as const, name: "Tools" as const, tools: site.tools, mark: site.marks["Tools"] }] : []),
    ...(mine ? [{ kind: "artifacts" as const, name: "Artifacts" as const, links: site.links, mark: site.marks["Artifacts"],
      pages: [{ src: siteUrl("index.html"), title: "Home" }, ...site.links.filter(link => link.frameable).map(link => ({ src: link.url, title: link.title }))] }] : []),
    ...(site.content?.collections ?? []).filter(c => c.items.length).map(c => ({ kind: "collection" as const, name: c.name, items: c.items, mark: site.marks[c.name] })),
  ]
  // A block of its own in the feed: not a web page, a kept website or a tool, which live in their channels.
  const blockOfItsOwn = (unit: Unit) => unit.type !== "channel" && unit.kind !== "link" && unit.kind !== "tool"
    && !(unit.root === "site" && unit.kind === "page" && !isWriting(unit.path.replace(/^site\//, "")))
  // Following: you, your channels, then your blocks and who you follow, newest first. Discover: theirs alone.
  const items: Item[] = tab === "discover"
    ? (found ?? []).map(postItem)
    : [...blocks.map(block => ({ key: `channel:${block.name}`, at: "", block })), ...channels.map(itemOf),
       ...(units ?? []).filter(blockOfItsOwn).map(itemOf).concat(live.map(postItem)).sort((a, b) => b.at.localeCompare(a.at))]
  if (!units) return <div className="flex-1" aria-busy />
  return (
    <section aria-label="Feed" className="relative flex min-h-0 flex-1 flex-col">
      {items.length === 0 && !profile ? (
        <Empty className="flex-1">
          <EmptyHeader>
            <EmptyTitle>Nothing here yet</EmptyTitle>
            <EmptyDescription>Your writing and pictures show here, newest first.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          {/* The header is its own bar: the page scrolls under nothing. */}
        <header className="flex h-14 shrink-0 items-center gap-1 px-6">
          <div role="tablist" aria-label="Feed" className="flex flex-1 gap-1">
            {(["following", "discover"] as const).map(each => (
              <Button key={each} role="tab" aria-selected={tab === each} size="sm" variant="ghost" onClick={() => setTab(each)}
                className="text-muted-foreground aria-selected:bg-muted aria-selected:text-foreground">{each === "following" ? "Following" : "Discover"}</Button>
            ))}
          </div>
          <Button size="icon-sm" variant="ghost" aria-label="Refresh" title="Refresh" disabled={refreshing} onClick={() => void refresh()}>
            <Icon icon={RefreshCwIcon} className={cn(refreshing && "animate-spin")} />
          </Button>
        </header>
          <div ref={page} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-6 pb-10">
          {/* Every tile is drawn at one size, and the whole grid is scaled to the window: zooming shrinks or
              grows them all in proportion, and nothing in a tile moves. */}
          <FixedScale width={count * COLUMN + (count - 1) * GAP}>
            <div role="feed" aria-busy={more} className="flex items-start" style={{ gap: GAP }}>
              {placed(items, count).map((column, i) => (
                <div key={i} className="flex flex-col" style={{ width: COLUMN, gap: GAP }}>
                  {tab === "following" && i === 0 && profile && <ProfileTile profile={profile} onOpen={() => setOpened(youUnit)} />}
                  {column.map(item => item.block
                    ? <ChannelBlockTile key={item.key} block={item.block} onOpen={() => setOpenedBlock(item.block!)} />
                    : item.post
                    ? <NetTile key={item.key} post={item.post} onOpen={() => setOpenedPost(item.post!)} />
                    : <FeedTile key={item.key} unit={item.unit!} onOpen={() => setOpened(item.unit!)} />)}
                </div>
              ))}
            </div>
          </FixedScale>
          </div>
        </>
      )}
      {opened && <Popup unit={opened} onOpen={setOpened} onClose={close} />}
      {openedPost && <NetPopup post={openedPost} onClose={() => setOpenedPost(null)} />}
      {openedBlock && (
        <div role="dialog" aria-label={openedBlock.name} className="absolute inset-0 z-30 flex bg-black/15 p-3 animate-in fade-in-0"
          onPointerDown={e => { if (e.target === e.currentTarget) setOpenedBlock(null) }}>
          <div className="relative mx-auto flex h-full w-full max-w-5xl flex-col overflow-hidden rounded-3xl bg-card shade-5">
            <header className="flex h-12 shrink-0 items-center justify-end ps-5 pe-3">
              <Button size="icon-sm" variant="ghost" aria-label="Close" onClick={() => setOpenedBlock(null)}><Icon icon={XIcon} /></Button>
            </header>
            <ChannelBlockOpened block={openedBlock} onOpenItem={item => { setOpenedBlock(null); setOpened(unitOfItem(item)) }} />
          </div>
        </div>
      )}
    </section>
  )
}
