// The block editor: a block editor in the manner of the reference recordings. The block's path on top
// (drag it out to save it as Markdown, or onto a vault channel to file it), then the title, "/" for
// commands, a floating toolbar on selected text, a handle on each block with its menu, tables with
// row and column handles, and images by dropping or pasting files. Private blocks save as you type;
// others are read-only here, because changing what other people see asks first (AGENTS.md rule 11).
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { EditorContent, useEditor, type Editor } from "@tiptap/react"
import DragHandle from "@tiptap/extension-drag-handle-react"
import StarterKit from "@tiptap/starter-kit"
import { Placeholder } from "@tiptap/extensions"
import { TaskItem, TaskList } from "@tiptap/extension-list"
import { TableKit } from "@tiptap/extension-table"
import Image from "@tiptap/extension-image"
import Highlight from "@tiptap/extension-highlight"
import { Markdown } from "@tiptap/markdown"
import type { Node as PMNode } from "@tiptap/pm/model"
import {
  ArrowLeftIcon, ArrowRightIcon, ChevronDownIcon, CopyIcon, FileTextIcon, GripVerticalIcon, ImageIcon,
  LockIcon, PlusIcon, SmilePlusIcon, TableIcon, Trash2Icon, TypeIcon,
} from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuSub,
  DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Icon } from "@/components/ui/icon"
import { notify } from "@/components/ui/notice"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { isBlock, isCortexKind, locationOf, bySlug, channelRecords, channelsOf, blocks, titleOf, type Doc } from "@/data/workspace-data"
import { cn } from "@/lib/cn"
import { registerStepTool } from "@/webmcp"
import { DOC_DRAG, dragOut, openDropped, saveExport } from "@/workspace/drop"
import { addImage, autosave, bodyRevision, editCortex, canGo, go, marks, MAX_IMAGE_BYTES, me, moveBlock, open, openFile, revealFolder, saveDraft, setIcon, showGraph, toggleArchive, useWorkspace } from "@/workspace/store"
import { exportBlock, exportNow, preload } from "@/media/export"
import { unescapeEmbeds } from "@/media/embeds"
import { InlineRename, requestDelete } from "@/workspace/PageActions"
import { withAgent } from "@/workspace/tools"
import { hasImages, insertImage, insertImageFiles, insertTable, insertText } from "./commands"
import { Embed } from "./embed"
import { ActiveCell, References, SlashCommand } from "./extensions"
import { IconPicker } from "./IconPicker"
import { PlusMenu, SlashMenu } from "./InsertMenu"
import { SelectionToolbar } from "./SelectionToolbar"
import { LastEdited, TableControls } from "./TableControls"
import { LinkPreview } from "./LinkPreview"
import { ConnectionsButton } from "./ConnectionsCard"
import { HistoryButton } from "@/history/History"
import { CortexActions, ObserveButton } from "./CortexActions"
import "./editor.css"

/**
 * Images at web addresses still show. One at a temporary browser address (`blob:` or `data:`) is
 * never taken in from pasted HTML: an image is added as a media block instead (vault/plans/media.md).
 */
