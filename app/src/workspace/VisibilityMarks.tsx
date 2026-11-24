// The visibility pills show each block's layer. Widening access asks for approval, and an agent's move
// (the visibility.move tool) always does, wider or narrower. On the home on this computer a move rewrites
// the block's file (docs/serve.md); Everyone opens Publish (PublishDialog), and taking a public block back
// first takes its post down. Publishing is the person's: no tool does it. The tree's rows are ohm-ui's,
// so the pills sit over them, measured from the rows.
import { useEffect, useLayoutEffect, useState } from "react"
import type { LucideIcon } from "lucide-react"
import { CheckIcon, GlobeIcon, LockIcon, UsersIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Icon } from "@/components/ui/icon"
import { notify } from "@/components/ui/notice"
import { blockVersion, getSource, isBlock, byId, docIdOf, titleOf, type Doc, type Visibility } from "@/data/workspace-data"
import { visibilityMove } from "@/data/source"
import { cn } from "@/lib/cn"
import { registerStepTool } from "@/webmcp"
import { PublishDialog, TakeDownDialog } from "./PublishDialog"
import { setVisibility, useWorkspace } from "./store"
import { withAgent } from "./tools"

export const VISIBILITY: Record<Visibility, { label: string; icon: LucideIcon }> = {
  private: { label: "Only you", icon: LockIcon },
  friends: { label: "Friends", icon: UsersIcon },
  public: { label: "Everyone", icon: GlobeIcon },
}
const openness: Record<Visibility, number> = { private: 0, friends: 1, public: 2 }
type Mark = { id: string; top: number; height: number }
/** A move waiting for the person: theirs, or an agent's, which carries its reason and the tool's answer. */
type Asking = { doc: Doc; to: Visibility; agent?: { why?: string; answer: (approved: boolean) => void } }

export const PUBLISH = "Showing a block to everyone, or taking a public one back, goes through Publish, which only the person does: they choose Everyone on the block and approve its plan."
/** Whether the workspace is the home on this computer, whose moves rewrite its files. */
const onThisComputer = () => "home" in getSource()

/** What a move would do, as the visibility.preview tool answers it. */
export function previewMove(id: string, to: Visibility) {
  const doc = byId(id)
  const held = blockVersion(id)
  if (!isBlock(doc) || !held) throw new DOMException("There is no such block.", "DataError")
  if (to === "public" || doc.visibility === "public") throw new DOMException(PUBLISH, "DataError")
  if (doc.visibility === to) return { id, from: doc.visibility, to, unchanged: true }
  const move = visibilityMove(held.ref, to)
  return {
    id, from: doc.visibility, to, warning: move.warning,
    ...(onThisComputer() ? { where: "It is rewritten in its file on this computer, and shared only once the home syncs with the vault service." } : {}),
  }
}

