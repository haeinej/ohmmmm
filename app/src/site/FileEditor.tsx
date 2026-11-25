// A plain text editor for any file of the site that is not a page or a block: stylesheets, scripts,
// CNAME, data (flows/site.md, Files). Save writes the whole file over the version it was read at:
// an ordinary save, kept in the save log and restorable from History, and published only by
// Publish. ⌘Z inside the text takes typing back as any text field does.
import { useEffect, useState } from "react"
import { XIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Icon } from "@/components/ui/icon"
import { notify } from "@/components/ui/notice"
import { Textarea } from "@/components/ui/textarea"
import { readFileText, saveFileText, siteUrl } from "./source"

const TEXT = /\.(?:html?|css|m?js|json|xml|txt|md|svg|webmanifest|toml|ya?ml)$|(?:^|\/)(?:CNAME|_headers|_redirects)$/i
const IMAGE = /\.(?:jpe?g|png|webp|gif|svg|avif|ico)$/i

export function FileEditor({ path, onClose }: { path: string; onClose(): void }) {
  const [read, setRead] = useState<{ text: string; version: string } | null>(null)
  const [text, setText] = useState("")
  const [saving, setSaving] = useState(false)
  const isText = TEXT.test(path)

  useEffect(() => {
    setRead(null)
    if (!isText) return
    readFileText(path).then(r => { setRead(r); setText(r.text) }, e => notify({ message: (e as Error).message, tone: "error" }))
  }, [path, isText])

  const changed = read !== null && text !== read.text
  const save = async () => {
    if (!read) return
    setSaving(true)
    try {
      const version = await saveFileText(path, text, read.version)
      setRead({ text, version })
      notify({ message: `Saved to ${path}. It is on your computer only until you publish your site.` })
    } catch (e) { notify({ message: (e as Error).message, tone: "error" }) }
    setSaving(false)
  }

  return (
    <div role="dialog" aria-label={path} className="absolute inset-0 z-10 flex min-h-0 flex-col bg-card"
      onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); if (changed) void save() } if (e.key === "Escape" && !changed) onClose() }}>
      <header className="flex h-14 shrink-0 items-center gap-2 px-5">
        <span className="min-w-0 flex-1 truncate text-small font-medium">{path}</span>
        {changed && <span className="text-small text-muted-foreground">Not saved</span>}
        {isText && <Button size="sm" variant="ghost" disabled={!changed || saving} onClick={() => read && setText(read.text)}>Discard</Button>}
        {isText && <Button size="sm" disabled={!changed || saving} onClick={() => void save()}>Save</Button>}
        <Button size="icon-sm" variant="ghost" aria-label="Close" onClick={onClose}><Icon icon={XIcon} /></Button>
      </header>
      <div className="flex min-h-0 flex-1 px-5 pb-5">
        {isText
          ? read
            ? <Textarea aria-label={`Text of ${path}`} spellCheck={false} value={text} onChange={e => setText(e.target.value)}
                className="min-h-0 flex-1 resize-none font-mono text-small leading-relaxed" />
            : <p className="text-small text-muted-foreground">Reading {path}</p>
          : IMAGE.test(path)
            ? <img src={siteUrl(path)} alt="" className="m-auto max-h-full max-w-full object-contain" />
            : <p className="text-small text-muted-foreground">{path} isn't text, so it can't be changed here. Move or rename it from Files.</p>}
      </div>
    </div>
  )
}
