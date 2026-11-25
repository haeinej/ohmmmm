// An article or a project, opened as writing and not as a web page (flows/site.md): its title, the
// line under it, and its body in the app's own editor, pictures in place. What is saved goes back
// into the page's file, one changed paragraph at a time.
import { useEffect, useRef, useState } from "react"
import { EditorContent, useEditor } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import Image from "@tiptap/extension-image"
import Highlight from "@tiptap/extension-highlight"
import { Markdown } from "@tiptap/markdown"
import { Button } from "@/components/ui/button"
import { notify } from "@/components/ui/notice"
import "@/editor/editor.css"
import { plain, readArticle, type Change, type SiteArticle } from "./source"

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

export function ArticleView({ path, onSave }: {
  path: string
  /** Save one change to the article's page. The Site view's own handler, shared with its tools. */
  onSave(page: string, change: Change): Promise<unknown>
}) {
  const [article, setArticle] = useState<SiteArticle | null>(null)
  const [failed, setFailed] = useState("")
  useEffect(() => { setArticle(null); setFailed(""); readArticle(path).then(setArticle, e => setFailed((e as Error).message)) }, [path])
  if (failed) return <p className="p-8 text-small text-muted-foreground">{failed}</p>
  if (!article) return <div className="flex-1" aria-busy />
  return <Writing key={path} path={path} article={article} onSave={onSave} />
}

function Writing({ path, article, onSave }: { path: string; article: SiteArticle; onSave(page: string, change: Change): Promise<unknown> }) {
  const [changed, setChanged] = useState(false)
  const [saving, setSaving] = useState(false)
  const first = useRef<string[]>([])
  const editor = useEditor({
    immediatelyRender: true,
    extensions: [StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: { openOnClick: false } }), Image, Highlight, Markdown],
    content: article.markdown,
    contentType: "markdown",
    editorProps: { attributes: { class: "ohm-prose", "aria-label": article.title } },
    // What the article said when it opened, read once the Markdown is in the editor.
    onCreate: ({ editor: e }) => { first.current = blocksOf(e.getJSON()) },
    onUpdate: ({ editor: e }) => setChanged(blocksOf(e.getJSON()).join("\n") !== first.current.join("\n")),
  }, [path])

  /**
   * Each paragraph whose words changed is changed in the page's file, by what it said before.
   * A paragraph added, removed or holding a link or bold text can't be placed that way yet, and
   * nothing is written for it.
   */
  const save = async () => {
    const now = blocksOf(editor.getJSON())
    const before = first.current
    if (!before.length) return
    if (now.length !== before.length) return notify({ message: "Adding or removing a paragraph can't be saved to the page yet. Change words within paragraphs, or undo.", tone: "error" })
    setSaving(true)
    const page = path.split("#")[0]
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
    <div className="flex size-full min-h-0 flex-col bg-card">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <article className="mx-auto flex w-full max-w-[720px] flex-col gap-2 px-10 py-12">
          <h1 className="break-words">{article.title}</h1>
          {article.details && <p className="text-small text-muted-foreground">{article.details}</p>}
          <div className="pt-4"><EditorContent editor={editor} /></div>
        </article>
      </div>
      {changed && (
        <div role="status" className="flex shrink-0 items-center justify-end gap-2 px-5 py-3 text-small">
          <span className="me-auto text-muted-foreground">Changed. Saving writes it into {path.split("#")[0]}.</span>
          <Button size="sm" variant="ghost" disabled={saving} onClick={() => { editor.commands.setContent(article.markdown, { contentType: "markdown" }); setChanged(false) }}>Discard</Button>
          <Button size="sm" disabled={saving} onClick={() => void save()}>Save</Button>
        </div>
      )}
    </div>
  )
}
