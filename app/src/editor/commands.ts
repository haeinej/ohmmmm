// What can be inserted or turned into, shared by the + menu, the "/" menu and the selection toolbar.
import type { Editor, Range } from "@tiptap/react"
import type { LucideIcon } from "lucide-react"
import {
  AudioLinesIcon, ClipboardListIcon, CodeIcon, FileIcon, FileTextIcon, Heading1Icon, Heading2Icon, Heading3Icon,
  ImageIcon, ListChecksIcon, ListIcon, ListOrderedIcon, MinusIcon, QuoteIcon, ShapesIcon, SparklesIcon, TableIcon,
  TypeIcon, VideoIcon,
} from "lucide-react"
import { notify } from "@/components/ui/notice"
import { addImage } from "@/workspace/store"

export type BlockType = { id: string; label: string; icon: LucideIcon; shortcut?: string; isActive: (e: Editor) => boolean; run: (e: Editor) => void }

/** "Turn into": the Text menu in the selection toolbar. */
export const BLOCK_TYPES: BlockType[] = [
  { id: "text", label: "Text", icon: TypeIcon, isActive: e => e.isActive("paragraph") && !e.isActive("bulletList") && !e.isActive("orderedList") && !e.isActive("taskList") && !e.isActive("blockquote"), run: e => e.chain().focus().clearNodes().run() },
  { id: "h1", label: "Heading 1", icon: Heading1Icon, isActive: e => e.isActive("heading", { level: 1 }), run: e => e.chain().focus().clearNodes().setHeading({ level: 1 }).run() },
  { id: "h2", label: "Heading 2", icon: Heading2Icon, isActive: e => e.isActive("heading", { level: 2 }), run: e => e.chain().focus().clearNodes().setHeading({ level: 2 }).run() },
  { id: "h3", label: "Heading 3", icon: Heading3Icon, isActive: e => e.isActive("heading", { level: 3 }), run: e => e.chain().focus().clearNodes().setHeading({ level: 3 }).run() },
  { id: "ol", label: "Numbered list", icon: ListOrderedIcon, shortcut: "⌥⌘4", isActive: e => e.isActive("orderedList"), run: e => e.chain().focus().clearNodes().toggleOrderedList().run() },
  { id: "ul", label: "Bulleted list", icon: ListIcon, shortcut: "⌥⌘5", isActive: e => e.isActive("bulletList"), run: e => e.chain().focus().clearNodes().toggleBulletList().run() },
  { id: "todo", label: "Checklist", icon: ListChecksIcon, shortcut: "⌥⌘6", isActive: e => e.isActive("taskList"), run: e => e.chain().focus().clearNodes().toggleTaskList().run() },
  { id: "quote", label: "Quote", icon: QuoteIcon, isActive: e => e.isActive("blockquote"), run: e => e.chain().focus().clearNodes().toggleBlockquote().run() },
  { id: "code", label: "Code", icon: CodeIcon, isActive: e => e.isActive("codeBlock"), run: e => e.chain().focus().clearNodes().toggleCodeBlock().run() },
]

export const currentBlock = (e: Editor) => BLOCK_TYPES.find(b => b.isActive(e)) ?? BLOCK_TYPES[0]

export type InsertItem = { id: string; label: string; hint?: string; icon: LucideIcon; keywords?: string; run: (e: Editor, range?: Range) => void }
export type InsertGroup = { label: string; items: InsertItem[] }

const at = (e: Editor, range?: Range) => (range ? e.chain().focus().deleteRange(range) : e.chain().focus())
const later = (what: string) => notify({ message: `${what} arrives once an agent is connected through WebMCP`, tone: "info" })

/** Where a toolbar insert goes: after the top-level block the caret is in, never inside a table or list. */
const afterBlock = (e: Editor) => {
  const { $from } = e.state.selection
  return $from.depth > 0 ? $from.after(1) : e.state.doc.content.size
}
/** From "/" the block replaces the typed command; from the toolbar it is added after the current block. */
/** Images come from a file: the editor opens a picker (or takes a dropped or pasted image). */
export const insertImage = (e: Editor, range?: Range) => {
  if (range) at(e, range).run()
  window.dispatchEvent(new CustomEvent("ohm:pick-image"))
}
/** Whether any of these files is an image the editor takes. */
export const hasImages = (files: File[]) => files.some(f => f.type.startsWith("image/"))
/**
 * Puts image files into the editor at a position, or after the current block. Each becomes a media
 * block of its own in `channel` (or the one the vault already has for the same bytes), and the editor
 * embeds it, `![[slug]]`. Nothing here gives the block a browser address (vault/plans/media.md).
 */
