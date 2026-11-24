// The ⋯ on a block in the home, as a session list has it: it shows on hover (and right-click opens
// the same menu), and its single-key shortcuts work while the menu is open or the row has focus.
// Open in ›, Pin, Mark as unread, Rename (in place), Move to ›, Channels ›, Archive, Delete.
// Beside it on a block, a dot: click it for the block's connections card, or pull a line from it to
// another block to connect them (ConnectionsCard).
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { EllipsisIcon } from "lucide-react"
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuShortcut,
  DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Icon } from "@/components/ui/icon"
import { notify } from "@/components/ui/notice"
import { isBlock, locationOf, byId, channelRecords, channelsOf, docIdOf, placedIn, blocks, titleOf } from "@/data/workspace-data"
import {
  collect, createDraft, deleteChannel, marks, moveBlock, open, report, uncollect, setRepoMode, showGraph, toggleArchive, togglePin, toggleUnread, useWorkspace,
} from "./store"
import { InlineRename, InlineRenameChannel, requestDelete, startChannel } from "./PageActions"
import { useLinkedHover } from "@/editor/LinkPreview"
import { ConnectionsButton } from "@/editor/ConnectionsCard"

type Row = { id: string; top: number; height: number; textLeft: number }
const isPage = (id?: string) => !!id && !id.includes(":") && !!byId(docIdOf(id))
/** A vault channel row: `vault:channel` or `vault:channel/inner`. Cortex categories are fixed. */
const folderPath = (id?: string) => (id?.startsWith("vault:") ? id.slice(6) : null)
const isTarget = (id?: string) => isPage(id) || !!folderPath(id)
/** Whether a channel holds no blocks and no channels. */
const isEmpty = (path: string) =>
  !blocks.some(p => channelsOf(p).some(c => c === path || c.startsWith(`${path}/`))) && !channelRecords.some(c => c.path.startsWith(`${path}/`))

