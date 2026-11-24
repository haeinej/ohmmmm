// What a block can do, shared by the tree's ⋯ and the editor's path: renaming in place, and deleting
// after asking. Both menus call these, so a block behaves the same wherever you reach it.
import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { notify } from "@/components/ui/notice"
import { byId, isBlock, titleOf } from "@/data/workspace-data"
import { cn } from "@/lib/cn"
import { createChannel, deleteDoc, forgetCortex, renameDoc, renameChannel, revealFolder } from "./store"

/**
 * A name edited in place: the text selected, a forest ring. Enter or leaving keeps it; Escape puts
 * it back. Nothing is saved when it is empty or unchanged. Block titles and channel names both use it.
 */
export function InlineField({ initial, onCommit, onDone, className, label = "Name" }: {
  initial: string; onCommit: (next: string) => void; onDone: () => void; className?: string; label?: string
}) {
  const [value, setValue] = useState(initial)
  const ref = useRef<HTMLInputElement>(null)
  const finished = useRef(false)
  useEffect(() => { ref.current?.focus(); ref.current?.select() }, [])
  const finish = (keep: boolean) => {
    if (finished.current) return
    finished.current = true
    const next = value.trim()
    if (keep && next && next !== initial) onCommit(next)
    onDone()
  }
  return (
    <input ref={ref} value={value} aria-label={label} spellCheck={false}
      onChange={e => setValue(e.target.value)}
      onKeyDown={e => {
        e.stopPropagation()
        if (e.key === "Enter") { e.preventDefault(); finish(true) }
        if (e.key === "Escape") { e.preventDefault(); finish(false) }
      }}
      onBlur={() => finish(true)}
      onPointerDown={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
      className={cn(
        "min-w-0 rounded-md bg-background px-1.5 text-foreground outline-none ring-2 ring-primary/70 selection:bg-primary/25 dark:ring-(--ohm-green-light)/70",
        "animate-in fade-in-0 duration-(--ohm-duration-press)",
        className,
      )} />
  )
}

/** A block's name, in place. */
export function InlineRename({ id, className, onDone }: { id: string; className?: string; onDone: () => void }) {
  const doc = byId(id)
  if (!doc) return null
  return <InlineField initial={doc.title} className={className} onDone={onDone} onCommit={next => renameDoc(id, next)} />
}

/** Makes a channel, shows it in the tree, and starts renaming it in place. */
export function startChannel(inside?: string) {
  try {
    const path = createChannel(inside)
    revealFolder("vault", path)
    setTimeout(() => window.dispatchEvent(new CustomEvent("ohm:rename-row", { detail: { id: `vault:${path}` } })), 120)
  } catch (err) { notify({ message: (err as Error).message }) }
}

/** A channel's name, in place: `channel` or `channel/inner`. */
export function InlineRenameChannel({ path, className, onDone }: { path: string; className?: string; onDone: () => void }) {
  const name = path.split("/").at(-1)!
  return <InlineField initial={name} label="Channel name" className={className} onDone={onDone} onCommit={next => {
    let moved: { published: number }
    try { moved = renameChannel(path, next) } catch (err) { notify({ message: (err as Error).message }); return }
    const to = [...path.split("/").slice(0, -1), next.trim().toLowerCase().replace(/\s+/g, "-")].join("/")
    window.dispatchEvent(new CustomEvent("ohm:channel-renamed", { detail: { from: path, to } }))
    notify({ message: moved.published
      ? `Renamed to “${next}”. ${moved.published} ${moved.published === 1 ? "post gets" : "posts get"} the new address when you publish.`
      : `Renamed to “${next}”`, tone: "info" })
  }} />
}

// ─── Delete, after asking ─────────────────────────────────────────────────────

let asking: string | null = null
const listeners = new Set<() => void>()
export function requestDelete(id: string) { asking = id; listeners.forEach(l => l()) }
const close = () => { asking = null; listeners.forEach(l => l()) }

/** Mounted once; any menu asks through requestDelete. */
export function DeleteDialog() {
  const id = useSyncExternalStore(l => (listeners.add(l), () => listeners.delete(l)), () => asking)
  const doc = id ? byId(id) : undefined
  return (
    <Dialog open={!!doc} onOpenChange={o => !o && close()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{doc && !isBlock(doc) ? (doc.kind === "observation" ? "Forget" : "Remove") : "Delete"} “{doc && titleOf(doc)}”?</DialogTitle>
          <DialogDescription>
            {doc && !isBlock(doc)
              ? "It leaves your cortex, so agents no longer read it. The cortex keeps it in its history, so it can be restored."
              : doc?.visibility === "private"
              ? "It is removed from your vault. This cannot be undone."
              : "It is removed from your vault. If it is published, taking down the post is its own step, and copies others made stay where they are."}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={close}>Cancel</Button>
          <Button variant="destructive" onClick={() => {
            if (!doc) return
            const t = titleOf(doc)
            if (isBlock(doc)) deleteDoc(doc.id); else forgetCortex(doc.id)
            notify({ message: `${isBlock(doc) ? "Deleted" : doc.kind === "observation" ? "Forgot" : "Removed"} “${t}”`, tone: "info" })
            close()
          }}>{doc && !isBlock(doc) ? (doc.kind === "observation" ? "Forget" : "Remove") : "Delete"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