const WebImage = Image.extend({
  parseHTML() {
    return [{ tag: "img[src]", getAttrs: el => /^(?:https?:)?\/\//i.test((el as HTMLElement).getAttribute("src") ?? "") ? null : false }]
  },
})
const IMAGE_TYPES = ["image/avif", "image/gif", "image/jpeg", "image/png", "image/webp"]

/** Bodies written before the editor start with "# Title"; the title has its own field now. */
const withoutTitle = (body: string, title: string) => body.replace(new RegExp(`^#\\s+${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\n*`), "")

/** The block as Markdown, with [[links]] kept as written: the serializer escapes their brackets (and a `|`). */
const unescapeLinks = (md: string) =>
  md.replace(/\\?\[\\?\[([a-z0-9-]+)(?:\\?\|((?:[^\]\n\\]|\\.)+?))?\\?\]\\?\]/gi,
    (_, slug: string, words?: string) => (words ? `[[${slug}|${words.replace(/\\(.)/g, "$1")}]]` : `[[${slug}]]`))
const toMarkdown = (e: Editor) => unescapeLinks(unescapeEmbeds(e.getMarkdown()))

const pill = "flex items-center gap-0.5 rounded-full bg-muted p-0.5"
const pillButton = "size-8 rounded-full text-muted-foreground hover:bg-background hover:text-foreground aria-expanded:bg-background aria-expanded:text-foreground"
const lastEdited = (d: Doc) => new Date(`${d.updated}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })

function ToolButton({ label, icon, onClick, ...props }: { label: string; icon: typeof TypeIcon; onClick?: () => void } & React.ComponentProps<typeof Button>) {
  return (
    <Tooltip>
      <TooltipTrigger render={<Button size="icon-sm" variant="ghost" aria-label={label} className={pillButton} onClick={onClick} {...props} />}>
        <Icon icon={icon} size="sm" />
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

function useAutoHeight(ref: React.RefObject<HTMLTextAreaElement | null>, value: string) {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = "0px"
    el.style.height = `${el.scrollHeight}px`
  }, [ref, value])
}

/** Where a block lives: vault › home channel › title, or cortex › category › title. */
const pathOf = (d: Doc) => [isBlock(d) ? "vault" : "cortex", ...locationOf(d).split("/"), titleOf(d)].filter(Boolean) as string[]

/**
 * The block's path, in a pill. Click the block's name to rename it in place. Drag the pill out to save
 * the block as a .md file, or onto a vault channel in the side panel to file it there. The ⌄ beside it
 * opens the block's menu, as a session list has it: Open in, Rename, the file, Move, Archive, Delete.
 */
function PathPill({ doc, markdown, onPickFile }: { doc: Doc; markdown: () => string; onPickFile: () => void }) {
  const path = pathOf(doc)
  const post = isBlock(doc)
  const [renaming, setRenaming] = useState(false)
  const [menu, setMenu] = useState(false)
  const destinations = useMemo(() => {
    const set = new Set<string>()
    for (const p of blocks) for (const c of channelsOf(p)) { set.add(c.split("/")[0]); set.add(c) }
    for (const c of channelRecords) set.add(c.path)
    return [...set].sort()
  }, [doc.updated, doc.homeChannel, doc.channels]) // eslint-disable-line react-hooks/exhaustive-deps
  const here = locationOf(doc)
  const md = () => `# ${titleOf(doc)}\n\n${markdown()}`
  // A drag must hand over its file at once, so the images this block shows are loaded ahead of it.
  useEffect(() => { void preload(doc) }, [doc.id, doc.body]) // eslint-disable-line react-hooks/exhaustive-deps
  const rename = () => { if (post) { setMenu(false); setRenaming(true) } }
  const key = (e: React.KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    const k = e.key.toLowerCase()
    if (k === "r" && post) { e.preventDefault(); rename() }
    if (k === "a" && post) { e.preventDefault(); setMenu(false); toggleArchive(doc.id); notify({ message: marks.archived.has(doc.id) ? `Archived “${titleOf(doc)}”` : `Restored “${titleOf(doc)}”`, tone: "info" }) }
    if (k === "d" && post) { e.preventDefault(); setMenu(false); requestDelete(doc.id) }
  }
  return (
    <div draggable={!renaming} aria-label={`${path.join(" / ")}. Drag out to save as Markdown`}
      onDragStart={e => { const text = md(); dragOut(e.dataTransfer, doc.id, text, exportNow(doc, text)) }}
      className={cn(pill, "h-9 min-w-0 max-w-[min(480px,58vw)] cursor-grab gap-1.5 ps-3 pe-0.5 text-small text-muted-foreground active:cursor-grabbing")}>
      <Icon icon={FileTextIcon} size="sm" className="flex-none" />
      <span className="flex min-w-0 items-center gap-1">
        {path.slice(0, -1).map((seg, i) => {
          // Reveal the channel or cortex category in the tree.
          const prime = path[0] as "vault" | "cortex"
          const pathToReveal = path.slice(1, i + 1).join("/")
          return (
            <span key={i} className="flex min-w-0 flex-shrink items-center gap-1">
              <button type="button" title={`Show ${seg} in the home`}
                onClick={() => (i === 0 ? revealFolder(prime, "") : revealFolder(prime, pathToReveal))}
                className="truncate rounded-md px-0.5 transition-colors hover:bg-background hover:text-foreground">{seg}</button>
              <span aria-hidden className="text-muted-foreground/60">/</span>
            </span>
          )
        })}
        {renaming ? (
          <InlineRename id={doc.id} className="h-7 w-48 text-small font-medium"
            onDone={() => setRenaming(false)} />
        ) : (
          <button type="button" disabled={!post} onClick={rename} title={post ? "Rename" : undefined}
            className="max-w-48 flex-shrink-0 cursor-text truncate rounded-md px-1 py-0.5 font-medium text-foreground transition-colors hover:bg-background disabled:cursor-default disabled:hover:bg-transparent">
            {path.at(-1)}
          </button>
        )}
      </span>
      <DropdownMenu open={menu} onOpenChange={setMenu}>
        <DropdownMenuTrigger render={
          <button type="button" aria-label="Block menu"
            className="flex size-8 flex-none items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-background hover:text-foreground aria-expanded:bg-background aria-expanded:text-foreground" />
        }>
          <Icon icon={ChevronDownIcon} size="sm" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-60" onKeyDown={key}>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Open in</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-48">
              <DropdownMenuItem onClick={() => window.open(`${location.pathname}?open=${encodeURIComponent(doc.id)}`, "_blank", "noopener")}>New tab</DropdownMenuItem>
              <DropdownMenuItem onClick={() => showGraph()}>Graph</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={!post} onClick={rename}>Rename<DropdownMenuShortcut>R</DropdownMenuShortcut></DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onPickFile}>Open file…</DropdownMenuItem>
          <DropdownMenuItem onClick={() => { void exportBlock(doc, md()).then(saveExport) }}>Save as Markdown</DropdownMenuItem>
          {post && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Move to</DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-72 w-52 overflow-y-auto">
                {/* Moves the block from its home channel, the one its address comes from. */}
                {destinations.map(f => (
                  <DropdownMenuCheckboxItem key={f} checked={f === here} onCheckedChange={() => {
                    const { published } = moveBlock(doc.id, here, f)
                    notify({ message: `Moved to ${f.replace("/", " › ")}${published ? ". Its address changes when you next publish" : ""}`, tone: "info" })
                    setMenu(false)
                  }}>{f.replace("/", " › ")}</DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={!post} onClick={() => { toggleArchive(doc.id); notify({ message: marks.archived.has(doc.id) ? `Archived “${titleOf(doc)}”` : `Restored “${titleOf(doc)}”`, tone: "info" }) }}>
            {marks.archived.has(doc.id) ? "Restore" : "Archive"}<DropdownMenuShortcut>A</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!post} variant="destructive" onClick={() => requestDelete(doc.id)}>Delete<DropdownMenuShortcut>D</DropdownMenuShortcut></DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

/** The block handle's menu: for a table, its own options; for any block, insert, duplicate, copy, delete. */
function BlockMenu({ editor, block, updated, onClose }: { editor: Editor; block: { node: PMNode; pos: number }; updated: string; onClose: () => void }) {
  const { node, pos } = block
  const isTable = node.type.name === "table"
  const end = pos + node.nodeSize
  const json = node.toJSON()
  const md = () => unescapeLinks(editor.markdown?.serialize({ type: "doc", content: [json] }) ?? node.textContent)
  const headerRow = isTable && (node.firstChild?.firstChild?.type.name === "tableHeader")
  let headerCol = isTable
  if (isTable) node.forEach(r => { if (r.firstChild?.type.name !== "tableHeader") headerCol = false })
  const inTable = (fn: () => void) => { editor.chain().focus().setTextSelection(pos + 3).run(); fn() }
  const done = (fn: () => void) => () => { fn(); onClose() }
  return <>
    <DropdownMenuItem className="flex items-center gap-2" onClick={done(() => editor.chain().focus().insertContentAt(end, { type: "paragraph" }).setTextSelection(end + 1).run())}>
      <Icon icon={PlusIcon} size="sm" />Insert below
    </DropdownMenuItem>
    {!isTable && (
      <DropdownMenuItem className="flex items-center gap-2" onClick={done(() => editor.chain().focus().insertContentAt(end, json).run())}>
        <Icon icon={CopyIcon} size="sm" />Duplicate
      </DropdownMenuItem>
    )}
    <DropdownMenuItem className="flex items-center gap-2" onClick={done(() => { void navigator.clipboard?.writeText(md()); notify({ message: "Copied as Markdown", tone: "info" }) })}>
      <Icon icon={CopyIcon} size="sm" />Copy as Markdown
    </DropdownMenuItem>
    {isTable && <>
      <DropdownMenuSeparator />
      <DropdownMenuCheckboxItem checked={headerRow} onCheckedChange={() => inTable(() => editor.chain().focus().toggleHeaderRow().run())}>Header row</DropdownMenuCheckboxItem>
      <DropdownMenuCheckboxItem checked={headerCol} onCheckedChange={() => inTable(() => editor.chain().focus().toggleHeaderColumn().run())}>Header column</DropdownMenuCheckboxItem>
    </>}
    <DropdownMenuSeparator />
    <DropdownMenuItem variant="destructive" className="flex items-center gap-2" onClick={done(() => editor.chain().focus().deleteRange({ from: pos, to: end }).run())}>
      <Icon icon={Trash2Icon} size="sm" />{isTable ? "Delete table" : "Delete"}
    </DropdownMenuItem>
    <LastEdited date={updated} />
  </>
}

export function PageEditor({ doc }: { doc: Doc }) {
  const { agentsAllowed, offered } = useWorkspace()
  // A private block is edited here; so is every part of your cortex, which only you see.
  const privateBlock = isBlock(doc) && doc.visibility === "private"
  const cortexPart = !isBlock(doc) && isCortexKind(doc.kind)
  const editable = privateBlock || cortexPart
  const [titleDraft, setTitleDraft] = useState<string | null>(null)
  // The vault trims the saved title. Keep spaces in the input while the saved title matches.
  const title = privateBlock && titleDraft?.trim() === doc.title ? titleDraft : doc.title
  const [plusOpen, setPlusOpen] = useState(false)
  const [iconOpen, setIconOpen] = useState(false)
  const [block, setBlock] = useState<{ node: PMNode; pos: number } | null>(null)
  const [blockMenu, setBlockMenu] = useState(false)
  const [dropping, setDropping] = useState<"open" | "image" | null>(null)
  const [canvas, setCanvas] = useState<HTMLDivElement | null>(null)
  const titleRef = useRef<HTMLTextAreaElement>(null)
  const imageInput = useRef<HTMLInputElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  useAutoHeight(titleRef, title)
  const save = useRef<ReturnType<typeof setTimeout> | null>(null)
  const unsaved = useRef<string | null>(null)
  const base = useRef(bodyRevision(doc))
  /** Drops typing not yet saved, once an agent's save has taken it in. */
  function dropPending() {
    if (save.current) clearTimeout(save.current)
    save.current = null
    unsaved.current = null
  }
  function flushBody() {
    if (save.current) clearTimeout(save.current)
    save.current = null
    const body = unsaved.current
    unsaved.current = null
    if (body === null || bodyRevision(doc) !== base.current) return
    try { if (cortexPart) editCortex(doc.id, body); else autosave(doc.id, { body }) }
    catch (error) { notify({ message: error instanceof Error ? error.message : "This block could not be saved" }) }
  }

  const editor = useEditor({
    editable,
    immediatelyRender: true,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: { openOnClick: false } }),
      Placeholder.configure({
        placeholder: ({ node }) => (node.type.name === "heading" ? `Heading ${node.attrs.level}` : "Type / for commands or @ for mentions"),
        includeChildren: false,
      }),
      TaskList, TaskItem.configure({ nested: true }),
      TableKit.configure({ table: { resizable: true, lastColumnResizable: false } }),
      WebImage, Highlight, SlashCommand, ActiveCell, Markdown,
      Embed.configure({ onOpen: id => open(id), channel: () => doc.homeChannel }),
      References(ref => {
        if (ref.slug) { const d = bySlug(ref.slug); if (d) open(d.id) }
        if (ref.handle) showGraph(ref.handle)
      }),
    ],
    content: withoutTitle(doc.body, doc.title),
    contentType: "markdown",
    editorProps: {
      attributes: { class: "ohm-prose", "aria-label": "Block" },
      // Images dropped or pasted go into the block where they land; blocks and text files open.
      handleDrop: (view, event) => {
        const dt = (event as DragEvent).dataTransfer
        if (!dt) return false
        const files = [...dt.files]
        if (hasImages(files)) {
          if (!view.editable || !doc.homeChannel) return false
          event.preventDefault()
          const at = view.posAtCoords({ left: (event as DragEvent).clientX, top: (event as DragEvent).clientY })
          const $pos = at ? view.state.doc.resolve(at.pos) : null
          void insertImageFiles(editorRef.current!, files, doc.homeChannel, $pos && $pos.depth > 0 ? $pos.after(1) : undefined)
          return true
        }
        if (dt.types.includes(DOC_DRAG) || files.length) {
          event.preventDefault()
          void openDropped(dt)
          return true
        }
        return false
      },
      handlePaste: (view, event) => {
        const files = [...(event.clipboardData?.files ?? [])]
        if (!hasImages(files) || !view.editable || !doc.homeChannel) return false
        void insertImageFiles(editorRef.current!, files, doc.homeChannel)
        return true
      },
    },
    onUpdate: ({ editor: e }) => {
      if (save.current) clearTimeout(save.current)
      // Kept as text at once, so leaving the block can still save it after the editor is gone.
      unsaved.current = toMarkdown(e)
      save.current = setTimeout(flushBody, 400)
    },
  }, [doc.id])
  const editorRef = useRef<Editor | null>(null)
  editorRef.current = editor

  // Leaving flushes pending typing. A restore or revert invalidates the old editor's buffer.
  useEffect(() => flushBody, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (editable && !doc.title) titleRef.current?.focus() }, [doc.id]) // eslint-disable-line react-hooks/exhaustive-deps
  // The toolbar's Image and the "/" menu's Image both ask for a file.
  useEffect(() => {
    const pick = () => imageInput.current?.click()
    window.addEventListener("ohm:pick-image", pick)
    return () => window.removeEventListener("ohm:pick-image", pick)
  }, [])

  // The block's one primary action is saving, and it is also a tool while a private block is open.
  const offer = privateBlock && agentsAllowed && offered["workspace.save-draft"]
  useEffect(() => {
    if (!offer || !editor) return
    const ac = new AbortController()
    registerStepTool<{ title?: string; body?: string }, ReturnType<typeof saveDraft>>({
      name: "workspace.save-draft",
      title: "Save draft",
      description: "Saves the block open in the editor as private. It is never published. Fields left out keep what is on the block. The body is Markdown. Returns its id and slug.",
      inputSchema: {
        type: "object",
        properties: { title: { type: "string", maxLength: 200 }, body: { type: "string", maxLength: 100000 } },
        additionalProperties: false,
      },
      outputSchema: { type: "object", properties: { id: { type: "string" }, slug: { type: "string" }, visibility: { const: "private" } } },
      run: withAgent("Saving draft", async input => {
        // Not as you typing: the agent's text is saved once, as its change, not again as your autosave.
        if (input.body !== undefined) editor.commands.setContent(input.body, { contentType: "markdown", emitUpdate: false })
        const out = saveDraft({ title: input.title ?? titleRef.current?.value ?? doc.title, body: toMarkdown(editor) })
        dropPending()
        notify({ message: "Saved as private", tone: "info" })
        return out
      }),
    }, ac.signal).catch(console.error)
    return () => ac.abort()
  }, [offer, editor, doc.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // The toolbar's Image is also a tool: an agent gives the bytes, and the same handler makes the media block.
  const offerImage = privateBlock && agentsAllowed && offered["workspace.add-image"]
  useEffect(() => {
    if (!offerImage || !editor || !doc.homeChannel) return
    const channel = doc.homeChannel
    const ac = new AbortController()
    registerStepTool<{ name: string; type: string; data: string; alt?: string }, { id: string; slug: string; created: boolean; next: string }>({
      name: "workspace.add-image",
      title: "Image",
      description: "Adds an image to the open private block. It becomes a private media block in the block's channel, or the one the vault already has for the same image, and the block embeds it at its end. Give the image as base64. Returns the media block's id and slug.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", minLength: 1, maxLength: 200 },
          type: { enum: IMAGE_TYPES },
          data: { type: "string", minLength: 1, maxLength: Math.ceil(MAX_IMAGE_BYTES / 3) * 4 },
          alt: { type: "string", maxLength: 1000 },
        },
        required: ["name", "type", "data"],
        additionalProperties: false,
      },
      outputSchema: { type: "object", properties: { id: { type: "string" }, slug: { type: "string" }, created: { type: "boolean" }, next: { const: "workspace.save-draft" } } },
      run: withAgent("Adding image", async input => {
        let bytes: Uint8Array
        try { bytes = Uint8Array.from(atob(input.data), c => c.charCodeAt(0)) }
        catch { throw new DOMException("data is not base64", "DataError") }
        const added = await addImage({ name: input.name, type: input.type, bytes, channel, alt: input.alt })
        // As with Save draft: the agent's change is saved once, as its own, not again as your autosave.
        const body = `${toMarkdown(editor).trimEnd()}\n\n![[${added.slug}]]\n`
        editor.commands.setContent(body, { contentType: "markdown", emitUpdate: false })
        saveDraft({ body: toMarkdown(editor) })
        dropPending()
        return { ...added, next: "workspace.save-draft" }
      }),
    }, ac.signal).catch(console.error)
    return () => ac.abort()
  }, [offerImage, editor, doc.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!editor) return null
  const updated = lastEdited(doc)
  const dragKind = (dt: DataTransfer) =>
    [...dt.items].some(i => i.kind === "file" && i.type.startsWith("image/")) ? (privateBlock ? "image" : null)
      : dt.types.includes(DOC_DRAG) || dt.types.includes("Files") ? "open" : null

  return (
    <div data-doc-id={doc.id} className="relative flex min-h-0 flex-1 flex-col"
      onDragEnter={e => { const k = dragKind(e.dataTransfer); if (k) setDropping(k) }}
      onDragOver={e => { if (dragKind(e.dataTransfer)) e.preventDefault() }}
      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropping(null) }}
      onDrop={e => {
        setDropping(null)
        if (e.defaultPrevented) return
        e.preventDefault()
        if (dragKind(e.dataTransfer) === "image" && doc.homeChannel) void insertImageFiles(editor, [...e.dataTransfer.files], doc.homeChannel)
        else void openDropped(e.dataTransfer)
      }}>
      {/* Toolbar: the block's path, then inserts; history, comments, you and sharing on the right. */}
      <div className="flex h-14 shrink-0 items-center justify-between gap-2 px-3">
        <div className="flex min-w-0 items-center gap-1.5">
          <div className={pill}>
            <ToolButton label="Back (⌘[)" icon={ArrowLeftIcon} disabled={!canGo(-1)} onClick={() => go(-1)} />
            <ToolButton label="Forward (⌘])" icon={ArrowRightIcon} disabled={!canGo(1)} onClick={() => go(1)} />
          </div>
          <PathPill doc={doc} markdown={() => toMarkdown(editor)} onPickFile={() => fileInput.current?.click()} />
          {privateBlock && (
            <div className={pill}>
              <ToolButton label="Text" icon={TypeIcon} onClick={() => insertText(editor)} />
              <ToolButton label="Image" icon={ImageIcon} onClick={() => insertImage(editor)} />
              <ToolButton label="Table" icon={TableIcon} onClick={() => insertTable(editor)} />
              <Popover open={plusOpen} onOpenChange={setPlusOpen}>
                <PopoverTrigger render={<Button size="icon-sm" variant="ghost" aria-label="Insert" className={pillButton} />}>
                  <Icon icon={PlusIcon} size="sm" />
                </PopoverTrigger>
                <PopoverContent align="start" className="w-auto p-1">
                  <PlusMenu editor={editor} onClose={() => setPlusOpen(false)} />
                </PopoverContent>
              </Popover>
            </div>
          )}
          {cortexPart && <CortexActions doc={doc} />}
          {!editable && (
            <span className="flex min-w-0 items-center gap-1.5 ps-1 text-small whitespace-nowrap text-muted-foreground"
              title={isBlock(doc) ? `For ${doc.visibility === "public" ? "everyone" : "friends"}: changing it asks first` : "From your cortex"}>
              <Icon icon={LockIcon} size="xs" className="flex-none" />
              {/* The note gives way first when the toolbar is narrow; the lock and its tooltip stay. */}
              <span className="truncate">{isBlock(doc) ? `For ${doc.visibility === "public" ? "everyone" : "friends"}: changing it asks first` : "From your cortex"}</span>
            </span>
          )}
        </div>
        <div className="flex flex-none items-center gap-1.5">
          {isBlock(doc) && (
            <div className={pill}>
              <ConnectionsButton doc={doc} editable={editable} variant="toolbar" side="bottom" />
              <ObserveButton doc={doc} className={pillButton} />
            </div>
          )}
          <div className={pill}>
            {/* Cortex items use the same history viewer. */}
            <HistoryButton doc={doc} className={pillButton} />
          </div>
          <Avatar className="size-8"><AvatarFallback className="bg-primary text-small text-primary-foreground">{me.name.slice(0, 1)}</AvatarFallback></Avatar>
        </div>
      </div>

      {marks.archived.has(doc.id) && (
        <div role="status" className="mx-3 flex items-center justify-between gap-2 rounded-xl bg-muted px-4 py-2 text-small animate-in fade-in-0">
          <span>This block is archived: it is out of your tree, and kept.</span>
          <Button size="xs" variant="ghost" onClick={() => toggleArchive(doc.id)}>Restore</Button>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[720px] px-14 pt-10 pb-40 max-md:px-6">
          {doc.icon && (
            <button type="button" aria-label="Change icon" disabled={!privateBlock} onClick={() => setIconOpen(true)}
              className="mb-3 -ms-1 rounded-md p-1 text-[44px] leading-none transition-transform duration-(--ohm-duration-press) ease-(--ohm-ease-out) animate-in fade-in-0 zoom-in-90 hover:bg-muted active:scale-95">
              {doc.icon}
            </button>
          )}
          <div className="group/title relative">
            {privateBlock && (
              <Popover open={iconOpen} onOpenChange={setIconOpen}>
                <PopoverTrigger render={
                  <button type="button" aria-label={doc.icon ? "Change icon" : "Add icon"}
                    className={cn("absolute top-1.5 -left-8 flex size-6 items-center justify-center rounded-md text-muted-foreground transition-opacity duration-(--ohm-duration-state) hover:bg-muted focus-visible:opacity-100",
                      doc.icon ? "pointer-events-none opacity-0" : "opacity-0 group-hover/title:opacity-100")} />
                }>
                  <Icon icon={SmilePlusIcon} size="sm" />
                </PopoverTrigger>
                <PopoverContent align="start" className="w-auto">
                  <IconPicker value={doc.icon} onPick={e => { setIcon(doc.id, e); setIconOpen(false) }} />
                </PopoverContent>
              </Popover>
            )}
            <textarea ref={titleRef} rows={1} value={title} readOnly={!privateBlock} placeholder="Untitled block" aria-label="Title"
              onChange={e => {
                const next = e.target.value
                setTitleDraft(next)
                autosave(doc.id, { title: next })
              }}
              onBlur={() => setTitleDraft(null)}
              onKeyDown={e => {
                if (e.key === "Enter" || (e.key === "ArrowDown" && e.currentTarget.selectionStart === title.length)) {
                  e.preventDefault()
                  // Move at once, so the next keys land in the block, not the title.
                  editor.view.focus()
                  editor.commands.setTextSelection(1)
                }
              }}
              className="block w-full resize-none overflow-hidden bg-transparent text-h2 font-semibold tracking-tight outline-none placeholder:text-muted-foreground/60" />
          </div>

          <div ref={setCanvas} className="relative mt-6">
            {editable && (
              <DragHandle editor={editor} onNodeChange={({ node, pos }) => { if (!blockMenu) setBlock(node ? { node, pos } : null) }}>
                <DropdownMenu open={blockMenu} onOpenChange={setBlockMenu}>
                  <DropdownMenuTrigger render={
                    <button type="button" aria-label="Block menu" onDragStart={() => setBlockMenu(false)}
                      className="flex h-6 w-5 cursor-grab items-center justify-center rounded text-muted-foreground opacity-70 transition-opacity hover:bg-muted hover:opacity-100 active:cursor-grabbing aria-expanded:bg-muted aria-expanded:opacity-100" />
                  }>
                    <Icon icon={GripVerticalIcon} size="sm" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" side="left" className="w-56">
                    {block && <BlockMenu editor={editor} block={block} updated={updated} onClose={() => setBlockMenu(false)} />}
                  </DropdownMenuContent>
                </DropdownMenu>
              </DragHandle>
            )}
            <EditorContent editor={editor} />
            {editable && <TableControls editor={editor} container={canvas} updated={updated} />}
            <LinkPreview container={canvas} />
          </div>
        </div>
      </div>

      {/* Dropping: a block or text file opens; an image goes into the block. */}
      {dropping && (
        <div className="pointer-events-none absolute inset-2 z-20 flex items-center justify-center rounded-2xl bg-background/70 ring-2 ring-primary/40 backdrop-blur-[2px] animate-in fade-in-0 duration-(--ohm-duration-state)">
          <span className="rounded-full bg-popover px-4 py-2 text-body shade-3">
            {dropping === "image" ? "Drop to add the image here" : "Drop to open"}
          </span>
        </div>
      )}

      <input ref={imageInput} type="file" accept="image/*" multiple hidden
        onChange={e => { if (doc.homeChannel) void insertImageFiles(editor, [...(e.target.files ?? [])], doc.homeChannel); e.target.value = "" }} />
      <input ref={fileInput} type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" hidden
        onChange={async e => { const f = e.target.files?.[0]; if (f) openFile(f.name, await f.text()); e.target.value = "" }} />

      {privateBlock && <SelectionToolbar editor={editor} docId={doc.id} />}
      <SlashMenu />
    </div>
  )
}
