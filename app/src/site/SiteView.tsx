// The Site view (flows/site.md): the person's own website as an editor view. Each page is a live
// frame on a canvas that pans and zooms; a frame that is active can be reached into, to choose an
// element and to change its text. What is saved is the page's own file.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { MinusIcon, MonitorIcon, PlusIcon, SmartphoneIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Icon } from "@/components/ui/icon"
import { notify } from "@/components/ui/notice"
import { cn } from "@/lib/cn"
import { registerStepTool } from "@/webmcp"
import { useWorkspace } from "@/workspace/store"
import { withAgent } from "@/workspace/tools"
import { BlockView } from "./BlockView"
import { SyncControls } from "./SiteSync"
import { EditProblem, listPages, OPEN_BLOCK, OPEN_PAGE, addressOf, markupFor, plain, readContent, readSync, saveChange, syncStep, type Change, type SiteSync, type SiteContent, type SiteItem, type SitePage } from "./source"

type Device = "desktop" | "phone"
const DEVICES: Record<Device, { w: number; h: number }> = { desktop: { w: 1280, h: 800 }, phone: { w: 390, h: 844 } }
const GAP = 96, HEADER = 44, PER_ROW = 5, ZOOM = { min: 0.08, max: 2 }

type Camera = { x: number; y: number; k: number }
type Placed = SitePage & { x: number; y: number; group: string }
type Selection = { page: string; tag: string; text: string; editable: boolean }
/** A change the frame already shows, waiting to be saved to the page's file or discarded. */
type Pending = { page: string; label: string; change: Change; undo: () => void }
const ITEM = "application/x-ohm-site-item"

/** Front pages in one row (the home page, then each section's index), each section's other pages under it. */
function place(pages: SitePage[], device: Device): { frames: Placed[]; labels: { text: string; x: number; y: number }[] } {
  const { w, h } = DEVICES[device]
  const front = pages.filter(p => !p.path.includes("/") || /^[^/]+\/index\.html$/.test(p.path))
    .sort((a, b) => Number(a.path.includes("/")) - Number(b.path.includes("/")) || a.path.localeCompare(b.path))
  const frames: Placed[] = front.map((p, i) => ({ ...p, group: "", x: i * (w + GAP), y: 0 }))
  const labels: { text: string; x: number; y: number }[] = []
  const groups = new Map<string, SitePage[]>()
  for (const p of pages) if (!front.includes(p)) groups.set(p.path.split("/")[0], [...(groups.get(p.path.split("/")[0]) ?? []), p])
  let y = h + HEADER + GAP * 2
  for (const [group, list] of groups) {
    labels.push({ text: group, x: 0, y })
    y += 72
    list.forEach((p, i) => frames.push({ ...p, group, x: (i % PER_ROW) * (w + GAP), y: y + Math.floor(i / PER_ROW) * (h + HEADER + GAP) }))
    y += Math.ceil(list.length / PER_ROW) * (h + HEADER + GAP) + GAP
  }
  return { frames, labels }
}

const leafText = (el: Element) => el.childElementCount === 0 && !["SCRIPT", "STYLE", "TITLE"].includes(el.tagName) && plain(el.textContent ?? "") !== ""

/**
 * Reach into a framed page: mark what the pointer is over, choose on click, edit text on a
 * double-click. The page's own links and scripts don't act on these clicks.
 */
