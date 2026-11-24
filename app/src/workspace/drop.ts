// Dropping onto the main panel: a block from the tree opens it; a Markdown or text file opens as a new
// private block. Images are the editor's own (they go into the block where they are dropped).
import { notify } from "@/components/ui/notice"
import type { Exported } from "@/media/export"
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

const base64 = (bytes: Uint8Array) => {
  let text = ""
  for (let at = 0; at < bytes.length; at += 0x8000) text += String.fromCharCode(...bytes.subarray(at, at + 0x8000))
  return btoa(text)
}

/** Where a dragged-out file comes from: its bytes, written into the drag so they need no tab to stay open. */
export const downloadUrl = (file: Exported) => file.type === "text/markdown"
  ? `text/markdown:${file.name}:data:text/markdown;charset=utf-8,${encodeURIComponent(new TextDecoder().decode(file.bytes))}`
  : `${file.type}:${file.name}:data:${file.type};base64,${base64(file.bytes)}`

/**
 * Saving by dragging out, wherever the browser lets it land: the block as a .md file, or as a .zip
 * with its images when it shows some (src/media/export.ts). The export has to be ready when the drag
 * starts; without it, the drag still carries the block within the workspace and its text.
 */
export function dragOut(dt: DataTransfer, id: string, markdown: string, file: Exported | null) {
  dt.setData(DOC_DRAG, id)
  dt.setData("text/plain", markdown)
  if (file) dt.setData("DownloadURL", downloadUrl(file))
  else notify({ message: "An image in this block is still loading. Drag it out again in a moment.", tone: "info" })
  dt.effectAllowed = "copyMove"
}

/** Saving by menu: downloads the block as a .md file, or a .zip with its images. */
export function saveExport(file: Exported) {
  const a = document.createElement("a")
  a.href = URL.createObjectURL(new Blob([file.bytes.slice()], { type: file.type }))
  a.download = file.name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  if (file.missing.length) notify({ message: `Saved without ${file.missing.length === 1 ? "one image" : `${file.missing.length} images`} this device does not have`, tone: "info" })
  else if (file.images) notify({ message: `Saved as ${file.name}, with ${file.images === 1 ? "its image" : `its ${file.images} images`}`, tone: "info" })
}
