// Dropping onto the main panel: a block from the tree opens it; a Markdown or text file opens as a new
// private block. Images are the editor's own (they go into the block where they are dropped).
import { notify } from "@/components/ui/notice"
import { open, openFile, report } from "./store"

export const DOC_DRAG = "application/x-ohm-doc"
const TEXT_FILE = /\.(md|markdown|txt)$/i

/** Whether a drag carries something the main panel opens. */
export const opensOnDrop = (dt: DataTransfer | null) =>
  !!dt && (dt.types.includes(DOC_DRAG) || [...dt.items].some(i => i.kind === "file" && (i.type === "text/markdown" || i.type === "text/plain" || i.type === "")))

/** Opens what was dropped. Returns whether it handled the drop. */
export async function openDropped(dt: DataTransfer): Promise<boolean> {
  const id = dt.getData(DOC_DRAG)
  if (id) { open(id); return true }
  const files = [...dt.files].filter(f => TEXT_FILE.test(f.name))
  if (!files.length) return false
  for (const f of files) await report(openFile(f.name, await f.text()))
  notify({ message: files.length === 1 ? `Opened “${files[0].name}” as a private block` : `Opened ${files.length} files as private blocks`, tone: "info" })
  return true
}

/** Saving by dragging out: the block as a .md file, wherever the browser lets it land. */
export function dragOutAsMarkdown(dt: DataTransfer, id: string, name: string, markdown: string) {
  const file = `${(name || "Untitled block").replace(/[\\/:*?"<>|]/g, "-")}.md`
  dt.setData(DOC_DRAG, id)
  dt.setData("text/plain", markdown)
  dt.setData("DownloadURL", `text/markdown:${file}:data:text/markdown;charset=utf-8,${encodeURIComponent(markdown)}`)
  dt.effectAllowed = "copyMove"
}

/** Saving by menu: downloads the block as a .md file. */
export function saveAsMarkdown(name: string, markdown: string) {
  const a = document.createElement("a")
  a.href = URL.createObjectURL(new Blob([markdown], { type: "text/markdown" }))
  a.download = `${(name || "Untitled block").replace(/[\\/:*?"<>|]/g, "-")}.md`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