function instrument(doc: Document, accent: string, on: {
  select(sel: Omit<Selection, "page"> | null): void
  edited(change: Omit<Pending, "page">): void
  refused(why: string): void
  follow(href: string): void
  zoom(deltaY: number): void
}) {
  const style = doc.createElement("style")
  style.textContent = `
    * { cursor: default !important; }
    [data-ohm-over] { outline: 1px solid ${accent} !important; outline-offset: 2px !important; }
    [data-ohm-chosen] { outline: 2px solid ${accent} !important; outline-offset: 2px !important; }
    [data-ohm-drop] { outline: 2px dashed ${accent} !important; outline-offset: 2px !important; }
    :not(img)[data-ohm-drop] { box-shadow: 0 6px 0 -2px ${accent} !important; }
    [contenteditable] { cursor: text !important; }
    /* haeinjung.com's pointer circle and its opening screen get in the way of editing. */
    .site-cursor { display: none !important; }
  `
  doc.head.append(style)
  // A page that opens behind a splash: step past it with the page's own button, so its own reveal runs.
  doc.getElementById("splash-name")?.click()

  const mark = (attr: string, el: Element | null) => {
    doc.querySelectorAll(`[${attr}]`).forEach(e => e.removeAttribute(attr))
    el?.setAttribute(attr, "")
  }
  let editing: HTMLElement | null = null

  doc.addEventListener("mouseover", e => { if (!editing) mark("data-ohm-over", e.target as Element) }, true)
  doc.addEventListener("mouseleave", () => mark("data-ohm-over", null))
  doc.addEventListener("wheel", e => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); on.zoom(e.deltaY) } }, { passive: false, capture: true })
  doc.addEventListener("click", e => {
    const el = e.target as HTMLElement
    if (editing?.contains(el)) return
    e.preventDefault(); e.stopPropagation()
    const link = el.closest("a[href]") as HTMLAnchorElement | null
    if (link && (e.metaKey || e.ctrlKey)) return on.follow(link.href)
    mark("data-ohm-chosen", el)
    on.select({ tag: el.tagName.toLowerCase(), text: plain(el.textContent ?? "").slice(0, 120), editable: leafText(el) })
  }, true)
  doc.addEventListener("dblclick", e => {
    const el = e.target as HTMLElement
    if (editing || !leafText(el)) return
    e.preventDefault(); e.stopPropagation()
    const before = el.textContent ?? ""
    const same = [...doc.querySelectorAll("body *")].filter(other => leafText(other) && plain(other.textContent ?? "") === plain(before))
    editing = el
    el.contentEditable = "plaintext-only"
    el.focus()
    const done = (keep: boolean) => {
      el.removeEventListener("blur", onBlur); el.removeEventListener("keydown", onKey)
      el.removeAttribute("contenteditable"); editing = null
      const after = el.textContent ?? ""
      if (!keep || plain(after) === plain(before) || !plain(after)) { el.textContent = before; return }
      on.edited({ label: "Text changed", change: { type: "text", before, after, nth: same.indexOf(el), count: same.length }, undo: () => { el.textContent = before } })
    }
    const onBlur = () => done(true)
    const onKey = (k: KeyboardEvent) => {
      if (k.key === "Escape") { k.preventDefault(); done(false) }
      if (k.key === "Enter" && !k.shiftKey) { k.preventDefault(); el.blur() }
    }
    el.addEventListener("blur", onBlur); el.addEventListener("keydown", onKey)
  }, true)

  // A block dragged from the side panel. It lands after an element that holds only text, or, an
  // image on an image, takes that image's place. The frame shows it at once; saving writes it.
  const landing = (el: Element | null, types: readonly string[]) =>
    !types.includes(ITEM) || !el ? null : el.tagName === "IMG" ? el as HTMLElement : leafText(el) ? el as HTMLElement : null
  doc.addEventListener("dragover", e => {
    const to = landing(e.target as Element, e.dataTransfer?.types ?? [])
    mark("data-ohm-drop", to)
    if (to) { e.preventDefault(); e.dataTransfer!.dropEffect = "copy" }
  }, true)
  doc.addEventListener("dragleave", e => { if (!e.relatedTarget) mark("data-ohm-drop", null) }, true)
  doc.addEventListener("drop", e => {
    const to = landing(e.target as Element, e.dataTransfer?.types ?? [])
    mark("data-ohm-drop", null)
    if (!to) return
    e.preventDefault(); e.stopPropagation()
    const item = JSON.parse(e.dataTransfer!.getData(ITEM)) as SiteItem
    if (to.tagName === "IMG") {
      const from = to.getAttribute("src") ?? ""
      if (item.kind !== "image" || !from) return on.refused("Only an image can take an image's place")
      to.setAttribute("src", addressOf(item.path))
      return on.edited({ label: "Image swapped", change: { type: "src", from, to: addressOf(item.path) }, undo: () => to.setAttribute("src", from) })
    }
    const anchor = to.textContent ?? ""
    const same = [...doc.querySelectorAll("body *")].filter(other => leafText(other) && plain(other.textContent ?? "") === plain(anchor))
    const html = markupFor(item)
    const holder = doc.createElement("template")
    holder.innerHTML = html
    const placed = holder.content.firstElementChild!
    to.after(placed)
    on.edited({ label: `${item.kind === "image" ? "Image" : item.kind === "video" ? "Video" : "Link"} added`, change: { type: "insert", anchor, html, nth: same.indexOf(to), count: same.length }, undo: () => placed.remove() })
  }, true)
}

