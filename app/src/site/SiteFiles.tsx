// Files, in the side panel beside the Site view (flows/site.md): every file git tracks in the site,
// as a tree. A file changed since the last publish is marked; one no page uses is dimmed. A page
// opens on the canvas, an image or an article as a block, and anything else, stylesheets and
// scripts included, in the plain text editor. Dragging a file onto a folder, or Rename or move in
// its menu, moves it: a save like any other, published only by Publish.
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { FileTree, type FileTreeNode } from "@/components/ui/file-tree"
import { Input } from "@/components/ui/input"
import { notify } from "@/components/ui/notice"
import { askToOpen, askToOpenBlock, askToOpenFile, moveSiteFile, readTree, SITE_SAVED, type SiteContent, type SiteFile } from "./source"

const DIR = "dir:"

/** Files as folders and files, folders first, each by name. */
export function treeOf(files: SiteFile[]): FileTreeNode[] {
  const root: FileTreeNode = { id: DIR, name: "", children: [] }
  for (const file of files) {
    const parts = file.path.split("/")
    let at = root
    parts.slice(0, -1).forEach((part, i) => {
      const id = `${DIR}${parts.slice(0, i + 1).join("/")}`
      let next = at.children!.find(c => c.id === id)
      if (!next) { next = { id, name: part, children: [] }; at.children!.push(next) }
      at = next
    })
    at.children!.push({ id: file.path, name: parts.at(-1)! })
  }
  const sort = (nodes: FileTreeNode[]): FileTreeNode[] => nodes
    .sort((a, b) => Number(!a.children) - Number(!b.children) || a.name.localeCompare(b.name))
    .map(n => n.children ? { ...n, children: sort(n.children) } : n)
  return sort(root.children!)
}

/** Where a file opens: a page on the canvas, a block over it, anything else in the text editor. */
export function openFile(path: string, content: SiteContent | null) {
  if (/\.html?$/i.test(path)) return askToOpen(path)
  if (content?.collections.some(c => c.items.some(i => i.path === path))) return askToOpenBlock(path)
  askToOpenFile(path)
}

export function SiteFiles({ content }: { content: SiteContent | null }) {
  const [files, setFiles] = useState<SiteFile[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [moving, setMoving] = useState<{ from: string; to: string } | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const reload = useCallback(() => readTree().then(setFiles, e => notify({ message: (e as Error).message, tone: "error" })), [])
  useEffect(() => {
    void reload()
    window.addEventListener(SITE_SAVED, reload)
    return () => window.removeEventListener(SITE_SAVED, reload)
  }, [reload])
  const nodes = useMemo(() => treeOf(files ?? []), [files])
  const byPath = useMemo(() => new Map((files ?? []).map(f => [f.path, f])), [files])

  const move = useCallback(async (from: string, to: string) => {
    if (!to || to === from) return
    try { await moveSiteFile(from, to); notify({ message: `Moved to ${to}. It is on your computer only until you publish.` }) }
    catch (e) { notify({ message: (e as Error).message, tone: "error" }) }
  }, [])

  // The tree draws its rows as ohm-ui has them; this marks each file row and makes it draggable.
  useEffect(() => {
    ref.current?.querySelectorAll<HTMLElement>("[data-slot=file-tree-item]").forEach(row => {
      const file = byPath.get(row.dataset.id ?? "")
      row.draggable = Boolean(file)
      row.toggleAttribute("data-site-changed", Boolean(file?.changed))
      row.toggleAttribute("data-site-unused", Boolean(file && !file.used))
      row.title = file ? [file.path, file.changed && "changed, not published", !file.used && "no page uses it"].filter(Boolean).join(" · ") : ""
    })
  })
  useEffect(() => {
    const root = ref.current
    if (!root) return
    const rowOf = (e: Event) => (e.target as HTMLElement).closest<HTMLElement>("[data-slot=file-tree-item]")
    const onDragStart = (e: DragEvent) => { const id = rowOf(e)?.dataset.id; if (id && byPath.has(id)) { e.dataTransfer?.setData("application/x-ohm-site-file", id); e.dataTransfer!.effectAllowed = "copyMove" } }
    const folderOf = (e: DragEvent) => { const id = rowOf(e)?.dataset.id ?? ""; return id.startsWith(DIR) ? id.slice(DIR.length) : id.includes("/") ? id.slice(0, id.lastIndexOf("/")) : "" }
    const onDragOver = (e: DragEvent) => { if (e.dataTransfer?.types.includes("application/x-ohm-site-file")) { e.preventDefault(); e.dataTransfer.dropEffect = "move" } }
    const onDrop = (e: DragEvent) => {
      const from = e.dataTransfer?.getData("application/x-ohm-site-file")
      if (!from) return
      e.preventDefault()
      const folder = folderOf(e)
      void move(from, `${folder ? `${folder}/` : ""}${from.split("/").at(-1)}`)
    }
    const onMenu = (e: MouseEvent) => { const id = rowOf(e)?.dataset.id; if (id && byPath.has(id)) { e.preventDefault(); setMoving({ from: id, to: id }) } }
    root.addEventListener("dragstart", onDragStart); root.addEventListener("dragover", onDragOver); root.addEventListener("drop", onDrop); root.addEventListener("contextmenu", onMenu)
    return () => { root.removeEventListener("dragstart", onDragStart); root.removeEventListener("dragover", onDragOver); root.removeEventListener("drop", onDrop); root.removeEventListener("contextmenu", onMenu) }
  }, [byPath, move])

  const changed = (files ?? []).filter(f => f.changed).length
  return (
    <div className="flex flex-col gap-2">
      <p className="px-2 text-small text-muted-foreground">
        {files === null ? "Reading your site's files" : `${files.length} files${changed ? ` · ${changed} changed, not published` : ""}. Right-click a file to rename or move it.`}
      </p>
      <div ref={ref} className="[&_[data-site-unused]]:opacity-50 [&_[data-site-changed]]:font-semibold [&_[data-site-changed]_.truncate]:after:ms-1 [&_[data-site-changed]_.truncate]:after:text-primary [&_[data-site-changed]_.truncate]:after:content-['•']">
        <FileTree aria-label="Site files" nodes={nodes} selected={selected}
          onSelect={(id, node) => { if (node.children) return; setSelected(id); openFile(id, content) }} />
      </div>
      <Dialog open={moving !== null} onOpenChange={open => { if (!open) setMoving(null) }}>
        <DialogContent className="sm:max-w-sm">
          <form className="contents" onSubmit={e => { e.preventDefault(); if (moving) { void move(moving.from, moving.to.trim()); setMoving(null) } }}>
            <DialogHeader>
              <DialogTitle>Rename or move</DialogTitle>
              <DialogDescription>{moving?.from}: give its new name, with its folder. Pages that link to it are not changed.</DialogDescription>
            </DialogHeader>
            <Input aria-label="New path" value={moving?.to ?? ""} onChange={e => setMoving(m => m && { ...m, to: e.target.value })} autoFocus />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setMoving(null)}>Cancel</Button>
              <Button type="submit" disabled={!moving?.to.trim() || moving.to.trim() === moving.from}>Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
