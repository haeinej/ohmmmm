// A block of the site, opened as the app's editor shows a block and not as a web page
// (flows/site.md): the toolbar's pills, the title, then the body with every way of writing the
// editor has: the `/` menu, the selection toolbar, block handles and tables. An article or a
// project is its own writing with its pictures in place; a photograph is a block holding the
// picture. What is saved goes back into the page's file, one changed paragraph at a time.
import { useEffect, useRef, useState } from "react"
import { EditorContent, useEditor } from "@tiptap/react"
import DragHandle from "@tiptap/extension-drag-handle-react"
import StarterKit from "@tiptap/starter-kit"
import { Placeholder } from "@tiptap/extensions"
import { TaskItem, TaskList } from "@tiptap/extension-list"
import { TableKit } from "@tiptap/extension-table"
import Highlight from "@tiptap/extension-highlight"
import { Markdown } from "@tiptap/markdown"
import type { Node as PMNode } from "@tiptap/pm/model"
import { FileTextIcon, FolderKanbanIcon, GripVerticalIcon, ImageIcon, PlusIcon, TableIcon, TypeIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Icon } from "@/components/ui/icon"
import { notify } from "@/components/ui/notice"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/cn"
import { insertTable, insertText } from "@/editor/commands"
import { ActiveCell, SlashCommand } from "@/editor/extensions"
import { PlusMenu, SlashMenu } from "@/editor/InsertMenu"
import { BlockMenu, pill, pillButton, ToolButton, WebImage } from "@/editor/PageEditor"
import { SelectionToolbar } from "@/editor/SelectionToolbar"
import { TableControls } from "@/editor/TableControls"
import { resolveFrom } from "@/viewers/MarkdownView"
import "@/viewers/markdown.css"
import { addressOf, plain, readArticle, siteUrl, type Change, type SiteArticle, type SiteItem } from "./source"

/** What each top-level block of the editor says, in order. */
function blocksOf(json: { content?: unknown[] }) {
  const said = (json.content ?? []).map(saying)
  // The editor keeps an empty line after a closing picture, for the caret: it is not part of the writing.
  while (said.length && !said.at(-1)!.trim()) said.pop()
  return said
}
function saying(node: unknown): string {
  const n = node as { text?: string; content?: unknown[] }
  return n.text ?? (n.content ?? []).map(saying).join("")
}

const KIND = { article: { label: "Article", icon: FileTextIcon }, project: { label: "Project", icon: FolderKanbanIcon }, image: { label: "Photograph", icon: ImageIcon }, video: { label: "Video", icon: ImageIcon } } as const

export function ArticleView({ item, channel, onSave }: {
  item: SiteItem
  channel: string
  /** Save one change to the block's page. The Site view's own handler, shared with its tools. */
  onSave(page: string, change: Change): Promise<unknown>
}) {
  // The article is kept with the path it was read for, so a block opened next never starts its
  // editor with the block before's writing.
  const [read, setRead] = useState<{ path: string; article: SiteArticle } | null>(null)
  const [failed, setFailed] = useState("")
  useEffect(() => {
    setFailed("")
    // A photograph has no writing of its own: its block holds the picture.
    if (item.kind === "image") return setRead({ path: item.path, article: { title: item.title, details: "", markdown: `![${item.title}](${siteUrl(item.path)})` } })
    let current = true
    // Pictures are written at the site's own addresses (`/writings/…` or `../x.jpg`); here they are read from the site folder.
    const local = (src: string) => siteUrl(src.startsWith("/") ? src.slice(1) : resolveFrom(item.path, src))
    readArticle(item.path).then(article => { if (current) setRead({ path: item.path, article: { ...article,
      markdown: article.markdown.replace(/(!\[[^\]]*\]\()<?((?!https?:|data:|\/site\/)[^)\s>]+)>?/g, (_, head, src) => `${head}${local(src)}`) } }) }, e => { if (current) setFailed((e as Error).message) })
    return () => { current = false }
  }, [item.path, item.kind, item.title])
  if (failed) return <p className="p-8 text-small text-muted-foreground">{failed}</p>
  if (read?.path !== item.path) return <div className="flex-1" aria-busy />
  const article = read.article
  return <Writing key={item.path} item={item} channel={channel} article={article} onSave={onSave} />
}