export async function insertImageFiles(e: Editor, files: File[], channel: string, pos?: number) {
  const added: Awaited<ReturnType<typeof addImage>>[] = []
  for (const f of files.filter(f => f.type.startsWith("image/"))) {
    try {
      added.push(await addImage({ name: f.name, type: f.type, bytes: new Uint8Array(await f.arrayBuffer()), channel }))
    } catch (error) {
      notify({ message: error instanceof Error ? error.message : `“${f.name}” could not be added` })
    }
  }
  if (!added.length || e.isDestroyed) return false
  const at = Math.min(pos ?? afterBlock(e), e.state.doc.content.size)
  e.chain().focus().insertContentAt(at, added.map(each => ({ type: "embed", attrs: { src: each.slug } }))).run()
  const known = added.filter(each => !each.created)
  if (known.length) notify({ message: known.length === 1 ? "That image is already in your vault, so this shows the same media block" : `${known.length} of these images are already in your vault, so this shows their media blocks`, tone: "info" })
  return true
}
export const insertTable = (e: Editor, range?: Range) => {
  if (range) return at(e, range).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
  const pos = afterBlock(e)
  return e.chain().focus().insertContentAt(pos, { type: "paragraph" }).setTextSelection(pos + 1).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
}
export const insertText = (e: Editor, range?: Range) => {
  if (range) return at(e, range).run()
  const pos = afterBlock(e)
  return e.chain().focus().insertContentAt(pos, { type: "paragraph" }).setTextSelection(pos + 1).run()
}

/** The + menu and the "/" menu. */
export const INSERT_GROUPS: InsertGroup[] = [
  {
    label: "Generate", items: [
      { id: "generate", label: "Generate", hint: "Describe what you want to create", icon: SparklesIcon, keywords: "ai write agent", run: (e, r) => { at(e, r).run(); later("Generating") } },
      { id: "visualize", label: "Visualize", hint: "Create an interactive visualization", icon: ShapesIcon, keywords: "chart diagram", run: (e, r) => { at(e, r).run(); later("Visualizing") } },
    ],
  },
  {
    label: "Create", items: [
      { id: "block-link", label: "Block link", hint: "Insert a link to a block", icon: FileTextIcon, keywords: "link wiki", run: (e, r) => at(e, r).insertContent("[[untitled-block]] ").run() },
    ],
  },
  {
    label: "Media", items: [
      { id: "image", label: "Image", hint: "Upload, or drop one in the editor", icon: ImageIcon, keywords: "picture photo upload", run: insertImage },
      { id: "video", label: "Video", hint: "Upload a video", icon: VideoIcon, keywords: "movie", run: (e, r) => { at(e, r).run(); notify({ message: "Video is not part of this wireframe", tone: "info" }) } },
      { id: "audio", label: "Audio", hint: "Upload audio", icon: AudioLinesIcon, keywords: "sound music", run: (e, r) => { at(e, r).run(); notify({ message: "Audio is not part of this wireframe", tone: "info" }) } },
      { id: "file", label: "File", hint: "Upload a file", icon: FileIcon, keywords: "attachment", run: (e, r) => { at(e, r).run(); notify({ message: "Files are not part of this wireframe", tone: "info" }) } },
    ],
  },
  {
    label: "Basic", items: [
      { id: "instructions", label: "Assistant instructions", icon: ClipboardListIcon, keywords: "agent prompt", run: (e, r) => at(e, r).insertContent({ type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", marks: [{ type: "bold" }], text: "Assistant instructions: " }] }] }).run() },
      { id: "quote", label: "Quote", icon: QuoteIcon, run: (e, r) => at(e, r).toggleBlockquote().run() },
      { id: "h1", label: "Heading 1", icon: Heading1Icon, keywords: "title", run: (e, r) => at(e, r).setHeading({ level: 1 }).run() },
      { id: "h2", label: "Heading 2", icon: Heading2Icon, keywords: "subtitle", run: (e, r) => at(e, r).setHeading({ level: 2 }).run() },
      { id: "h3", label: "Heading 3", icon: Heading3Icon, run: (e, r) => at(e, r).setHeading({ level: 3 }).run() },
      { id: "ul", label: "Bulleted list", icon: ListIcon, keywords: "bullet", run: (e, r) => at(e, r).toggleBulletList().run() },
      { id: "ol", label: "Numbered list", icon: ListOrderedIcon, keywords: "number ordered", run: (e, r) => at(e, r).toggleOrderedList().run() },
      { id: "todo", label: "Checklist", icon: ListChecksIcon, keywords: "todo task check", run: (e, r) => at(e, r).toggleTaskList().run() },
      { id: "table", label: "Table", icon: TableIcon, keywords: "grid", run: insertTable },
      { id: "code", label: "Code", icon: CodeIcon, run: (e, r) => at(e, r).toggleCodeBlock().run() },
      { id: "divider", label: "Divider", icon: MinusIcon, keywords: "line rule hr", run: (e, r) => at(e, r).setHorizontalRule().run() },
    ],
  },
]

export function filterGroups(query: string): InsertGroup[] {
  const q = query.trim().toLowerCase()
  if (!q) return INSERT_GROUPS
  return INSERT_GROUPS
    .map(g => ({ ...g, items: g.items.filter(i => `${i.label} ${i.hint ?? ""} ${i.keywords ?? ""}`.toLowerCase().includes(q)) }))
    .filter(g => g.items.length)
}