export function SiteView() {
  const { agentsAllowed } = useWorkspace()
  const [pages, setPages] = useState<SitePage[] | null>(null)
  const [content, setContent] = useState<SiteContent | null>(null)
  /** The block that is open over the canvas, by its path. */
  const [block, setBlock] = useState<string | null>(null)
  const [failed, setFailed] = useState("")
  const [device, setDevice] = useState<Device>("desktop")
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, k: 0.5 })
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [active, setActive] = useState<string | null>(null)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [reloads, setReloads] = useState<Record<string, number>>({})
  const [shown, setShown] = useState<Set<string>>(new Set())
  const stage = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null)
  const fitted = useRef("")
  const moved = useRef(false)

  useEffect(() => { listPages().then(setPages, e => setFailed((e as Error).message)) }, [])
  useEffect(() => { readContent().then(setContent, () => {}) }, [])
  const [sync, setSync] = useState<SiteSync | null>(null)
  const [syncing, setSyncing] = useState(false)
  /** Every frame reads its page again after the folder changed under it. */
  const [turn, setTurn] = useState(0)
  const refreshSync = useCallback(() => readSync().then(setSync, () => setSync(null)), [])
  useEffect(() => { void refreshSync() }, [refreshSync])

  /** One handler for Pull and Commit and their tools, and for Publish, which has no tool. */
  const step = useCallback(async (which: "pull" | "commit" | "push", message?: string) => {
    setSyncing(true)
    try {
      const before = await readSync()
      const now = await syncStep(which, message)
      setSync(now)
      if (which === "pull") {
        const pages = await listPages()
        setPages(pages); setContent(await readContent()); setTurn(t => t + 1)
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
  const { frames, labels } = useMemo(() => place(pages ?? [], device), [pages, device])
  const { w: fw, h: fh } = DEVICES[device]

  useLayoutEffect(() => {
    const el = stage.current
    if (!el) return
    const watch = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    watch.observe(el)
    return () => watch.disconnect()
  }, [pages])

  /** Bring one frame, or the whole front row, into view. */
  const fit = useCallback((path?: string) => {
    if (!size.w) return
    const target = path ? frames.filter(f => f.path === path) : frames.filter(f => !f.group)
    if (!target.length) return
    const x0 = Math.min(...target.map(f => f.x)), x1 = Math.max(...target.map(f => f.x + fw))
    const y0 = Math.min(...target.map(f => f.y)), y1 = Math.max(...target.map(f => f.y + fh + HEADER))
    const k = Math.max(ZOOM.min, Math.min(1, (size.w - 96) / (x1 - x0), (size.h - 96) / (y1 - y0)))
    setCamera({ k, x: (size.w - (x1 - x0) * k) / 2 - x0 * k, y: (size.h - (y1 - y0) * k) / 2 - y0 * k })
  }, [frames, fw, fh, size])

  // Until the person moves the canvas, it keeps the front row in view, whatever size the panel settles at.
  useEffect(() => {
    const key = `${device}:${frames.length}:${size.w}x${size.h}`
    if (size.w && frames.length && !moved.current && fitted.current !== key) { fitted.current = key; fit() }
  }, [device, frames.length, size, fit])

  const zoomAt = useCallback((factor: number, px: number, py: number) => setCamera(c => {
    moved.current = true
    const k = Math.max(ZOOM.min, Math.min(ZOOM.max, c.k * factor))
    return { k, x: px - (px - c.x) * (k / c.k), y: py - (py - c.y) * (k / c.k) }
  }), [])

  useEffect(() => {
    const el = stage.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const box = el.getBoundingClientRect()
      if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX - box.left, e.clientY - box.top)
      else { moved.current = true; setCamera(c => ({ ...c, x: c.x - e.deltaX, y: c.y - e.deltaY })) }
    }
    el.addEventListener("wheel", onWheel, { passive: false })
    return () => el.removeEventListener("wheel", onWheel)
  }, [zoomAt, pages])

  // A page's frame loads the first time it comes near the view, and stays.
  useEffect(() => {
    if (!size.w) return
    const near = frames.filter(f => {
      const x = f.x * camera.k + camera.x, y = f.y * camera.k + camera.y
      return x < size.w + 200 && x + fw * camera.k > -200 && y < size.h + 200 && y + (fh + HEADER) * camera.k > -200
    }).map(f => f.path).filter(p => !shown.has(p))
    if (near.length) setShown(new Set([...shown, ...near]))
  }, [frames, camera, size, fw, fh, shown])

  const openPage = useCallback((path: string) => {
    if (!frames.some(f => f.path === path)) throw new DOMException("That page isn't in the site", "DataError")
    moved.current = true
    setActive(path); fit(path)
    return { page: path }
  }, [frames, fit])

  /** One handler for a tile's click and the `site.open-block` tool. */
  const openBlock = useCallback((path: string) => {
    const found = content?.collections.some(c => c.items.some(i => i.path === path))
    if (!found) throw new DOMException("That block isn't in the site", "DataError")
    setBlock(path)
    return { block: path }
  }, [content])
  useEffect(() => {
    const onAsk = (e: Event) => { try { openBlock((e as CustomEvent<string>).detail) } catch { /* not a block of this site */ } }
    window.addEventListener(OPEN_BLOCK, onAsk)
    return () => window.removeEventListener(OPEN_BLOCK, onAsk)
  }, [openBlock])
  const opened = useMemo(() => {
    for (const c of content?.collections ?? []) {
      const at = c.items.findIndex(i => i.path === block)
      if (at >= 0) return { item: c.items[at], items: c.items, channel: { name: c.name || "Pages", at, of: c.items.length } }
    }
    return null
  }, [content, block])
  const stepBlock = useCallback((by: -1 | 1) => { const next = opened?.items[opened.channel.at + by]; if (next) setBlock(next.path) }, [opened])
  const closeBlock = useCallback(() => setBlock(null), [])

  // A page tile in the side panel opens its frame here.
  useEffect(() => {
    const onAsk = (e: Event) => { try { openPage((e as CustomEvent<string>).detail) } catch { /* not a page of this site */ } }
    window.addEventListener(OPEN_PAGE, onAsk)
    return () => window.removeEventListener(OPEN_PAGE, onAsk)
  }, [openPage])

  /** One handler for the Save button and the tools that change a page (`site.edit-text`, `site.place-block`). */
  const save = useCallback(async (page: string, change: Change) => {
    await saveChange(page, change)
    void refreshSync()
    notify({ message: `Saved to ${page}. It is on your computer only until you publish your site.` })
    return { page, saved: true }
  }, [refreshSync])
  /** A tool's change isn't in the frame yet, so the frame reads its page again. */
  const saveAndShow = useCallback(async (page: string, change: Change) => {
    try {
      const out = await save(page, change)
      setReloads(r => ({ ...r, [page]: (r[page] ?? 0) + 1 }))
      return out
    } catch (e) {
      throw e instanceof EditProblem ? new DOMException(e.message, "DataError") : e
    }
  }, [save])

  const onSave = async () => {
    if (!pending) return
    try { await save(pending.page, pending.change); setPending(null) }
    catch (e) { pending.undo(); setPending(null); notify({ message: (e as Error).message, tone: "error" }) }
  }

  useEffect(() => {
    if (!agentsAllowed || !pages) return
    const ac = new AbortController()
    const page = { type: "string", minLength: 1, maxLength: 300 } as const
    registerStepTool({
      name: "site.pages", title: "Pages",
      description: "Lists the pages of the person's website that the Site view shows, each with its path and title.",
      annotations: { readOnlyHint: true },
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      run: withAgent("Reading your site's pages", async () => ({ pages })),
    }, ac.signal).catch(console.error)
    registerStepTool<{ page: string }, { page: string }>({
      name: "site.open-page", title: "Open page",
      description: "Brings one page's frame into view on the canvas and makes it the active frame. Returns the page's path.",
      annotations: { readOnlyHint: true },
      inputSchema: { type: "object", properties: { page }, required: ["page"], additionalProperties: false },
      run: withAgent("Opening a page of your site", async (input: { page: string }) => openPage(input.page)),
    }, ac.signal).catch(console.error)
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
        const item = content?.collections.flatMap(c => c.items).find(i => i.path === input.block)
        if (!item) throw new DOMException("That block isn't in the site", "DataError")
        if (Boolean(input.after) === Boolean(input.replace)) throw new DOMException("Say one of `after` or `replace`", "DataError")
        if (input.replace && item.kind !== "image") throw new DOMException("Only an image can take an image's place", "DataError")
        return saveAndShow(input.page, input.replace
          ? { type: "src", from: input.replace, to: addressOf(item.path) }
          : { type: "insert", anchor: input.after!, html: markupFor(item), nth: input.nth })
      }),
    }, ac.signal).catch(console.error)
    const stood = { type: "object", properties: {}, additionalProperties: false } as const
    const failing = (e: unknown) => { throw new DOMException((e as Error).message, "OperationError") }
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
  }, [agentsAllowed, pages, content, openPage, openBlock, saveAndShow, step])

  if (failed) return <Empty className="flex-1"><EmptyHeader><EmptyTitle>Your site couldn't be opened</EmptyTitle><EmptyDescription>{failed}</EmptyDescription></EmptyHeader></Empty>
  if (!pages) return <div className="flex-1" aria-busy />
  if (!pages.length) return <Empty className="flex-1"><EmptyHeader><EmptyTitle>No pages yet</EmptyTitle><EmptyDescription>The site's folder has no pages that are committed.</EmptyDescription></EmptyHeader></Empty>

  const accent = getComputedStyle(document.documentElement).getPropertyValue("--primary").trim() || "currentColor"

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {opened && (
        <BlockView item={opened.item} channel={opened.channel} onStep={stepBlock} onClose={closeBlock} onSave={save}
          titleOf={path => pages.find(p => p.path === path)?.title || path}
          onShowPage={path => { setBlock(null); try { openPage(path) } catch { /* a page that is no longer there */ } }} />
      )}
      <header className="flex h-14 shrink-0 items-center gap-3 px-5">
        <span className="text-small font-medium">Site</span>
        <span className="min-w-0 flex-1 truncate text-small text-muted-foreground">
          {selection ? <>{selection.page} · {selection.tag}{selection.text && <> · “{selection.text}”</>}{selection.editable && " · double-click to change the text"}</>
            : active ? <>{active} · click an element to choose it</> : <>{pages.length} pages · click a page to work in it</>}
        </span>
        <SyncControls sync={sync} busy={syncing} onPull={() => stepByHand("pull")} onCommit={message => stepByHand("commit", message)} onPublish={() => stepByHand("push")} />
        <Button size="icon-sm" variant="ghost" aria-label="Desktop width" aria-pressed={device === "desktop"} className="aria-pressed:bg-muted" onClick={() => setDevice("desktop")}><Icon icon={MonitorIcon} /></Button>
        <Button size="icon-sm" variant="ghost" aria-label="Phone width" aria-pressed={device === "phone"} className="aria-pressed:bg-muted" onClick={() => setDevice("phone")}><Icon icon={SmartphoneIcon} /></Button>
        <Button size="icon-sm" variant="ghost" aria-label="Zoom out" onClick={() => zoomAt(1 / 1.25, size.w / 2, size.h / 2)}><Icon icon={MinusIcon} /></Button>
        <span className="w-10 text-center text-small text-muted-foreground tabular-nums">{Math.round(camera.k * 100)}%</span>
        <Button size="icon-sm" variant="ghost" aria-label="Zoom in" onClick={() => zoomAt(1.25, size.w / 2, size.h / 2)}><Icon icon={PlusIcon} /></Button>
        <Button size="sm" variant="ghost" onClick={() => { moved.current = true; fit(active ?? undefined) }}>Fit</Button>
      </header>

      <div ref={stage} className="relative min-h-0 flex-1 touch-none overflow-hidden bg-muted"
        onPointerDown={e => {
          // Panning starts on the canvas itself; a frame or the save bar keeps its own clicks.
          if ((e.target as HTMLElement).closest("[data-frame], [data-bar]")) return
          e.currentTarget.setPointerCapture(e.pointerId)
          drag.current = { x: e.clientX, y: e.clientY, cx: camera.x, cy: camera.y }
          moved.current = true
          setActive(null); setSelection(null)
        }}
        onPointerMove={e => { const d = drag.current; if (d) setCamera(c => ({ ...c, x: d.cx + e.clientX - d.x, y: d.cy + e.clientY - d.y })) }}
        onPointerUp={() => { drag.current = null }}>
        <div className="absolute top-0 left-0 origin-top-left" style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.k})` }}>
          {labels.map(l => (
            <div key={l.text} className="absolute text-muted-foreground" style={{ left: l.x, top: l.y, fontSize: 40, lineHeight: 1 }}>{l.text}</div>
          ))}
          {frames.map(f => (
            <section key={f.path} data-frame aria-label={f.title || f.path} className="absolute" style={{ left: f.x, top: f.y, width: fw }}>
              <button type="button" onClick={() => setActive(f.path)} onDoubleClick={() => { moved.current = true; fit(f.path) }}
                className={cn("flex w-full items-baseline gap-3 truncate text-left outline-none", active === f.path ? "text-foreground" : "text-muted-foreground")}
                style={{ height: HEADER, fontSize: 22 }}>
                <span className="truncate font-medium">{f.title || f.path}</span>
                <span className="truncate opacity-70">{f.path}</span>
              </button>
              <div className={cn("relative overflow-hidden rounded-lg bg-background", active === f.path && "ring-4 ring-primary")} style={{ height: fh }}>
                {shown.has(f.path) && (
                  <iframe key={`${device}:${turn}:${reloads[f.path] ?? 0}`} title={f.title || f.path} src={`/site/${f.path}`} className="block size-full"
                    onLoad={e => {
                      const doc = e.currentTarget.contentDocument
                      if (!doc) return
                      instrument(doc, accent, {
                        select: sel => setSelection(sel && { ...sel, page: f.path }),
                        // One change waits at a time: a second one first puts the frame back as it was.
                        edited: change => setPending(was => { was?.undo(); return { ...change, page: f.path } }),
                        refused: why => notify({ message: why, tone: "error" }),
                        follow: href => {
                          const path = new URL(href).pathname.replace(/^\/site\//, "/").replace(/^\//, "")
                          const to = frames.find(o => o.path === path || o.path === `${path.replace(/\/$/, "")}/index.html`.replace(/^\//, "") || o.path === `${path}.html`)
                          if (to) { setActive(to.path); fit(to.path) }
                        },
                        zoom: deltaY => zoomAt(Math.exp(-deltaY * 0.01), size.w / 2, size.h / 2),
                      })
                    }} />
                )}
                {/* A frame that isn't active is a picture of its page: one click makes it the one you work in. */}
                {active !== f.path && <button type="button" aria-label={`Work in ${f.title || f.path}`} className="absolute inset-0 outline-none" onClick={() => { setActive(f.path); setSelection(null) }} onDoubleClick={() => fit(f.path)}
                  // A block dragged over a frame makes it the active one, so the page itself can take the drop.
                  onDragEnter={e => { if (e.dataTransfer.types.includes(ITEM)) setActive(f.path) }} />}
              </div>
            </section>
          ))}
        </div>

        {pending && (
          <div role="status" data-bar className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-2xl bg-card py-2 ps-4 pe-2 text-small shade-2">
            <span>{pending.label} in {pending.page}</span>
            <Button size="sm" variant="ghost" onClick={() => { pending.undo(); setPending(null) }}>Discard</Button>
            <Button size="sm" onClick={() => void onSave()}>Save</Button>
          </div>
        )}
      </div>
    </div>
  )
}
