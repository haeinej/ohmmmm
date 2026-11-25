// The Site view (flows/site.md): the person's own website, running, as the main screen, and what
// can be done to it from here: compose its gallery, take a move back or do it again, save, open a
// block or the profile over it, and keep the folder in step with its git remote.
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { MinusIcon, PlusIcon, Redo2Icon, Undo2Icon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Icon } from "@/components/ui/icon"
import { notify } from "@/components/ui/notice"
import { registerStepTool } from "@/webmcp"
import { useWorkspace } from "@/workspace/store"
import { withAgent } from "@/workspace/tools"
import { BlockView } from "./BlockView"
import { LiveCanvas, type LiveCanvasHandle, type LiveState } from "./LiveCanvas"
import { ProfileView } from "./ProfileView"
import { SyncControls } from "./SiteSync"
import { addressOf, EditProblem, markupFor, OPEN_BLOCK, OPEN_PROFILE, readContent, readSync, saveChange, syncStep, type Change, type SiteContent, type SiteSync } from "./source"

/** The page the canvas opens on: the gallery, which holds every photograph, writing and project. */
const START = "/site/archive/index.html"
const ZOOMS = [0.33, 0.5, 0.67, 0.8, 1]

export function SiteView() {
  const { agentsAllowed } = useWorkspace()
  const canvas = useRef<LiveCanvasHandle>(null)
  const [content, setContent] = useState<SiteContent | null>(null)
  const [live, setLive] = useState<LiveState>({ page: "", moves: [], canUndo: false, canRedo: false })
  const [zoom, setZoom] = useState(1)
  const [saving, setSaving] = useState(false)
  /** The block that is open over the canvas, by its path. */
  const [block, setBlock] = useState<string | null>(null)
  const [profileOpen, setProfileOpen] = useState(false)
  const [sync, setSync] = useState<SiteSync | null>(null)
  const [syncing, setSyncing] = useState(false)

  useEffect(() => { readContent().then(setContent, e => notify({ message: (e as Error).message, tone: "error" })) }, [])
  const refreshSync = useCallback(() => readSync().then(setSync, () => setSync(null)), [])
  useEffect(() => { void refreshSync() }, [refreshSync])

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
      if (which === "push") notify({ message: "Published. Your live site follows in a minute or two.", tone: "info" })
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
    window.addEventListener(OPEN_BLOCK, onBlock)
    window.addEventListener(OPEN_PROFILE, onProfile)
    return () => { window.removeEventListener(OPEN_BLOCK, onBlock); window.removeEventListener(OPEN_PROFILE, onProfile) }
  }, [openBlock])
  const opened = useMemo(() => {
    for (const c of content?.collections ?? []) {
      const at = c.items.findIndex(i => i.path === block)
      if (at >= 0) return { item: c.items[at], items: c.items, channel: { name: c.name, at, of: c.items.length } }
    }
    return null
  }, [content, block])
  const stepBlock = useCallback((by: -1 | 1) => { const next = opened?.items[opened.channel.at + by]; if (next) setBlock(next.path) }, [opened])
  const closeBlock = useCallback(() => setBlock(null), [])
  const closeProfile = useCallback(() => setProfileOpen(false), [])

  // ⌘Z and ⇧⌘Z take a move back and do it again, while nothing is being written in.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z" || (e.target as HTMLElement).closest?.("[contenteditable], input, textarea")) return
      e.preventDefault()
      if (e.shiftKey) canvas.current?.redo(); else canvas.current?.undo()
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
    <div className="relative flex min-h-0 flex-1 flex-col">
      {profileOpen && <ProfileView onClose={closeProfile} />}
      {opened && (
        <BlockView item={opened.item} channel={opened.channel} onStep={stepBlock} onClose={closeBlock} onSave={save}
          titleOf={path => path}
          onShowPage={path => { setBlock(null); canvas.current?.go(path) }} />
      )}
      <header className="flex h-14 shrink-0 items-center gap-2 px-5">
        <span className="text-small font-medium">Site</span>
        <span className="min-w-0 flex-1 truncate text-small text-muted-foreground">
          {live.page || "Opening your site"}{live.page.startsWith("archive/") && " · drag a photograph to move it, ⌘-click to open it as a block"}
        </span>
        <Button size="icon-sm" variant="ghost" aria-label="Undo (⌘Z)" disabled={!live.canUndo} onClick={() => canvas.current?.undo()}><Icon icon={Undo2Icon} /></Button>
        <Button size="icon-sm" variant="ghost" aria-label="Redo (⇧⌘Z)" disabled={!live.canRedo} onClick={() => canvas.current?.redo()}><Icon icon={Redo2Icon} /></Button>
        <Button size="icon-sm" variant="ghost" aria-label="Zoom out" disabled={zoom === ZOOMS[0]} onClick={() => zoomBy(-1)}><Icon icon={MinusIcon} /></Button>
        <span className="w-10 text-center text-small text-muted-foreground tabular-nums">{Math.round(zoom * 100)}%</span>
        <Button size="icon-sm" variant="ghost" aria-label="Zoom in" disabled={zoom === 1} onClick={() => zoomBy(1)}><Icon icon={PlusIcon} /></Button>
        <SyncControls sync={sync} busy={syncing} onPull={() => stepByHand("pull")} onCommit={message => stepByHand("commit", message)} onPublish={() => stepByHand("push")} />
      </header>

      <LiveCanvas ref={canvas} start={START} zoom={zoom} accent={accent} onState={setLive} onOpen={openFromCanvas} />

      {live.moves.length > 0 && (
        <div role="status" className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-2xl bg-card py-2 ps-4 pe-2 text-small shade-2">
          <span>{live.moves.length === 1 ? "1 photograph moved" : `${live.moves.length} moves`} in {live.page}</span>
          <Button size="sm" variant="ghost" disabled={saving} onClick={() => canvas.current?.discard()}>Discard</Button>
          <Button size="sm" disabled={saving} onClick={() => void saveOrder()}>Save</Button>
        </div>
      )}
    </div>
  )
}
