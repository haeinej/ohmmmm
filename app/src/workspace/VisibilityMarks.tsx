// The visibility pills show each block's layer. Every move shows its preview first (the shared rules,
// vault/vault/visibility.mjs); one that shows a block to more people asks for approval, and public
// is finished on the Publish page, which previews the one post. While the pills are on screen, an
// agent has the same two steps as tools: visibility.preview and visibility.move. On the home on this
// computer (ohm serve) public is Publish's dialog instead (PublishDialog): the bridge writes the post
// to the person's PDS, and taking a public block back first takes its post down.
// The tree's rows are ohm-ui's, so the pills sit over them, measured from the rows.
import { useEffect, useLayoutEffect, useState } from "react"
import type { LucideIcon } from "lucide-react"
import { CheckIcon, GlobeIcon, LockIcon, UsersIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Icon } from "@/components/ui/icon"
import { notify } from "@/components/ui/notice"
import { getSource, isBlock, byId, docIdOf, titleOf, type Doc, type Visibility } from "@/data/workspace-data"
import { cn } from "@/lib/cn"
import { previewMove, setVisibility, useWorkspace } from "./store"
import { registerStepTool } from "@/webmcp"
import { PublishDialog, TakeDownDialog } from "./PublishDialog"

/** Whether the workspace is the home on this computer, which publishes through its own dialog. */
const onThisComputer = () => { const source = getSource(); return !!source && "home" in source }

export const VISIBILITY: Record<Visibility, { label: string; icon: LucideIcon }> = {
  private: { label: "Only you", icon: LockIcon },
  friends: { label: "Friends", icon: UsersIcon },
  public: { label: "Everyone", icon: GlobeIcon },
}
const openness: Record<Visibility, number> = { private: 0, friends: 1, public: 2 }
type Mark = { id: string; top: number; height: number }