function Writing({ item, channel, article, onSave }: { item: SiteItem; channel: string; article: SiteArticle; onSave(page: string, change: Change): Promise<unknown> }) {
  const writing = item.kind === "article" || item.kind === "project"
  const page = item.path.split("#")[0]
  const [changed, setChanged] = useState(false)
  const [saving, setSaving] = useState(false)
  const [plusOpen, setPlusOpen] = useState(false)
  const [canvas, setCanvas] = useState<HTMLDivElement | null>(null)
  const [block, setBlock] = useState<{ node: PMNode; pos: number } | null>(null)
  const [blockMenu, setBlockMenu] = useState(false)
  const first = useRef<string[]>([])
  const updated = item.modified.slice(0, 10)
  const editor = useEditor({
    editable: writing,
    immediatelyRender: true,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: { openOnClick: false } }),
      Placeholder.configure({ placeholder: ({ node }) => (node.type.name === "heading" ? `Heading ${node.attrs.level}` : "Type / for commands"), includeChildren: false }),
      TaskList, TaskItem.configure({ nested: true }),
      TableKit.configure({ table: { resizable: true, lastColumnResizable: false } }),
      WebImage, Highlight, SlashCommand, ActiveCell, Markdown,
    ],
    content: article.markdown,
    contentType: "markdown",
    // The same Markdown look as the preview (viewers/markdown.css), so what is written here reads as it will be shown.
    editorProps: { attributes: { class: "ohm-prose ohm-markdown", "aria-label": article.title } },
    // What the block said when it opened, read once the Markdown is in the editor.
    onCreate: ({ editor: e }) => { first.current = blocksOf(e.getJSON()) },
    onUpdate: ({ editor: e }) => setChanged(blocksOf(e.getJSON()).join("\n") !== first.current.join("\n")),
  }, [item.path])

  /**
   * Each paragraph whose words changed is changed in the page's file, by what it said before.
   * A paragraph added, removed or holding a link or bold text can't be placed that way yet, and
   * nothing is written for it.
   */
  const save = async () => {
    const now = blocksOf(editor.getJSON())
    const before = first.current
    if (!before.length) return
    if (now.length !== before.length) return notify({ message: "Adding or removing a paragraph, a picture or a table can't be saved to the page yet. Change words within paragraphs, or discard.", tone: "error" })
    setSaving(true)
    let saved = 0
    const refused: string[] = []
    for (let i = 0; i < now.length; i++) {
      if (plain(now[i]) === plain(before[i])) continue
      try { await onSave(page, { type: "text", before: before[i], after: now[i] }); before[i] = now[i]; saved++ }
      catch (e) { refused.push((e as Error).message) }
    }
    setSaving(false)
    setChanged(refused.length > 0)
    if (refused.length) notify({ message: `${saved ? `${saved} saved. ` : ""}${refused.length === 1 ? "One paragraph" : `${refused.length} paragraphs`} couldn't be saved: ${refused[0]}`, tone: "error" })
  }

  return (
    <div className="relative flex size-full min-h-0 flex-col bg-card">
      {/* Toolbar: what the block is and where it is filed, then the inserts. */}
      <div data-article-toolbar className="flex h-14 shrink-0 items-center gap-1.5 px-3">
        {writing && (
          <div className={pill}>
            <ToolButton label="Text" icon={TypeIcon} onClick={() => insertText(editor)} />
            {/* A new picture has to be filed in the site's folder first, which isn't built. */}
            <ToolButton label="Image: not yet" icon={ImageIcon} disabled />
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
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div data-article-page className="mx-auto w-full max-w-[720px] px-14 pt-10 pb-40 max-md:px-6">
          <h1 className="text-h2 font-semibold tracking-tight break-words">{article.title}</h1>
          {article.details && <p className="pt-2 text-small text-muted-foreground">{article.details}</p>}
          <div ref={setCanvas} className="relative mt-6">
            {writing && (
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
            {writing && <TableControls editor={editor} container={canvas} updated={updated} />}
          </div>
        </div>
      </div>

      {changed && (
        <div role="status" className="flex shrink-0 items-center justify-end gap-2 px-5 py-3 text-small">
          <span className="me-auto text-muted-foreground">Changed. Saving writes it into {page}.</span>
          <Button size="sm" variant="ghost" disabled={saving} onClick={() => { editor.commands.setContent(article.markdown, { contentType: "markdown" }); setChanged(false) }}>Discard</Button>
          <Button size="sm" disabled={saving} onClick={() => void save()}>Save</Button>
        </div>
      )}
      {writing && <SelectionToolbar editor={editor} docId={`site:${item.path}`} />}
      <SlashMenu />
    </div>
  )
}
