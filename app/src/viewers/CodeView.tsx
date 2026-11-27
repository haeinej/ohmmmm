// A real code editor for any text file (docs/plans/information-and-viewer.md, step 3): CodeMirror 6
// with the file's language picked from its name, line numbers, folding, search (⌘F), and ⌘Z that
// takes back typing. It holds no state of its own: the text comes in and every change goes out.
import { useEffect, useRef } from "react"
import { EditorView, basicSetup } from "codemirror"
import { EditorState, type Extension } from "@codemirror/state"
import { keymap } from "@codemirror/view"
import { javascript } from "@codemirror/lang-javascript"
import { css } from "@codemirror/lang-css"
import { html } from "@codemirror/lang-html"
import { json } from "@codemirror/lang-json"
import { markdown } from "@codemirror/lang-markdown"
import { yaml } from "@codemirror/lang-yaml"
import { xml } from "@codemirror/lang-xml"

/** The language a file is written in, from its name. Plain text when there is none. */
export function languageOf(path: string): Extension[] {
  const ext = path.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? ""
  if (["js", "mjs", "cjs", "jsx"].includes(ext)) return [javascript({ jsx: true })]
  if (["ts", "mts", "cts", "tsx"].includes(ext)) return [javascript({ jsx: ext === "tsx", typescript: true })]
  if (ext === "css") return [css()]
  if (["html", "htm", "astro", "svelte", "vue"].includes(ext)) return [html()]
  if (["json", "jsonc", "webmanifest"].includes(ext)) return [json()]
  if (["md", "markdown", "mdx"].includes(ext)) return [markdown()]
  if (["yml", "yaml"].includes(ext)) return [yaml()]
  if (["xml", "svg"].includes(ext)) return [xml()]
  return []
}

/** The editor in ohm's own type and colours: no gutter edge, the page's background, mono at the small size. */
const look = EditorView.theme({
  "&": { height: "100%", fontSize: "var(--ohm-type-small-size, 13px)", backgroundColor: "transparent" },
  ".cm-scroller": { fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)", lineHeight: "1.6" },
  ".cm-gutters": { backgroundColor: "transparent", border: "none", color: "var(--muted-foreground)" },
  ".cm-activeLineGutter, .cm-activeLine": { backgroundColor: "color-mix(in oklab, var(--muted) 60%, transparent)" },
  "&.cm-focused": { outline: "none" },
  ".cm-content": { caretColor: "var(--foreground)" },
  ".cm-panels": { backgroundColor: "var(--card)", color: "var(--foreground)" },
})

export function CodeView({ path, text, readOnly, onChange, onSave }: {
  path: string; text: string; readOnly?: boolean
  onChange?(text: string): void
  /** ⌘S inside the editor. */
  onSave?(): void
}) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const latest = useRef({ onChange, onSave })
  latest.current = { onChange, onSave }

  // One editor per file; its text is replaced in place when the file is read again.
  useEffect(() => {
    if (!host.current) return
    view.current = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: text,
        extensions: [
          basicSetup, look, ...languageOf(path),
          EditorView.lineWrapping,
          EditorState.readOnly.of(!!readOnly),
          keymap.of([{ key: "Mod-s", preventDefault: true, run: () => { latest.current.onSave?.(); return true } }]),
          EditorView.updateListener.of(u => { if (u.docChanged) latest.current.onChange?.(u.state.doc.toString()) }),
        ],
      }),
    })
    return () => { view.current?.destroy(); view.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, readOnly])
  useEffect(() => {
    const v = view.current
    if (v && v.state.doc.toString() !== text) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: text } })
  }, [text])

  return <div ref={host} aria-label={`Text of ${path}`} className="min-h-0 flex-1 overflow-hidden" />
}