export function VisibilityMarks({ container }: { container: HTMLElement | null }) {
  const { rev, showVisibility, agentsAllowed, offered } = useWorkspace()
  const [marks, setMarks] = useState<Mark[]>([])
  const [asking, setAsking] = useState<{ doc: Doc; to: Visibility; warning: string; answer?: (ok: boolean) => void } | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [publishing, setPublishing] = useState<Doc | null>(null)
  const [takingDown, setTakingDown] = useState<{ doc: Doc; to: "private" | "friends" } | null>(null)
  const local = onThisComputer()

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

  const move = (doc: Doc, to: Visibility) => setVisibility(doc.id, to).then(result => {
    if (result.publish) {
      notify({ message: `“${titleOf(doc)}” is marked for ${VISIBILITY[to].label.toLowerCase()}. Finish it on the Publish page.`, tone: "info" })
      window.open(result.publish, "_blank", "noopener")
    } else notify({ message: `“${titleOf(doc)}” is now for ${VISIBILITY[to].label.toLowerCase()}`, tone: "info" })
    return result
  })
  const change = (doc: Doc, to: Visibility) => {
    // Everyone again, on a public block in the home on this computer: its post is updated to the block as it is now.
    if (local && to === "public") return setPublishing(doc)
    if (to === doc.visibility) return
    if (local && doc.visibility === "public") return setTakingDown({ doc, to: to === "friends" ? "friends" : "private" })
    let warning: string
    try { warning = previewMove(doc.id, to).warning } catch (err) { return notify({ message: (err as Error).message }) }
    // Showing it to more people, or anything that goes through Publish, asks first.
    if (openness[to] > openness[doc.visibility] || to === "public" || doc.visibility === "public") return setAsking({ doc, to, warning })
    move(doc, to).catch(err => notify({ message: (err as Error).message }))
  }

  // An agent's way in: the same preview and the same move, which stops at the same dialog.
  useEffect(() => {
    if (!showVisibility || !agentsAllowed) return
    const steps = new AbortController()
    const schema = { type: "object", properties: { id: { type: "string" }, to: { type: "string", enum: ["private", "friends", "public"] } }, required: ["id", "to"] } as const
    if (offered["visibility.preview"]) void registerStepTool<{ id: string; to: Visibility }, ReturnType<typeof previewMove>>({
      name: "visibility.preview", title: "Who can see it",
      description: "What moving one block to another layer would do: the action, whether it shows the block to more people, the warning, and what it still needs. Changes nothing.",
      inputSchema: schema, annotations: { readOnlyHint: true },
      run: async ({ id, to }) => previewMove(id, to),
    }, steps.signal)
    if (offered["visibility.move"]) void registerStepTool<{ id: string; to: Visibility }, Awaited<ReturnType<typeof setVisibility>>>({
      name: "visibility.move", title: "Change visibility",
      description: "Moves one block to another layer after the person approves the preview in a dialog. A move to or from public opens the Publish page for that post. Returns the block's id, its layer and the Publish page if any.",
      inputSchema: schema, annotations: { consequentialHint: true },
      approve: ({ id, to }, signal) => new Promise<boolean>((resolve, reject) => {
        const doc = byId(id)
        if (!isBlock(doc)) return reject(new DOMException("Only blocks have visibility", "DataError"))
        let warning: string
        try { warning = previewMove(id, to).warning } catch (err) { return reject(err) }
        signal.addEventListener("abort", () => { setAsking(null); reject(new DOMException("Cancelled", "AbortError")) })
        setAsking({ doc, to, warning, answer: resolve })
      }),
      run: async ({ id, to }) => {
        const doc = byId(id)
        if (!isBlock(doc)) throw new DOMException("Only blocks have visibility", "DataError")
        return move(doc, to)
      },
    }, steps.signal)
    return () => steps.abort()
  }, [showVisibility, agentsAllowed, offered]) // eslint-disable-line react-hooks/exhaustive-deps

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
              <DropdownMenuTrigger render={<button type="button" title={local && v === "friends" ? "Friends · not shared yet" : VISIBILITY[v].label} aria-label={`“${titleOf(doc)}” is for ${VISIBILITY[v].label}${local && v === "friends" ? ", not shared yet" : ""}. Change`} className={cn(pill, "hover:bg-foreground/12")} />}>
                <Icon icon={VISIBILITY[v].icon} size="xs" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                {(["private", "friends", "public"] as Visibility[]).map(o => (
                  <DropdownMenuItem key={o} onClick={() => { setOpenId(null); change(doc, o) }} className="flex items-center gap-2">
                    <Icon icon={VISIBILITY[o].icon} size="sm" /><span className="flex-1">{!local ? VISIBILITY[o].label : o === "public" ? (v === "public" ? "Everyone · Update…" : "Everyone · Publish…") : v === "public" ? `${VISIBILITY[o].label} · Take down…` : VISIBILITY[o].label}</span>
                    <Icon icon={CheckIcon} size="sm" className={cn(o !== v && "invisible")} />
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <span className={pill} title="Only you: Agents is yours alone" aria-label="Only you"><Icon icon={LockIcon} size="xs" /></span>
          )}
        </div>
      )
    })}

    {publishing ? <PublishDialog doc={publishing} onClose={() => setPublishing(null)} /> : null}
    {takingDown ? <TakeDownDialog doc={takingDown.doc} to={takingDown.to} onClose={() => setTakingDown(null)} /> : null}

    <Dialog open={!!asking} onOpenChange={o => { if (!o) { asking?.answer?.(false); setAsking(null) } }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Show “{asking && titleOf(asking.doc)}” to {asking && VISIBILITY[asking.to].label.toLowerCase()}?</DialogTitle>
          <DialogDescription>{asking?.warning}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => { asking?.answer?.(false); setAsking(null) }}>Cancel</Button>
          <Button onClick={() => {
            if (!asking) return
            const { doc, to, answer } = asking
            setAsking(null)
            // An agent's call runs the move itself once approved; the button runs it here.
            if (answer) return answer(true)
            move(doc, to).catch(err => notify({ message: (err as Error).message }))
          }}>Change visibility</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>
}
