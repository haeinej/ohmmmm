// An internal tool, running (docs/serve.md): its page in a sandboxed frame with no origin of its own, no
// network (a content security policy says so) and no reach into ohm. What it may know it asks for, and ohm
// answers from what the person already has: their channels and blocks, links, and the canvas. Read only.
import { useEffect, useRef, useState } from "react"
import { cn } from "@/lib/cn"
import { readBoard } from "./live"
import { readContent, readLinks, readToolPage, TOOLS_CHANGED } from "./source"

/** What a tool can ask, and the answer, from what the app can read. */
async function answer(what: string, args: Record<string, unknown>) {
  if (what === "channels") {
    const c = await readContent()
    return c.collections.map(x => ({ name: x.name, blocks: x.items.length, inside: [...new Set(x.items.map(i => i.channel).filter(Boolean))] }))
  }
  if (what === "items") {
    const [outer, inner] = String(args.channel ?? "").split("/")
    const c = (await readContent()).collections.find(x => x.name === outer)
    return (c?.items ?? []).filter(i => !inner || i.channel === inner).map(i => ({ path: i.path, title: i.title, kind: i.kind, modified: i.modified, excerpt: i.excerpt }))
  }
  if (what === "links") return readLinks()
  if (what === "canvas") return (await readBoard())?.cards ?? []
  throw new Error(`A tool can ask for channels, items, links or canvas, not ${what}`)
}

const PREAMBLE = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:">
<script>
  // ohm.ask(what, args): what this tool may read from the person's ohm, answered by the app. Nothing else reaches out.
  window.ohm = { ask(what, args) { return new Promise((ok, no) => { const id = Math.random().toString(36).slice(2);
    const on = e => { if (e.data && e.data.ohm === "answer" && e.data.id === id) { removeEventListener("message", on); e.data.error ? no(new Error(e.data.error)) : ok(e.data.data) } };
    addEventListener("message", on); parent.postMessage({ ohm: "ask", id, what, args: args || {} }, "*") }) } };
</script>
<style>html{font-family:"Helvetica Neue",Helvetica,Arial,sans-serif;color:#242424}</style>`

export function ToolFrame({ name, live = true, className }: { name: string; live?: boolean; className?: string }) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [html, setHtml] = useState<string | null>(null)
  const [failed, setFailed] = useState("")
  useEffect(() => {
    const read = () => { readToolPage(name).then(h => setHtml(PREAMBLE + h), e => setFailed((e as Error).message)) }
    read()
    const onTools = (e: Event) => { if ((e as CustomEvent<string>).detail === name) read() }
    window.addEventListener(TOOLS_CHANGED, onTools)
    return () => window.removeEventListener(TOOLS_CHANGED, onTools)
  }, [name])
  // Answer only this frame's questions.
  useEffect(() => {
    const on = async (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow || e.data?.ohm !== "ask") return
      const reply = (body: object) => frame.current?.contentWindow?.postMessage({ ohm: "answer", id: e.data.id, ...body }, "*")
      try { reply({ data: await answer(String(e.data.what), e.data.args ?? {}) }) } catch (problem) { reply({ error: (problem as Error).message }) }
    }
    window.addEventListener("message", on)
    return () => window.removeEventListener("message", on)
  }, [])
  if (failed) return <span className={cn("flex size-full items-center justify-center p-4 text-small text-muted-foreground", className)}>{failed}</span>
  return (
    <span className={cn("relative block size-full overflow-hidden bg-white", className)}>
      {html !== null && <iframe ref={frame} title={name} srcDoc={html} sandbox="allow-scripts allow-forms" className="absolute inset-0 size-full border-0" />}
      {!live && <span aria-hidden className="absolute inset-0" />}
    </span>
  )
}
