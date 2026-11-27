// A Markdown file from a repository, read the way GitHub shows it (docs/plans/information-and-viewer.md,
// step 3): headings, tables, task lists, footnotes, code highlighted by language, and pictures and
// links written relative to the file resolved from where the file sits. Reads only.
import { useMemo } from "react"
import MarkdownIt from "markdown-it"
import footnote from "markdown-it-footnote"
import hljs from "highlight.js/lib/common"
import "./markdown.css"

/** A path relative to `from`'s folder, as the repository's own: `../a/b.png` from `docs/x.md` is `a/b.png`. */
export function resolveFrom(from: string, ref: string): string {
  const parts = from.split("/").slice(0, -1)
  for (const piece of ref.split("/")) {
    if (piece === "..") parts.pop()
    else if (piece && piece !== ".") parts.push(piece)
  }
  return parts.join("/")
}

const md: InstanceType<typeof MarkdownIt> = new MarkdownIt({
  html: true, linkify: true, typographer: false,
  highlight: (code: string, lang: string): string => {
    const language = lang && hljs.getLanguage(lang) ? lang : null
    const out: string = language ? hljs.highlight(code, { language, ignoreIllegals: true }).value : md.utils.escapeHtml(code)
    return `<pre class="hljs"><code>${out}</code></pre>`
  },
}).use(footnote)

// Task lists, as GitHub writes them: `- [ ]` and `- [x]` become checkboxes that can't be ticked here.
md.core.ruler.after("inline", "tasks", (state: Parameters<Parameters<typeof md.core.ruler.after>[2]>[0]): void => {
  for (const token of state.tokens) {
    if (token.type !== "inline" || !token.children?.length) continue
    const first = token.children[0]
    const m = /^\[([ xX])\]\s/.exec(first.content)
    if (first.type === "text" && m) {
      first.content = first.content.slice(m[0].length)
      const box = new state.Token("html_inline", "", 0)
      box.content = `<input type="checkbox" disabled${m[1] !== " " ? " checked" : ""}> `
      token.children.unshift(box)
    }
  }
})

/**
 * @param path  the file's path inside the repository
 * @param url   how a file of the repository is reached from here (its served address)
 * @param onOpen a link to another file of the repository, opened in place instead of followed
 */
export function MarkdownView({ path, text, url, onOpen, className = "ohm-markdown mx-auto w-full max-w-3xl px-8 py-8" }: { path: string; text: string; url(path: string): string; onOpen?(path: string): void
  /** The page's own classes, to read as another view does (the article reader's, for a writing's card). */
  className?: string }) {
  const rendered = useMemo(() => {
    const doc = new DOMParser().parseFromString(md.render(text), "text/html")
    const local = (ref: string | null) => !!ref && !/^(?:[a-z]+:|\/\/|#|\/)/i.test(ref)
    for (const el of doc.querySelectorAll<HTMLElement>("img[src], video[src], source[src]")) {
      const src = el.getAttribute("src")
      if (local(src)) el.setAttribute("src", url(resolveFrom(path, src!)))
    }
    for (const a of doc.querySelectorAll("a[href]")) {
      const href = a.getAttribute("href")
      if (local(href)) a.setAttribute("data-repo-path", resolveFrom(path, href!.split("#")[0]))
      else if (!href?.startsWith("#")) { a.setAttribute("target", "_blank"); a.setAttribute("rel", "noreferrer") }
    }
    // A heading gets the anchor GitHub would give it, so `#section` links work.
    for (const h of doc.querySelectorAll("h1, h2, h3, h4, h5, h6"))
      h.id = (h.textContent ?? "").trim().toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, "").replace(/\s+/g, "-")
    for (const s of doc.querySelectorAll("script")) s.remove()
    return doc.body.innerHTML
  }, [path, text, url])

  return (
    <article className={className}
      onClick={e => {
        const a = (e.target as HTMLElement).closest("a[data-repo-path]")
        if (a && onOpen) { e.preventDefault(); onOpen(a.getAttribute("data-repo-path")!) }
      }}
      dangerouslySetInnerHTML={{ __html: rendered }} />
  )
}
