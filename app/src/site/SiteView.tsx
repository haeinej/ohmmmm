// The Site view (flows/site.md): the person's own website, running, as the main screen, and what
// can be done to it from here: compose its gallery, take a move back or do it again, save, open a
// block or the profile over it, and keep the folder in step with its git remote.
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { MousePointerClickIcon, PanelRightIcon, XIcon, ExternalLinkIcon, GlobeIcon, RotateCwIcon, FileCodeIcon, FileTextIcon, FolderIcon, ImageIcon, MinusIcon, PlusIcon, Redo2Icon, Undo2Icon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Icon } from "@/components/ui/icon"
import { notify } from "@/components/ui/notice"
import { registerStepTool } from "@/webmcp"
import { useWorkspace } from "@/workspace/store"
import { withAgent } from "@/workspace/tools"
import { BlockAbout, BlockView } from "./BlockView"
import { ArtifactPanel } from "./ArtifactPanel"
import { ToolFrame } from "./ToolFrame"
import { LiveLayer } from "./LiveLayer"
import { followChanges, startLive } from "./live"
import { PageTile, SiteContentPanel, Tile } from "./SiteContentPanel"
import { markColor, readMark } from "@/components/ui/mark"
import { Board, type BoardHandle, type BoardState } from "./Board"
import { goTo, replaceWith, step as walk, useNav, type Place } from "./nav"
import { LiveCanvas, type LiveCanvasHandle, type LiveState } from "./LiveCanvas"
import { FileEditor } from "./FileEditor"
import { SiteHistory } from "@/history/SiteHistory"
import { ProfileView } from "./ProfileView"
import { DeployControl } from "./SiteDeploy"
import { PublishControl } from "./SitePublish"
import { SyncControls } from "./SiteSync"
import { addressOf, EditProblem, markupFor, OPEN_BLOCK, OPEN_FILE, OPEN_PAGE, OPEN_PROFILE, readContent, readOwnChannels, siteUrl, SITE_SAVED, readSync, saveChange, syncStep, type Change, type SiteContent, type SiteSync } from "./source"

/** The page the canvas opens on: the gallery, which holds every photograph, writing and project, wherever the site keeps it. */
const startOf = (content: SiteContent) => `/site/${content.start ?? "archive/index.html"}`
const ZOOMS = [0.33, 0.5, 0.67, 0.8, 1]

