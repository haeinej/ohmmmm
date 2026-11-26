// The feed (app/flows/feed.md, docs/plans/units.md step 6): your blocks worth seeing, newest first, laid
// out on an endless plane like the site's canvas (site/Board.tsx): drag or scroll to move around, ⌘-scroll
// or pinch to zoom, and more comes as you go down. It takes the whole page; there is no side panel beside
// it. Each tile is the card the canvas already uses (site/Cards.tsx): a picture as itself, a writing as its
// first page in miniature, and under it its title and who made it. A tile opens what it shows. What it
// shows follows View as: a friend sees public and friends blocks, anyone public ones.
import { useCallback, useEffect, useRef, useState } from "react"
import type { LucideIcon } from "lucide-react"
import { ExternalLinkIcon, GlobeIcon, LockIcon, UsersIcon, XIcon } from "lucide-react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Icon } from "@/components/ui/icon"
import { bridgeFetch } from "@/data/bridge"
import { docOfUnit, folderOf, readFeed, readLevel, type Unit } from "@/data/units"
import { blueskyUrl, readDiscover, readLive, type NetPost } from "@/data/network"
import { titleOf } from "@/data/workspace-data"
import { cn } from "@/lib/cn"
import { BlockCard, ReaderScale } from "@/site/Cards"
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
import { pictureUrl, readProfile, saveChange, type Change, type SiteProfile } from "@/site/source"
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
const authorOf = (_unit: Unit) => ({ name: you.name || me.name, picture: you.picture })

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
function Face({ unit }: { unit: Unit }) {
  const cover = useCover(unit.cover)
  if (unit.type === "channel") return <ChannelFace unit={unit} />
  // A short post's card is its words, as on Bluesky: all of them, with links, mentions and tags marked.
  if (unit.kind === "short") return <span className={cn(face, "p-4 text-body leading-snug break-words whitespace-pre-wrap")}><Faceted text={unit.excerpt ?? ""} /></span>
  // A tool built for you is shown running, as the canvas shows it; it can't be used from its tile.
  if (unit.kind === "tool" && unit.id) return <span className={cn(face, "aspect-3/4")}><ToolFrame name={unit.id} live={false} className="pointer-events-none size-full" /></span>
  // A page of the site is writing: its text, as the reader shows it, never the picture it is shared with.
  if (unit.root === "site" && unit.kind === "page") {
    const path = unit.path.replace(/^site\//, "")
    return <BlockCard className="aspect-3/4 h-auto" item={{ kind: "article", path, title: unit.title ?? path, modified: unit.updated ?? "", usedIn: [] }} />
  }
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
  useEffect(() => {
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

/** One tile of the masonry: the block, then its title, then who made it, when, and who sees it. */
export function FeedTile({ unit, onOpen }: { unit: Unit; onOpen(): void }) {
  const author = authorOf(unit)
  const seen = SEEN_BY[unit.visibility]
  // A block or an agent's file is named as everywhere in the app; anything else by its own title.
  const doc = docOfUnit(unit)
  const title = doc ? titleOf(doc) : unit.title || unit.path.split("/").at(-1)
  return (
    <article>
      <button type="button" onClick={onOpen} aria-label={title} className="group flex w-full flex-col gap-2.5 text-left outline-none">
        <span className="block rounded-2xl group-focus-visible:ring-2 group-focus-visible:ring-ring/40">
          <Face unit={unit} />
        </span>
        <span className="flex min-w-0 items-center gap-2 px-1 text-small text-muted-foreground">
          <Avatar className="size-5 flex-none">
            {author.picture && <AvatarImage src={author.picture} alt="" />}
            <AvatarFallback className="bg-primary text-[10px] text-primary-foreground">{author.name.slice(0, 1)}</AvatarFallback>
          </Avatar>
          <span className="truncate">{author.name}</span>
          <span className="ms-auto flex flex-none items-center gap-1.5">
            {unit.updated && <time dateTime={unit.updated}>{ago(unit.updated)}</time>}
            <Icon icon={seen.icon} size="xs" aria-label={seen.label} />
          </span>
        </span>
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

/** Someone else's post, as a tile like yours: its words and pictures, then who wrote it, by name. */
function NetTile({ post, onOpen }: { post: NetPost; onOpen(): void }) {
  const name = post.author.name || post.author.handle || "Someone"
  const picture = post.images?.[0]
  return (
    <article>
      <button type="button" onClick={onOpen} className="group flex w-full flex-col gap-2.5 text-left outline-none">
        <span className={cn(face, "group-focus-visible:ring-2 group-focus-visible:ring-ring/40")}>
          {picture && <img src={picture.thumb} alt={picture.alt} draggable={false} referrerPolicy="no-referrer" className="block h-auto w-full" />}
          {post.text && <span className="block p-4 text-body leading-snug break-words whitespace-pre-wrap"><Faceted text={post.text} /></span>}
          {!post.text && !picture && post.link && <span className="block p-4 text-body font-medium">{post.link.title || post.link.uri}</span>}
        </span>
        <span className="flex min-w-0 items-center gap-2 px-1 text-small text-muted-foreground">
          <Avatar className="size-5 flex-none">
            {post.author.avatar && <AvatarImage src={post.author.avatar} alt="" referrerPolicy="no-referrer" />}
            <AvatarFallback className="bg-muted text-[10px] text-muted-foreground">{name.slice(0, 1)}</AvatarFallback>
          </Avatar>
          <span className="truncate">{name}</span>
          <span className="ms-auto flex-none">{ago(post.createdAt)}</span>
        </span>
      </button>
    </article>
  )
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
          {post.images?.map((image, i) => <img key={i} src={image.thumb} alt={image.alt} referrerPolicy="no-referrer" className="w-full rounded-xl" />)}
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

// What the feed places: one of your units, or a post from the network. `at` orders them.
type Item = { key: string; at: string; unit?: Unit; post?: NetPost }
const itemOf = (unit: Unit): Item => ({ key: unit.key, at: unit.updated ?? "", unit })
const postItem = (post: NetPost): Item => ({ key: post.uri, at: post.createdAt, post })

// The page's columns, as a website's: they fill the window's width, and zoom sets how many.
const COLUMN = 240
const GAP = 24
const FEWEST_COLUMNS = 1
const MOST_COLUMNS = 8
const columnsFor = (room: number) => Math.min(6, Math.max(2, Math.floor((room + GAP) / (COLUMN + GAP))))
const PAGE = 60
/** A tile's height before it is drawn, in a column's widths, to place it in the shortest column. */
const guess = ({ unit, post }: Item) => post ? 0.3 + (post.images?.length ? 1 : 0) + post.text.length / 400
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
  useEffect(() => { if (tab === "discover" && !found) void report(readDiscover().then(setFound)) }, [tab, found])
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
  const zoomOut = useCallback(() => setCount(n => Math.min(MOST_COLUMNS, n + 1)), [])

  useEffect(() => {
    let current = true
    setMore(true)
    void report(readFeed({ audience, limit: PAGE }).then(read => { if (current) { setUnits(read); setMore(read.length === PAGE) } }))
    // Your channels come first, after you, as a site's sections do; the rest follows newest first.
    void report(readFeed({ audience, limit: 50, types: ["channel"] }).then(read => { if (current) setChannels(read.filter(unit => (unit.count ?? 0) > 0)) }))
    return () => { current = false }
  }, [audience, rev])

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
    if (el && el.scrollTop + el.clientHeight > el.scrollHeight - 800) loadMore()
  }
  // ⌘-scroll or a pinch zooms: a column fewer or more, one step at a time. A plain scroll scrolls the page.
  useEffect(() => {
    const el = page.current
    if (!el) return
    let held = 0
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      held += e.deltaY
      if (Math.abs(held) < 40) return
      if (held < 0) zoomIn(); else zoomOut()
      held = 0
    }
    el.addEventListener("wheel", onWheel, { passive: false })
    return () => el.removeEventListener("wheel", onWheel)
  }, [zoomIn, zoomOut, units === null, !profile && (units?.length ?? 0) === 0])

  // Following: you, your channels, then your blocks and who you follow, newest first. Discover: theirs alone.
  const items: Item[] = tab === "discover"
    ? (found ?? []).map(postItem)
    : [...channels.map(itemOf), ...[...(units ?? []).filter(unit => unit.type !== "channel").map(itemOf), ...live.map(postItem)].sort((a, b) => b.at.localeCompare(a.at))]
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
        <div ref={page} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-6 pb-10">
          <div className="sticky top-0 z-10 flex items-center gap-1 bg-card py-4">
            <div role="tablist" aria-label="Feed" className="flex flex-1 gap-1">
              {(["following", "discover"] as const).map(each => (
                <Button key={each} role="tab" aria-selected={tab === each} size="sm" variant="ghost" onClick={() => setTab(each)}
                  className="text-muted-foreground aria-selected:bg-muted aria-selected:text-foreground">{each === "following" ? "Following" : "Discover"}</Button>
              ))}
            </div>
          </div>
          <div role="feed" aria-busy={more} className="flex items-start" style={{ gap: GAP }}>
            {placed(items, count).map((column, i) => (
              <div key={i} className="flex min-w-0 flex-1 flex-col" style={{ gap: GAP }}>
                {tab === "following" && i === 0 && profile && <ProfileTile profile={profile} onOpen={() => setOpened(youUnit)} />}
                {column.map(item => item.post
                  ? <NetTile key={item.key} post={item.post} onOpen={() => setOpenedPost(item.post!)} />
                  : <FeedTile key={item.key} unit={item.unit!} onOpen={() => setOpened(item.unit!)} />)}
              </div>
            ))}
          </div>
        </div>
      )}
      {opened && <Popup unit={opened} onOpen={setOpened} onClose={close} />}
      {openedPost && <NetPopup post={openedPost} onClose={() => setOpenedPost(null)} />}
    </section>
  )
}
