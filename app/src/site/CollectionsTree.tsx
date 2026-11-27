// Collections as a file tree (docs/plans/information-and-viewer.md): the same channels as the tiles, read
// as folders: Artifacts and each channel a folder, a channel inside it a folder within, each block a
// file. Clicking a file opens it over the canvas; any row can be dragged onto the canvas (a block, a
// channel, a page), as its tile can.
import { useEffect, useMemo, useRef, useState } from "react"
import { FileTree, type FileTreeNode } from "@/components/ui/file-tree"
import { CHANNEL, FILE, ITEM } from "./Board"
import { goTo } from "./nav"
import { askToOpenBlock, channelsIn, type SiteContent, type SiteItem } from "./source"

const PAGE = "page:", CH = "channel:"

export function CollectionsTree({ content }: { content: SiteContent | null }) {
  const ref = useRef<HTMLDivElement>(null)
  const [selected, setSelected] = useState<string>()
  const { nodes, items } = useMemo(() => {
    const items = new Map<string, SiteItem>()
    const file = (i: SiteItem): FileTreeNode => { items.set(i.path, i); return { id: i.path, name: i.title || i.path.split("/").at(-1)! } }
    const nodes: FileTreeNode[] = [
      { id: `${CH}Artifacts`, name: "Artifacts", children: [{ id: `${PAGE}index.html`, name: "Home" }] },
      ...(content?.collections ?? []).map(c => ({
        id: `${CH}${c.name}`, name: c.name,
        children: [
          ...channelsIn(c.items).map(inner => ({ id: `${CH}${c.name}/${inner.name}`, name: inner.name, children: inner.items.map(file) })),
          ...c.items.filter(i => !i.channel).map(file),
        ],
      })),
    ]
    return { nodes, items }
  }, [content])

  // The tree draws its rows as ohm-ui has them; this makes each row draggable onto the canvas.
  useEffect(() => {
    ref.current?.querySelectorAll<HTMLElement>("[data-slot=file-tree-item]").forEach(row => {
      const id = row.dataset.id ?? ""
      row.draggable = true
    })
  })
  useEffect(() => {
    const root = ref.current
    if (!root) return
    const onDragStart = (e: DragEvent) => {
      const id = (e.target as HTMLElement).closest<HTMLElement>("[data-slot=file-tree-item]")?.dataset.id
      if (!id || !e.dataTransfer) return
      if (id.startsWith(PAGE)) e.dataTransfer.setData(FILE, id.slice(PAGE.length))
      else if (id.startsWith(CH)) e.dataTransfer.setData(CHANNEL, id.slice(CH.length))
      else { const item = items.get(id); if (item) e.dataTransfer.setData(ITEM, JSON.stringify(item)) }
      e.dataTransfer.setData("text/plain", id)
      e.dataTransfer.effectAllowed = "copy"
    }
    root.addEventListener("dragstart", onDragStart)
    return () => root.removeEventListener("dragstart", onDragStart)
  }, [items])

  return (
    <div ref={ref} className="rounded-lg bg-muted/60 p-1">
      <FileTree aria-label="Collections" nodes={nodes} selected={selected} defaultExpanded={[`${CH}Artifacts`]}
        onSelect={(id, node) => {
          if (node.children) return
          setSelected(id)
          if (id.startsWith(PAGE)) goTo({ kind: "page", path: id.slice(PAGE.length) })
          else askToOpenBlock(id)
        }} />
    </div>
  )
}