export function VisibilityMarks({ container }: { container: HTMLElement | null }) {
  const { rev, showVisibility, agentsAllowed, offered } = useWorkspace()
  const [marks, setMarks] = useState<Mark[]>([])
  const [asking, setAsking] = useState<Asking | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [publishing, setPublishing] = useState<Doc | null>(null)
  const [takingDown, setTakingDown] = useState<{ doc: Doc; to: "private" | "friends" } | null>(null)
  const local = onThisComputer()

  // The control's tools, while it is on screen (app/AGENTS.md rule 4). A move by an agent always asks.
  useEffect(() => {
    if (!showVisibility || !agentsAllowed) return
    const ac = new AbortController()
    const target = { id: { type: "string", maxLength: 200 }, to: { enum: ["private", "friends", "public"] } }
    if (offered["visibility.preview"]) {
      registerStepTool<{ id: string; to: Visibility }, ReturnType<typeof previewMove>>({
        name: "visibility.preview", title: "Who can see it",
        description: "Says what moving a block to other people would do, and what it warns, without moving it. Returns the move.",
        inputSchema: { type: "object", properties: target, required: ["id", "to"], additionalProperties: false },
        annotations: { readOnlyHint: true },
        run: async ({ id, to }) => previewMove(id, to),
      }, ac.signal).catch(console.error)
    }
    if (offered["visibility.move"]) {
      registerStepTool<{ id: string; to: Visibility; why?: string }, { id: string; visibility: Visibility }>({
        name: "visibility.move", title: "Change visibility",
        description: "Asks the person to move a block between only them and friends. Nothing moves until they approve it in the page; public goes through Publish. Say why in one line. Returns the block's id and its visibility.",
        inputSchema: { type: "object", properties: { ...target, why: { type: "string", maxLength: 500 } }, required: ["id", "to"], additionalProperties: false },
        annotations: { consequentialHint: true },
        approve: ({ id, to, why }, signal) => new Promise<boolean>((resolve, reject) => {
          const preview = previewMove(id, to)
          if ("unchanged" in preview) return resolve(true)
          setAsking({ doc: byId(id)!, to, agent: { why, answer: resolve } })
          signal.addEventListener("abort", () => { setAsking(null); reject(new DOMException("Cancelled", "AbortError")) })
        }),
        run: withAgent("Changing who can see a block", async ({ id, to, why }) => {
          // Journaled with the agent that asked and its reason, approved by the person above.
          if (byId(id)?.visibility !== to) setVisibility(id, to, why)
          return { id, visibility: byId(id)!.visibility }
        }),
      }, ac.signal).catch(console.error)
    }
    return () => ac.abort()
  }, [showVisibility, agentsAllowed, offered])

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
    // Everyone again, on a public block: its post is updated to the block as it is now.
    if (local && to === "public") return setPublishing(doc)
    if (to === doc.visibility) return
    if (local && doc.visibility === "public") return setTakingDown({ doc, to: to === "friends" ? "friends" : "private" })
    if (openness[to] > openness[doc.visibility]) return setAsking({ doc, to })
    setVisibility(doc.id, to)
    notify({ message: `“${titleOf(doc)}” is now for ${VISIBILITY[to].label.toLowerCase()}`, tone: "info" })
  }
  const answer = (approved: boolean) => {
    if (!asking) return
    if (asking.agent) asking.agent.answer(approved)
    else if (approved) {
      setVisibility(asking.doc.id, asking.to)
      notify({ message: `“${titleOf(asking.doc)}” is now for ${VISIBILITY[asking.to].label.toLowerCase()}${local && asking.to === "friends" ? ", once your home syncs" : ""}`, tone: "info" })
    }
    setAsking(null)
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
            <span className={pill} title="Only you: your cortex is yours alone" aria-label="Only you"><Icon icon={LockIcon} size="xs" /></span>
          )}
        </div>
      )
    })}

    {publishing ? <PublishDialog doc={publishing} onClose={() => setPublishing(null)} /> : null}
    {takingDown ? <TakeDownDialog doc={takingDown.doc} to={takingDown.to} onClose={() => setTakingDown(null)} /> : null}

    <Dialog open={!!asking} onOpenChange={o => !o && answer(false)}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {asking?.agent ? "An agent asks: " : ""}
            {asking && (asking.to === "private" ? `Make “${titleOf(asking.doc)}” only yours?` : `Show “${titleOf(asking.doc)}” to ${VISIBILITY[asking.to].label.toLowerCase()}?`)}
          </DialogTitle>
          <DialogDescription>
            {asking?.agent?.why ? <>“{asking.agent.why}” </> : null}
            {asking && moveNote(asking.doc, asking.to, local)}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => answer(false)}>{asking?.agent ? "Decline" : "Cancel"}</Button>
          <Button onClick={() => answer(true)}>{asking?.agent ? "Approve" : "Change visibility"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>
}

/** What the person reads before approving a move, here: the sample, or their home on this computer. */
export function moveNote(doc: Doc, to: Visibility, local: boolean) {
  if (!local) return "This changes the block’s visibility in the sample home. Publishing requires a separate preview and approval."
  if (to === "friends") return "Its file on this computer is marked for friends. It is shared only once your home syncs with the vault service; then the service and the friends you choose can read it."
  return `Its file on this computer is marked only yours.${doc.visibility === "friends" ? " Anything already shared stays where it was copied." : ""}`
}
