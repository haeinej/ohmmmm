// The visibility pills show each block's layer. Widening access asks for approval; public is reached only through Publish.
// The tree's rows are ohm-ui's, so the pills sit over them, measured from the rows.
import { useLayoutEffect, useState } from "react"
import type { LucideIcon } from "lucide-react"
import { CheckIcon, GlobeIcon, LockIcon, UsersIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Icon } from "@/components/ui/icon"
import { notify } from "@/components/ui/notice"
import { isBlock, byId, docIdOf, titleOf, type Doc, type Visibility } from "@/data/workspace-data"
import { cn } from "@/lib/cn"
import { setVisibility, useWorkspace } from "./store"

export const VISIBILITY: Record<Visibility, { label: string; icon: LucideIcon }> = {
  private: { label: "Only you", icon: LockIcon },
  friends: { label: "Friends", icon: UsersIcon },
  public: { label: "Everyone", icon: GlobeIcon },
}
const openness: Record<Visibility, number> = { private: 0, friends: 1, public: 2 }
type Mark = { id: string; top: number; height: number }

export function VisibilityMarks({ container }: { container: HTMLElement | null }) {
  const { rev, showVisibility } = useWorkspace()
  const [marks, setMarks] = useState<Mark[]>([])
  const [asking, setAsking] = useState<{ doc: Doc; to: Visibility } | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)

  // Measure every block row, again whenever the tree changes shape.
  useLayoutEffect(() => {
    if (!container || !showVisibility) return setMarks([])
    const measure = () => {
      const base = container.getBoundingClientRect()
      const next: Mark[] = []
      container.querySelectorAll<HTMLElement>("[data-slot=file-tree-item], [data-row-id]").forEach(el => {
        const id = el.dataset.rowId ?? el.dataset.id ?? ""
        if (!id || id.includes(":") || !byId(docIdOf(id))) return
        const r = el.getBoundingClientRect()
        next.push({ id, top: r.top - base.top, height: r.height })
      })
      setMarks(prev => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next))
    }
    measure()
    const mo = new MutationObserver(measure)
    mo.observe(container, { childList: true, subtree: true })
    const ro = new ResizeObserver(measure)
    ro.observe(container)
    return () => { mo.disconnect(); ro.disconnect() }
  }, [container, showVisibility, rev])

  const change = (doc: Doc, to: Visibility) => {
    if (to === doc.visibility) return
    if (to === "public") return notify({ message: "A block becomes public through Publish, which shows a preview and asks first.", tone: "info" })
    if (openness[to] > openness[doc.visibility]) return setAsking({ doc, to })
    setVisibility(doc.id, to)
      .then(() => notify({ message: `“${titleOf(doc)}” is now for ${VISIBILITY[to].label.toLowerCase()}`, tone: "info" }))
      .catch(err => notify({ message: (err as Error).message }))
  }

  if (!showVisibility) return null
  return <>
    {marks.map(m => {
      const doc = byId(docIdOf(m.id))
      if (!doc) return null
      const block = isBlock(doc)
      const v = block ? doc.visibility : "private"
      const pill = cn(
        // Icon only: the label is in the tooltip and for screen readers.
        "pointer-events-auto absolute right-8 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-full transition-colors duration-(--ohm-duration-press)",
        v === "public" ? "bg-primary/10 text-primary dark:bg-(--ohm-green-light)/15 dark:text-(--ohm-green-light)"
          : v === "friends" ? "bg-foreground/8 text-foreground" : "text-muted-foreground",
      )
      return (
        <div key={m.id} data-row-menu className="pointer-events-none absolute inset-x-0 z-[9]" style={{ top: m.top, height: m.height }}>
          {block ? (
            <DropdownMenu open={openId === m.id} onOpenChange={o => setOpenId(o ? m.id : null)}>
              <DropdownMenuTrigger render={<button type="button" title={VISIBILITY[v].label} aria-label={`“${titleOf(doc)}” is for ${VISIBILITY[v].label}. Change`} className={cn(pill, "hover:bg-foreground/12")} />}>
                <Icon icon={VISIBILITY[v].icon} size="xs" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                {(["private", "friends", "public"] as Visibility[]).map(o => (
                  <DropdownMenuItem key={o} onClick={() => { setOpenId(null); change(doc, o) }} className="flex items-center gap-2">
                    <Icon icon={VISIBILITY[o].icon} size="sm" /><span className="flex-1">{VISIBILITY[o].label}</span>
                    <Icon icon={CheckIcon} size="sm" className={cn(o !== v && "invisible")} />
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <span className={pill} title="Only you: your cortex is yours alone" aria-label="Only you"><Icon icon={LockIcon} size="xs" /></span>
          )}
        </div>
      )
    })}

    <Dialog open={!!asking} onOpenChange={o => !o && setAsking(null)}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Show “{asking && titleOf(asking.doc)}” to {asking && VISIBILITY[asking.to].label.toLowerCase()}?</DialogTitle>
          <DialogDescription>
            Your vault service and your friends can read the shared copy. Publishing is a separate step with its own preview and approval.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setAsking(null)}>Cancel</Button>
          <Button onClick={() => {
            if (!asking) return
            const { doc, to } = asking
            setVisibility(doc.id, to)
              .then(() => notify({ message: `“${titleOf(doc)}” is now for ${VISIBILITY[to].label.toLowerCase()}`, tone: "info" }))
              .catch(err => notify({ message: (err as Error).message }))
            setAsking(null)
          }}>Change visibility</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>
}