export function RowMenu({ container }: { container: HTMLElement | null }) {
  const { rev } = useWorkspace()
  const linked = useLinkedHover()
  const [row, setRow] = useState<Row | null>(null)
  const [menuOpen, setMenuVisible] = useState(false)
  const [cardOpen, setCardOpen] = useState(false)
  const [linking, setLinking] = useState(false)
  // Something open over a row holds it still: the menu, the connections card, a line being pulled from
  // its dot, or renaming.
  const held = menuOpen || cardOpen || linking
  const [renaming, setRenaming] = useState<string | null>(null)
  const renameFromMenu = useRef(false)
  const setMenuOpen = (open: boolean) => {
    if (open) renameFromMenu.current = false
    setMenuVisible(open)
  }
  const startRename = (rowId: string) => {
    // The inline field takes focus. The menu must not return focus to the row on close.
    renameFromMenu.current = menuOpen
    setRenaming(rowId)
    setMenuOpen(false)
  }

  const place = useCallback((el: HTMLElement) => {
    if (!container) return
    const base = container.getBoundingClientRect(), r = el.getBoundingClientRect()
    // Where the row's name starts, so renaming in place lines up with it.
    const label = el.querySelector<HTMLElement>("span.truncate") ?? el
    setRow({ id: el.dataset.id!, top: r.top - base.top + container.scrollTop, height: r.height, textLeft: label.getBoundingClientRect().left - base.left })
  }, [container])

  // A new channel asks to be renamed at once.
  useEffect(() => {
    const rename = (e: Event) => {
      const { id } = (e as CustomEvent<{ id: string }>).detail
      const el = container?.querySelector<HTMLElement>(`[data-slot=file-tree-item][data-id="${CSS.escape(id)}"]`)
      if (!el) return
      place(el)
      setRenaming(id)
    }
    window.addEventListener("ohm:rename-row", rename)
    return () => window.removeEventListener("ohm:rename-row", rename)
  }, [container, place])

  // Follow the pointer over block rows; hold still while the menu is open.
  useEffect(() => {
    if (!container) return
    const rowOf = (t: EventTarget | null) => (t as HTMLElement | null)?.closest<HTMLElement>("[data-row-id], [data-slot=file-tree-item]")
    const move = (e: PointerEvent) => {
      if (held || renaming) return
      if ((e.target as HTMLElement).closest("[data-row-menu]")) return
      const el = rowOf(e.target)
      const id = el?.dataset.rowId ?? el?.dataset.id
      if (el && isTarget(id)) { el.dataset.id = id; place(el) } else setRow(null)
    }
    const leave = () => { if (!held && !renaming) setRow(null) }
    const context = (e: MouseEvent) => {
      const el = rowOf(e.target)
      const id = el?.dataset.rowId ?? el?.dataset.id
      if (!el || !isTarget(id)) return
      e.preventDefault()
      el.dataset.id = id
      place(el)
      setMenuOpen(true)
    }
    // Shortcuts on a focused row, without opening the menu.
    const key = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || held || renaming) return
      const el = rowOf(e.target)
      const id = el?.dataset.rowId ?? el?.dataset.id
      if (!isTarget(id)) return
      if (run(e.key.toLowerCase(), id!)) { e.preventDefault(); place(el!) }
    }
    container.addEventListener("pointermove", move)
    container.addEventListener("pointerleave", leave)
    container.addEventListener("contextmenu", context)
    container.addEventListener("keydown", key)
    return () => {
      container.removeEventListener("pointermove", move)
      container.removeEventListener("pointerleave", leave)
      container.removeEventListener("contextmenu", context)
      container.removeEventListener("keydown", key)
    }
  }) // re-binds with the latest state

  // Unread blocks show in weight; the tree is ohm-ui's, so the mark goes on by attribute.
  useEffect(() => {
    container?.querySelectorAll<HTMLElement>("[data-slot=file-tree-item]").forEach(el => {
      const id = docIdOf(el.dataset.id ?? "")
      el.toggleAttribute("data-unread", marks.unread.has(id))
      // The block a hovered [[link]] points to, shaded green, in every channel it is in.
      el.toggleAttribute("data-linked", !!linked && id === linked)
    })
  })

  /** Paths of the channels in this home. */
  const channels = useMemo(() => {
    const set = new Set<string>()
    for (const p of blocks) for (const c of channelsOf(p)) { set.add(c.split("/")[0]); set.add(c) }
    // Channels are records: an empty one is offered too.
    for (const c of channelRecords) set.add(c.path)
    return [...set].sort()
  }, [rev]) // eslint-disable-line react-hooks/exhaustive-deps

  /** One letter, one action. Returns whether it did something. */
  function run(k: string, rowId: string): boolean {
    const folder = folderPath(rowId)
    if (folder) {
      if (k === "r") { startRename(rowId); return true }
      if (k === "c" && !folder.includes("/")) { setMenuOpen(false); startChannel(folder); return true }
      if (k === "d") {
        setMenuOpen(false)
        deleteChannel(folder)
          .then(() => notify({ message: `Deleted the empty channel ${folder.replace("/", " › ")}`, tone: "info" }))
          .catch(err => notify({ message: (err as Error).message }))
        return true
      }
      if (k === "n") {
        void report(createDraft({ homeChannel: folder }))
        setMenuOpen(false)
        return true
      }
      return false
    }
    const id = docIdOf(rowId)
    const doc = byId(id)
    if (!doc) return false
    const post = isBlock(doc)
    const done = (message: string) => notify({ message, tone: "info" })
    switch (k) {
      case "p": togglePin(id); done(marks.pinned.has(id) ? `Pinned “${titleOf(doc)}”` : `Unpinned “${titleOf(doc)}”`); break
      case "u": toggleUnread(id); break
      case "r": if (!post) return false; startRename(rowId); return true
      case "a": if (!post) return false; toggleArchive(id); done(marks.archived.has(id) ? `Archived “${titleOf(doc)}”` : `Restored “${titleOf(doc)}”`); break
      case "d": if (!post && doc.kind !== "observation" && doc.kind !== "skill") return false; requestDelete(id); break
      default: return false
    }
    setMenuOpen(false)
    return true
  }

  const folder = row ? folderPath(row.id) : null
  const doc = row && !folder ? byId(docIdOf(row.id)) : undefined
  /** The channel this row shows the block in, when it is not its section. */
  const placed = row ? placedIn(row.id) : null
  const post = isBlock(doc)
  const here = doc ? locationOf(doc) : ""

  return <>
    {row && folder && !renaming && (
      <div data-row-menu className="pointer-events-none absolute inset-x-0 z-10" style={{ top: row.top, height: row.height }}>
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger render={
            <button type="button" aria-label={`More for channel “${folder.split("/").at(-1)}”`}
              className="pointer-events-auto absolute top-1/2 right-1 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors duration-(--ohm-duration-press) animate-in fade-in-0 hover:bg-foreground/10 hover:text-foreground aria-expanded:bg-foreground/10 aria-expanded:text-foreground" />
          }>
            <Icon icon={EllipsisIcon} size="sm" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="right" sideOffset={6} className="w-56" finalFocus={() => !renameFromMenu.current}
            onKeyDown={e => { if (!e.metaKey && !e.ctrlKey && !e.altKey && e.key.length === 1 && run(e.key.toLowerCase(), row.id)) e.preventDefault() }}>
            <DropdownMenuItem onClick={() => run("n", row.id)}>New block here<DropdownMenuShortcut>N</DropdownMenuShortcut></DropdownMenuItem>
            {!folder.includes("/") && <DropdownMenuItem onClick={() => run("c", row.id)}>New channel inside<DropdownMenuShortcut>C</DropdownMenuShortcut></DropdownMenuItem>}
            <DropdownMenuItem onClick={() => run("r", row.id)}>Rename<DropdownMenuShortcut>R</DropdownMenuShortcut></DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" disabled={!isEmpty(folder)} onClick={() => run("d", row.id)}>
              {isEmpty(folder) ? "Delete channel" : "Delete (empty it first)"}<DropdownMenuShortcut>D</DropdownMenuShortcut>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    )}
    {row && doc && !renaming && (
      <div data-row-menu className="pointer-events-none absolute inset-x-0 z-10" style={{ top: row.top, height: row.height }}>
        {post && (
          <ConnectionsButton doc={doc} editable={doc.visibility === "private"} variant="dot" open={cardOpen} onOpenChange={setCardOpen} onLinking={setLinking}
            className="pointer-events-auto absolute top-1/2 right-8 -translate-y-1/2" />
        )}
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger render={
            <button type="button" aria-label={`More for “${titleOf(doc)}”`}
              className="pointer-events-auto absolute top-1/2 right-1 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors duration-(--ohm-duration-press) animate-in fade-in-0 hover:bg-foreground/10 hover:text-foreground aria-expanded:bg-foreground/10 aria-expanded:text-foreground" />
          }>
            <Icon icon={EllipsisIcon} size="sm" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="right" sideOffset={6} className="w-60" finalFocus={() => !renameFromMenu.current}
            onKeyDown={e => { if (!e.metaKey && !e.ctrlKey && !e.altKey && e.key.length === 1 && run(e.key.toLowerCase(), row.id)) e.preventDefault() }}>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Open in</DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-48">
                <DropdownMenuItem onClick={() => open(doc.id)}>This window</DropdownMenuItem>
                <DropdownMenuItem onClick={() => window.open(`${location.pathname}?open=${encodeURIComponent(doc.id)}`, "_blank", "noopener")}>New tab</DropdownMenuItem>
                <DropdownMenuItem onClick={() => { open(doc.id); setRepoMode("graph"); showGraph() }}>Graph</DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => run("p", doc.id)}>{marks.pinned.has(doc.id) ? "Unpin" : "Pin"}<DropdownMenuShortcut>P</DropdownMenuShortcut></DropdownMenuItem>
            <DropdownMenuItem onClick={() => run("u", doc.id)}>{marks.unread.has(doc.id) ? "Mark as read" : "Mark as unread"}<DropdownMenuShortcut>U</DropdownMenuShortcut></DropdownMenuItem>
            <DropdownMenuItem disabled={!post} onClick={() => run("r", row.id)}>Rename<DropdownMenuShortcut>R</DropdownMenuShortcut></DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger disabled={!post}>Channels</DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-72 w-52 overflow-y-auto">
                {channels.map(c => {
                  const home = doc.homeChannel === c
                  return (
                    <DropdownMenuCheckboxItem key={c} disabled={home} checked={home || !!doc.channels?.includes(c)} onCheckedChange={on => {
                      void report((on ? collect(doc.id, c) : uncollect(doc.id, c)).then(() =>
                        notify({ message: `${on ? "Added to" : "Removed from"} ${c.replace("/", " › ")}`, tone: "info" })))
                    }}>{c.replace("/", " › ")}</DropdownMenuCheckboxItem>
                  )
                })}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            {placed && (
              <DropdownMenuItem onClick={() => { void report(uncollect(doc.id, placed)); notify({ message: `Removed from ${placed.replace("/", " › ")}`, tone: "info" }); setMenuOpen(false) }}>
                Remove from {placed.split("/").at(-1)}
              </DropdownMenuItem>
            )}
            <DropdownMenuSub>
              <DropdownMenuSubTrigger disabled={!post}>Move to</DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-72 w-52 overflow-y-auto">
                {/* Moves this row, as dragging it does: from the channel it shows in, to another. */}
                {channels.map(f => (
                  <DropdownMenuCheckboxItem key={f} checked={f === (placed ?? here)} onCheckedChange={() => {
                    void report(moveBlock(doc.id, placed ?? here, f).then(({ published }) =>
                      notify({ message: `Moved to ${f.replace("/", " › ")}${published ? ". Its address changes when you next publish" : ""}`, tone: "info" })))
                    setMenuOpen(false)
                  }}>{f.replace("/", " › ")}</DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={!post} onClick={() => run("a", doc.id)}>{marks.archived.has(doc.id) ? "Restore" : "Archive"}<DropdownMenuShortcut>A</DropdownMenuShortcut></DropdownMenuItem>
            <DropdownMenuItem disabled={!post && doc.kind !== "observation" && doc.kind !== "skill"} variant="destructive" onClick={() => run("d", doc.id)}>{post ? "Delete" : doc.kind === "observation" ? "Forget" : "Remove"}<DropdownMenuShortcut>D</DropdownMenuShortcut></DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    )}

    {/* Renaming in place: a field over the row's name, the text selected. */}
    {renaming && row && row.id === renaming && (
      <div className="absolute inset-x-0 z-20 flex items-center" style={{ top: row.top, height: row.height, paddingInlineStart: row.textLeft - 7 }}>
        {folderPath(renaming)
          ? <InlineRenameChannel path={folderPath(renaming)!} className="me-1 h-7 flex-1 text-body" onDone={() => setRenaming(null)} />
          : <InlineRename id={docIdOf(renaming)} className="me-1 h-7 flex-1 text-body" onDone={() => setRenaming(null)} />}
      </div>
    )}
  </>
}
