// Any file of the site that is not a page or a block, in the main area (docs/plans/information-and-viewer.md,
// step 3): code and data in a real code editor; Markdown read the way GitHub shows it, with Code to
// change it; a picture as itself. Save writes the whole file over the version it was read at: an
// ordinary save, kept in the save log and restorable from History, and published only by Publish.
import { useCallback, useEffect, useState } from "react"
import { XIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Icon } from "@/components/ui/icon"
import { notify } from "@/components/ui/notice"
import { CodeView } from "@/viewers/CodeView"
import { MarkdownView } from "@/viewers/MarkdownView"
import { askToOpenFile, readFileText, saveFileText, siteUrl } from "./source"

export const TEXT = /\.(?:html?|css|[mc]?[jt]sx?|json|jsonc|xml|txt|md|markdown|mdx|svg|webmanifest|toml|ya?ml|astro|svelte|vue|sh|py|rb|go|rs)$|(?:^|\/)(?:CNAME|_headers|_redirects|LICENSE|\.gitignore)$/i
const IMAGE = /\.(?:jpe?g|png|webp|gif|svg|avif|ico)$/i
const MARKDOWN = /\.(?:md|markdown|mdx)$/i

export function FileEditor({ path, onClose }: { path: string; onClose(): void }) {
  const [read, setRead] = useState<{ path: string; text: string; version: string } | null>(null)
  const [text, setText] = useState("")
  const [saving, setSaving] = useState(false)
  const isText = TEXT.test(path)
  const isMarkdown = MARKDOWN.test(path)
  /** Markdown opens as it reads; Code shows its source to change. Everything else is code. */
  const [mode, setMode] = useState<"view" | "code">(isMarkdown ? "view" : "code")
  useEffect(() => setMode(MARKDOWN.test(path) ? "view" : "code"), [path])

  useEffect(() => {
    if (!isText) return
    let current = true
    readFileText(path).then(r => { if (current) { setRead({ path, ...r }); setText(r.text) } }, e => notify({ message: (e as Error).message, tone: "error" }))
    return () => { current = false }
  }, [path, isText])

  const ready = read?.path === path
  const changed = ready && text !== read.text
  const save = useCallback(async () => {
    if (!read || read.path !== path || text === read.text) return
    setSaving(true)
    try {
      const version = await saveFileText(path, text, read.version)
      setRead({ path, text, version })
      notify({ message: `Saved to ${path}. It is on your computer only until you publish your site.` })
    } catch (e) { notify({ message: (e as Error).message, tone: "error" }) }
    setSaving(false)
  }, [path, read, text])

  return (
    <div role="dialog" aria-label={path} className="absolute inset-0 z-10 flex min-h-0 flex-col bg-card"
      onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); void save() } if (e.key === "Escape" && !changed) onClose() }}>
      <header className="flex h-12 shrink-0 items-center gap-2 px-4">
        {isMarkdown && (
          <div role="tablist" aria-label="Show" className="flex gap-1">
            {(["view", "code"] as const).map(m => (
              <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)}
                className="h-8 rounded-full bg-muted px-3.5 text-small outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/40 aria-selected:bg-primary aria-selected:text-primary-foreground">
                {m === "view" ? "Preview" : "Code"}
              </button>
            ))}
          </div>
        )}
        <span className="flex-1" />
        {changed && <span className="text-small text-muted-foreground">Not saved</span>}
        {isText && <Button size="sm" variant="ghost" disabled={!changed || saving} onClick={() => read && setText(read.text)}>Discard</Button>}
        {isText && <Button size="sm" disabled={!changed || saving} onClick={() => void save()}>Save</Button>}
        <Button size="icon-sm" variant="ghost" aria-label="Close" onClick={onClose}><Icon icon={XIcon} /></Button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {isText
          ? !ready
            ? <div className="flex-1" aria-busy />
            : isMarkdown && mode === "view"
              ? <MarkdownView path={path} text={text} url={siteUrl} onOpen={askToOpenFile} />
              : <CodeView path={path} text={text} onChange={setText} onSave={() => void save()} />
          : IMAGE.test(path)
            ? <img src={siteUrl(path)} alt="" className="m-auto max-h-full max-w-full object-contain p-5" />
            : <p className="p-5 text-small text-muted-foreground">{path} isn't text, so it can't be shown here. Move or rename it from Sources.</p>}
      </div>
    </div>
  )
}