export function SiteView() {
  const { agentsAllowed } = useWorkspace()
  const canvas = useRef<LiveCanvasHandle>(null)
  const [content, setContent] = useState<SiteContent | null>(null)
  const [live, setLive] = useState<LiveState>({ page: "", moves: [], canUndo: false, canRedo: false })
  const [zoom, setZoom] = useState(1)
  const [saving, setSaving] = useState(false)
  const boardRef = useRef<BoardHandle>(null)
  const [homeOpen, setHomeOpen] = useState(false)
  const [homeWidth, setHomeWidth] = useState(336)
  const [board, setBoard] = useState<BoardState>({ canUndo: false, canRedo: false, zoom: 1, count: 0 })
  const [colors, setColors] = useState<Record<string, string>>({})
  useEffect(() => { readOwnChannels().then(o => setColors(o.colors), () => {}) }, [])
  /** Where the main area is (nav.ts): the site, a channel, or a block by its path. */
  const { place, canBack, canForward } = useNav()
  const block = place.kind === "block" ? place.path : null
  const setBlock = (path: string | null) => goTo(path ? { kind: "block", path } : { kind: "home" })
  const [profileOpen, setProfileOpen] = useState(false)
  /** A file open in the text editor, by its path. */
  const [editing, setEditing] = useState<string | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  useEffect(() => startLive(), [])
  // Details are closed whenever something new is opened: what it is shows first, its details on asking.
  const opening = JSON.stringify(place)
  useEffect(() => setDetailsOpen(false), [opening])
  const [sync, setSync] = useState<SiteSync | null>(null)
  const [syncing, setSyncing] = useState(false)
  /** Pull, Commit, Push and Deploy one by one, for people who want them: behind Advanced. */
  const [advanced, setAdvanced] = useState(false)

  useEffect(() => { readContent().then(setContent, e => notify({ message: (e as Error).message, tone: "error" })) }, [])
  const refreshSync = useCallback(() => readSync().then(setSync, () => setSync(null)), [])
  useEffect(() => { void refreshSync() }, [refreshSync])
  // Any save (a page, a file in the editor, a move, a restore): the canvas and where the site stands are read again.
  useEffect(() => {
    const onSaved = () => { void refreshSync(); canvas.current?.reload() }
    window.addEventListener(SITE_SAVED, onSaved)
    return () => window.removeEventListener(SITE_SAVED, onSaved)
  }, [refreshSync])

  /** One handler for every save to a page's file: the Save buttons and the tools that change a page. */
  const save = useCallback(async (page: string, change: Change) => {
    await saveChange(page, change)
    void refreshSync()
    notify({ message: `Saved to ${page}. It is on your computer only until you publish your site.` })
    return { page, saved: true }
  }, [refreshSync])
  /** A tool's change isn't on the canvas yet, so the canvas reads its page again. */
  const saveAndShow = useCallback(async (page: string, change: Change) => {
    try {
      const out = await save(page, change)
      canvas.current?.reload()
      return out
    } catch (e) {
      throw e instanceof EditProblem ? new DOMException(e.message, "DataError") : e
    }
  }, [save])

  const saveOrder = async () => {
    setSaving(true)
    try { await save(live.page, { type: "order", moves: live.moves }); canvas.current?.saved() }
    catch (e) { notify({ message: (e as Error).message, tone: "error" }) }
    setSaving(false)
  }

  /** One handler for Pull and Commit and their tools, and for Publish, which has no tool. */
  const step = useCallback(async (which: "pull" | "commit" | "push", message?: string) => {
    setSyncing(true)
    try {
      const before = await readSync()
      const now = await syncStep(which, message)
      setSync(now)
      if (which === "pull") {
        setContent(await readContent()); canvas.current?.reload()
        notify({ message: before.behind || now.last !== before.last ? `Pulled. Your folder now matches ${now.upstream || "the remote"}.` : "Already up to date.", tone: "info" })
      }
      if (which === "commit") notify({ message: `Committed: ${now.last}`, tone: "info" })
      if (which === "push") notify({ message: "Pushed to your remote.", tone: "info" })
      return { branch: now.branch, ahead: now.ahead, behind: now.behind, changed: now.changed }
    } finally {
      setSyncing(false)
    }
  }, [])
  const stepByHand = (which: "pull" | "commit" | "push", message?: string) => { step(which, message).catch(e => notify({ message: (e as Error).message, tone: "error" })) }

  /** One handler for a tile's click, a ⌘-click on the canvas and the `site.open-block` tool. */
  const openBlock = useCallback((path: string) => {
    if (!content?.collections.some(c => c.items.some(i => i.path === path))) throw new DOMException("That block isn't in the site", "DataError")
    setProfileOpen(false)
    setBlock(path)
    return { block: path }
  }, [content])
  /** What the canvas names when something on it is ⌘-clicked, as the block it is. */
  const openFromCanvas = (address: string) => {
    const items = content?.collections.flatMap(c => c.items) ?? []
    const path = address.startsWith("photo:")
      ? items.find(i => i.path.endsWith(`/${address.slice(6)}`) && (i.kind === "image" || i.kind === "video"))?.path
      : items.find(i => addressOf(i.path) === address || `/${i.path}` === address)?.path
    if (path) setBlock(path); else notify({ message: "That isn't one of your blocks yet.", tone: "info" })
  }
  useEffect(() => {
    const onBlock = (e: Event) => { try { openBlock((e as CustomEvent<string>).detail) } catch { /* not a block of this site */ } }
    const onProfile = () => { setBlock(null); setProfileOpen(true) }
    const onFile = (e: Event) => { setBlock(null); setProfileOpen(false); setEditing((e as CustomEvent<string>).detail) }
    window.addEventListener(OPEN_BLOCK, onBlock)
    window.addEventListener(OPEN_PROFILE, onProfile)
    const onPage = (e: Event) => { setBlock(null); setProfileOpen(false); setEditing(null); canvas.current?.go((e as CustomEvent<string>).detail) }
    window.addEventListener(OPEN_FILE, onFile)
    window.addEventListener(OPEN_PAGE, onPage)
    return () => { window.removeEventListener(OPEN_PAGE, onPage); window.removeEventListener(OPEN_BLOCK, onBlock); window.removeEventListener(OPEN_PROFILE, onProfile); window.removeEventListener(OPEN_FILE, onFile) }
  }, [openBlock])
  const opened = useMemo(() => {
    for (const c of content?.collections ?? []) {
      const item = c.items.find(i => i.path === block)
      if (!item) continue
      // A block in a channel inside this one steps through that channel only.
      const items = item.channel ? c.items.filter(i => i.channel === item.channel) : c.items
      const at = items.indexOf(item)
      return { item, items, channel: { name: item.channel ?? c.name, at, of: items.length } }
    }
    return null
  }, [content, block])
  const stepBlock = useCallback((by: -1 | 1) => { const next = opened?.items[opened.channel.at + by]; if (next) replaceWith({ kind: "block", path: next.path }) }, [opened])
  const closeBlock = useCallback(() => { if (canBack) walk(-1); else goTo({ kind: "home" }) }, [canBack])
  const closeProfile = useCallback(() => setProfileOpen(false), [])
  /** Close whatever is open over the canvas. */
  const closeAll = useCallback(() => {
    setProfileOpen(false); setEditing(null); setHistoryOpen(false)
    if (place.kind !== "home") goTo({ kind: "home" })
  }, [place.kind])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !(e.target as HTMLElement).closest?.("[contenteditable], input, textarea")) closeAll() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [closeAll])

  // ⌘Z and ⇧⌘Z take a move back and do it again, while nothing is being written in.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z" || (e.target as HTMLElement).closest?.("[contenteditable], input, textarea")) return
      e.preventDefault()
      if (e.shiftKey) boardRef.current?.redo(); else boardRef.current?.undo()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  useEffect(() => {
    if (!agentsAllowed || !content) return
    const ac = new AbortController()
    const page = { type: "string", minLength: 1, maxLength: 300 } as const
    const stood = { type: "object", properties: {}, additionalProperties: false } as const
    const failing = (e: unknown) => { throw new DOMException((e as Error).message, "OperationError") }
    registerStepTool<{ block: string }, { block: string }>({
      name: "site.open-block", title: "Open block",
      description: "Opens one block of the site over the canvas: an article, a project, an image or a video, by its path. Returns the block's path.",
      annotations: { readOnlyHint: true },
      inputSchema: { type: "object", properties: { block: page }, required: ["block"], additionalProperties: false },
      run: withAgent("Opening a block of your site", async (input: { block: string }) => openBlock(input.block)),
    }, ac.signal).catch(console.error)
    registerStepTool<{ page: string; before: string; after: string; nth?: number }, { page: string; saved: boolean }>({
      name: "site.edit-text", title: "Save",
      description: "Changes the text of one element in a page's file on the person's computer: the element that says exactly `before` now says `after`. `nth` chooses among elements saying the same (0 is the first). Nothing is published. Returns the page's path.",
      inputSchema: {
        type: "object",
        properties: { page, before: { type: "string", minLength: 1, maxLength: 2000 }, after: { type: "string", minLength: 1, maxLength: 2000 }, nth: { type: "integer", minimum: 0, default: 0 } },
        required: ["page", "before", "after"], additionalProperties: false,
      },
      run: withAgent("Changing text on your site", async (input: { page: string; before: string; after: string; nth?: number }) =>
        saveAndShow(input.page, { type: "text", before: input.before, after: input.after, nth: input.nth })),
    }, ac.signal).catch(console.error)
    registerStepTool<{ page: string; block: string; after?: string; nth?: number; replace?: string }, { page: string; saved: boolean }>({
      name: "site.place-block", title: "Save",
      description: "Places one block of the site on a page, in the page's file on the person's computer. With `after`, the block goes after the element that says exactly that text (`nth` chooses among elements saying the same). With `replace`, an image block takes the place of the image whose `src` is written exactly so. Nothing is published. Returns the page's path.",
      inputSchema: {
        type: "object",
        properties: { page, block: page, after: { type: "string", minLength: 1, maxLength: 2000 }, nth: { type: "integer", minimum: 0, default: 0 }, replace: { type: "string", minLength: 1, maxLength: 500 } },
        required: ["page", "block"], additionalProperties: false,
      },
      run: withAgent("Placing a block on your site", async (input: { page: string; block: string; after?: string; nth?: number; replace?: string }) => {
        const item = content.collections.flatMap(c => c.items).find(i => i.path === input.block)
        if (!item) throw new DOMException("That block isn't in the site", "DataError")
        if (Boolean(input.after) === Boolean(input.replace)) throw new DOMException("Say one of `after` or `replace`", "DataError")
        if (input.replace && item.kind !== "image") throw new DOMException("Only an image can take an image's place", "DataError")
        return saveAndShow(input.page, input.replace
          ? { type: "src", from: input.replace, to: addressOf(item.path) }
          : { type: "insert", anchor: input.after!, html: markupFor(item), nth: input.nth })
      }),
    }, ac.signal).catch(console.error)
    registerStepTool<{ page: string; photo: string; before?: string }, { page: string; saved: boolean }>({
      name: "site.move-photo", title: "Save",
      description: "Moves one photograph in a gallery page's order, in the page's file on the person's computer: `photo` (its file's name) goes before the photograph `before`, or to the end without it. Nothing is published. Returns the page's path.",
      inputSchema: { type: "object", properties: { page, photo: page, before: page }, required: ["page", "photo"], additionalProperties: false },
      run: withAgent("Moving a photograph on your site", async (input: { page: string; photo: string; before?: string }) =>
        saveAndShow(input.page, { type: "order", moves: [{ key: input.photo, before: input.before ?? null }] })),
    }, ac.signal).catch(console.error)
    registerStepTool({
      name: "site.sync-status", title: "Sync status",
      description: "Says where the site's folder stands against its git remote: the branch, how many commits it is ahead and behind, and the tracked files changed since the last commit.",
      annotations: { readOnlyHint: true }, inputSchema: stood,
      run: withAgent("Reading your site's sync status", async () => { const s = await readSync(); setSync(s); return { branch: s.branch, ahead: s.ahead, behind: s.behind, changed: s.changed } }),
    }, ac.signal).catch(console.error)
    registerStepTool({
      name: "site.pull", title: "Pull",
      description: "Fetches the site's git remote and fast-forwards the folder on the person's computer to it. It never merges or rewrites: if the folder can't simply move forward, nothing changes and the reason is returned. Returns the sync status.",
      inputSchema: stood,
      run: withAgent("Pulling your site", async () => step("pull").catch(failing)),
    }, ac.signal).catch(console.error)
    registerStepTool<{ message: string }, unknown>({
      name: "site.commit", title: "Commit",
      description: "Commits the tracked files changed in the site's folder, on the person's computer, with `message`. Nothing is published: sending commits to the remote is the person's own step. Returns the sync status.",
      inputSchema: { type: "object", properties: { message: { type: "string", minLength: 1, maxLength: 200 } }, required: ["message"], additionalProperties: false },
      run: withAgent("Committing your site's changes", async (input: { message: string }) => step("commit", input.message).catch(failing)),
    }, ac.signal).catch(console.error)
    return () => ac.abort()
  }, [agentsAllowed, content, openBlock, saveAndShow, step])

  const accent = getComputedStyle(document.documentElement).getPropertyValue("--primary").trim() || "currentColor"
  const zoomBy = (by: -1 | 1) => setZoom(z => ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, ZOOMS.indexOf(z) + by))])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TitleBar content={content} place={place} title={opened?.item.title} file={editing ?? undefined}
        onRename={opened && (opened.item.kind === "article" || opened.item.kind === "project") ? async (after: string) => {
          // The title is the page's own heading: changed in its file, like any words on the page.
          const page = opened.item.path.split("#")[0]
          try { await save(page, { type: "text", before: opened.item.title, after }); setContent(await readContent()) }
          catch (e) { notify({ message: (e as Error).message, tone: "error" }) }
        } : undefined}>
        {/* History and Publish belong to what is open, not to the whole canvas: the website (the artifact
            that is the site) has both; a block has its own history. */}
      </TitleBar>

      {/* Everything that opens in the main area opens over the canvas, under the title bar. */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        {/* Home is a white canvas to think on; blocks and channels are dragged onto it from your card. */}
        <Board ref={boardRef} content={content} colors={colors} onState={setBoard} onSave={save} />

        {/* Whatever is being read (a block, a file, your profile, the history) reads in the middle: beside
            your card, which stays at the left as the side panel on every screen. */}
        {(profileOpen || editing || historyOpen || opened || place.kind === "page" || place.kind === "channel" || place.kind === "link" || place.kind === "tool") && (
          // What is open floats over the canvas as a window of its own; the canvas and your card stay behind,
          // dimmed. A click outside it, or Escape, closes it.
          // It opens at the top, in the room beside your card (the side panel), which stays clear of it.
          <div style={{ paddingInlineStart: (homeOpen ? homeWidth + 4 : 332) + 12 }}
            className="absolute inset-0 z-10 flex items-start justify-center bg-card/60 py-3 pe-3 animate-in fade-in-0 duration-(--ohm-duration-open)"
            onPointerDown={e => { if (e.target === e.currentTarget) closeAll() }}>
            <div role="presentation" className="flex h-full w-full gap-3 animate-in slide-in-from-top-2 fade-in-0 duration-(--ohm-duration-open) ease-(--ohm-ease-out)">
            <div className="relative h-full min-w-0 flex-1 overflow-hidden rounded-3xl bg-card shade-5">
            {profileOpen && <ProfileView onClose={closeProfile} />}
            {editing && <FileEditor path={editing} onClose={() => setEditing(null)} />}
            {historyOpen && <SiteHistory onClose={() => setHistoryOpen(false)} path={place.kind === "block" && opened ? opened.item.path.split("#")[0] : undefined} />}
            {place.kind === "tool" && (
              <div role="dialog" aria-label={place.title} className="absolute inset-0 flex flex-col bg-card">
                <div className="frost absolute top-3 right-3 z-20 flex items-center gap-0.5 rounded-full p-1 shade-3">
                  <Button size="icon-sm" variant="ghost" aria-label="Close" onClick={closeAll}><Icon icon={XIcon} /></Button>
                </div>
                <ToolFrame name={place.name} />
              </div>
            )}
            {place.kind === "link" && <PageReader src={place.url} path={place.title} onClose={closeAll} external />}
            {place.kind === "channel" && !editing && !profileOpen && <ChannelReader name={place.name} content={content} colors={colors} onClose={closeAll} />}
            {place.kind === "page" && !opened && !editing && !profileOpen && (
              <PageReader path={place.path} site={content?.site} onClose={closeBlock}
                // The website's own history and its Publish, in its own controls: they are this artifact's.
                actions={<Button size="icon-sm" variant="ghost" aria-label="Details: history, pull requests, deploys" aria-pressed={detailsOpen} onClick={() => setDetailsOpen(o => !o)}><Icon icon={PanelRightIcon} /></Button>} />
            )}
            {opened && (
              <BlockView item={opened.item} channel={opened.channel} onStep={stepBlock} onClose={closeBlock} onSave={save}
                onDetails={() => setDetailsOpen(o => !o)} detailsOpen={detailsOpen}
                titleOf={path => path}
                onShowPage={path => window.open(siteUrl(path), "_blank", "noopener")} />
            )}
          </div>
            {/* The third column: the open artifact's code, beside it. The website's is the whole site's; a block's is its page's. */}
            {detailsOpen && (place.kind === "page" || (place.kind === "block" && opened)) && (
              <ArtifactPanel path={place.kind === "block" && opened ? opened.item.path.split("#")[0] : undefined} onClose={() => setDetailsOpen(false)}
                about={place.kind === "block" && opened ? <BlockAbout item={opened.item} channel={opened.channel.name} titleOf={p => p} onShowPage={p => window.open(siteUrl(p), "_blank", "noopener")} /> : undefined} />
            )}
          </div></div>
        )}
        <SiteContentPanel floating={{ open: homeOpen, onOpen: setHomeOpen, width: homeWidth, onWidth: setHomeWidth }} />

        {live.moves.length > 0 && (
          <div role="status" className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-2xl bg-card py-2 ps-4 pe-2 text-small shade-2">
            <span>{live.moves.length === 1 ? "1 photograph moved" : `${live.moves.length} moves`} in {live.page}</span>
            <Button size="sm" variant="ghost" disabled={saving} onClick={() => canvas.current?.discard()}>Discard</Button>
            <Button size="sm" disabled={saving} onClick={() => void saveOrder()}>Save</Button>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * The title bar of the main area: back and forward through where it has been, then where it is now,
 * as a trail you can click (site › channel › channel inside › block). Its own controls follow.
 */
function TitleBar({ content, place, title, file, onRename, children }: {
  content: SiteContent | null; place: Place; title?: string; children?: React.ReactNode
  /** A file of the site open in the file viewer: the trail is its folders. */
  file?: string
  /** Rename the open block: only a writing, whose title is words on its page. */
  onRename?: (title: string) => Promise<void>
}) {
  const crumbs: { label: string; to?: Place }[] = [{ label: content?.site || "Site", to: { kind: "home" } }]
  const channelOf = (path: string) => {
    for (const c of content?.collections ?? []) { const i = c.items.find(x => x.path === path); if (i) return i.channel ? `${c.name}/${i.channel}` : c.name }
    return null
  }
  const name = place.kind === "block" ? channelOf(place.path) : null
  if (name) {
    const [outer, inner] = name.split("/")
    // Channels are opened in the side panel, not here: they name where the block is.
    crumbs.push({ label: outer })
    if (inner) crumbs.push({ label: inner })
  }
  if (place.kind === "block" && !file) crumbs.push({ label: title ?? place.path })
  if (place.kind === "channel" && !file) for (const piece of place.name.split("/")) crumbs.push({ label: piece })
  if (place.kind === "link" && !file) crumbs.push({ label: place.title })
  if (place.kind === "tool" && !file) crumbs.push({ label: "Tools" }, { label: place.title })
  if (place.kind === "page" && !file) for (const piece of place.path.split("/")) crumbs.push({ label: piece })
  if (file) { crumbs.length = 1; for (const piece of file.split("/")) crumbs.push({ label: piece }) }
  const last = crumbs.length - 1
  // The bar is in the page by the time this has mounted; read it then, not while rendering.
  const [target, setTarget] = useState<HTMLElement | null>(null)
  const [actions, setActions] = useState<HTMLElement | null>(null)
  useEffect(() => { setTarget(document.getElementById("ohm-title")); setActions(document.getElementById("ohm-actions")) })
  return (
    <>
      {/* Where you are goes in the bar across the window; this view's own controls stay here. */}
      {target && createPortal(
        <nav aria-label="Where you are" className="flex min-w-0 items-center gap-1.5 font-medium">
          {/* What this is: a folder for the site, the block's own kind for a block. */}
          <Icon icon={place.kind === "page" && !file ? GlobeIcon : file ? (/\.(?:md|markdown|mdx)$/i.test(file) ? FileTextIcon : FileCodeIcon) : place.kind === "block" ? (title && /\.(jpe?g|png|gif|webp|avif|mp4|mov|webm)$/i.test(place.path) ? ImageIcon : FileTextIcon) : FolderIcon} className="me-1 shrink-0 text-muted-foreground" />
          {crumbs.map((c, i) => (
            <span key={i} className="flex min-w-0 items-center gap-1.5">
              {i > 0 && <span aria-hidden className="text-muted-foreground">›</span>}
              {i === last && onRename && !file
                ? <TitleInput key={c.label} value={c.label} onRename={onRename} />
                : i === last || !c.to
                ? <span aria-current={i === last ? "page" : undefined} className={i === last ? "truncate" : "shrink-0 text-muted-foreground"}>{c.label}</span>
                : <button type="button" onClick={() => goTo(c.to!)} className="shrink-0 rounded-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40">{c.label}</button>}
            </span>
          ))}
        </nav>, target)}
      {/* The view's own controls sit at the right of the same bar: no row of their own above the canvas. */}
      {actions && children && createPortal(children, actions)}
    </>
  )
}

/** The open block's title, written in place. Enter or leaving keeps it; Escape puts it back. */
function TitleInput({ value, onRename }: { value: string; onRename(title: string): Promise<void> }) {
  const [text, setText] = useState(value)
  const done = () => { const t = text.trim(); if (t && t !== value) void onRename(t); else setText(value) }
  return (
    <input aria-label="Title" value={text} onChange={e => setText(e.target.value)} onBlur={done} size={Math.max(4, text.length)}
      onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { setText(value); requestAnimationFrame(() => (e.target as HTMLInputElement).blur()) } }}
      className="min-w-0 rounded-md bg-transparent px-1 -mx-1 font-medium outline-none hover:bg-muted focus:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40" />
  )
}

/** A page of the site in the reader: the whole page, live, at the reader's width, as a browser shows it. */
function PageReader({ path, site, onClose, actions, src, external }: { path: string; site?: string; onClose(): void; actions?: React.ReactNode
  /** A page that isn't the site's: its own address, shown as the web serves it. */
  src?: string; external?: boolean }) {
  const address = src ?? siteUrl(path)
  const [pointing, setPointing] = useState(false)
  // Your site's own page follows its files: a change saved by you or your agent shows at once.
  useEffect(() => (external ? undefined : followChanges(() => frame.current)), [external])
  const frame = useRef<HTMLIFrameElement>(null)
  return (
    <div role="dialog" aria-label={path} className="absolute inset-0 flex min-h-0 flex-col bg-card">
      {/* The page fills the window; its controls float over its top right corner, frosted, as floating controls are. */}
      <div className="frost absolute top-3 right-3 z-20 flex items-center gap-0.5 rounded-full p-1 shade-3">
        {/* Point at something on the page; your coding agent reads it with site_pointed. */}
        {!external && <Button size="icon-sm" variant="ghost" aria-label="Point at something for your agent" aria-pressed={pointing} onClick={() => setPointing(p => !p)}><Icon icon={MousePointerClickIcon} /></Button>}
        {actions}
        <Button size="icon-sm" variant="ghost" aria-label="Reload" onClick={() => frame.current?.contentWindow?.location.reload()}><Icon icon={RotateCwIcon} /></Button>
        <Button size="icon-sm" variant="ghost" aria-label={`Open in a new tab${site ? `, as on ${site}` : ""}`} onClick={() => window.open(address, "_blank", "noopener")}><Icon icon={ExternalLinkIcon} /></Button>
        <Button size="icon-sm" variant="ghost" aria-label="Close" onClick={onClose}><Icon icon={XIcon} /></Button>
      </div>
      <iframe ref={frame} src={address} title={path} className="min-h-0 flex-1 border-0 bg-white" />
      {!external && <LiveLayer frame={frame} pointing={pointing} onPointed={() => setPointing(false)} />}
      {/* Many sites don't let themselves be shown inside another page; then it opens in a tab of its own. */}
      {external && <p className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-small text-muted-foreground">If the page stays blank, its site doesn't allow being shown here: open it in a new tab.</p>}
    </div>
  )
}

/** A channel opened from the canvas: its header (● name count), then everything it holds as a masonry of tiles. */
function ChannelReader({ name, content, colors, onClose }: { name: string; content: SiteContent | null; colors: Record<string, string>; onClose(): void }) {
  const [outer, inner] = name.split("/")
  const c = content?.collections.find(x => x.name === outer)
  const items = c ? (inner ? c.items.filter(i => i.channel === inner) : c.items) : []
  const mark = readMark(colors[name] ?? colors[outer])
  return (
    <div role="dialog" aria-label={name} className="absolute inset-0 flex min-h-0 flex-col bg-card">
      <header className="flex h-14 shrink-0 items-center gap-2 px-5">
        <span aria-hidden className="size-2.5 rounded-full" style={{ backgroundColor: mark ? markColor(mark.key) : "var(--foreground)" }} />
        <h2 className="text-body font-semibold">{inner ?? outer}</h2>
        <span className="text-muted-foreground tabular-nums">{items.length + (name === "Artifacts" ? 1 : 0)}</span>
        <span className="flex-1" />
        <Button size="icon-sm" variant="ghost" aria-label="Close" onClick={onClose}><Icon icon={XIcon} /></Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
        {name === "Artifacts" && <div className="mb-2 aspect-[16/10] w-72"><PageTile path="index.html" title="Home" site={content?.site} /></div>}
        <div className="columns-[11rem] gap-3">{items.map(i => <Tile key={i.path} item={i} masonry />)}</div>
      </div>
    </div>
  )
}
