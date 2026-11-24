// What agents on this computer asked to change about who can see a block (vault_request_visibility),
// waiting for the person: shown one at a time, to approve or decline. Only on the home on this
// computer, through `ohmmmm serve` (docs/serve.md); the sample has no such agents.
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { notify } from "@/components/ui/notice"
import type { LocalSource, VisibilityRequest } from "@/data/local-source"
import { getSource } from "@/data/workspace-data"
import { useWorkspace } from "./store"
import { moveNote, VISIBILITY } from "./VisibilityMarks"

const agentName = (by: string) => by.replace(/^agent:/, "")

export function AgentRequests() {
  const { rev } = useWorkspace()
  const source = getSource()
  const local = "decide" in source ? (source as LocalSource) : null
  const [waiting, setWaiting] = useState<VisibilityRequest[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!local) return setWaiting([])
    let live = true
    const look = () => { local.requests().then(found => { if (live) setWaiting(found) }).catch(() => {}) }
    look()
    const every = setInterval(look, 20_000)
    addEventListener("focus", look)
    return () => { live = false; clearInterval(every); removeEventListener("focus", look) }
  }, [local])

  const request = waiting[0]
  if (!local || !request) return null
  const head = local.listBlocks().find(each => each.path === request.path)
  const title = head?.title || request.path
  const doc = { visibility: request.from } as Parameters<typeof moveNote>[0]
  const decide = (approve: boolean) => {
    setBusy(true)
    local.decide(request.id, approve)
      .then(done => notify({
        message: done.status === "approved" ? `“${title}” is now for ${VISIBILITY[request.to].label.toLowerCase()}` : done.note ? `Declined: ${done.note}` : `Declined ${agentName(request.by)}'s request`,
        tone: "info",
      }))
      .catch(problem => notify({ message: problem instanceof Error ? problem.message : "The request could not be answered" }))
      .finally(() => { setBusy(false); setWaiting(rest => rest.filter(each => each.id !== request.id)) })
  }

  return (
    <Dialog open onOpenChange={open => { if (!open && !busy) setWaiting(rest => rest.filter(each => each.id !== request.id)) }}>
      <DialogContent className="sm:max-w-sm" data-rev={rev}>
        <DialogHeader>
          <DialogTitle>
            {agentName(request.by)} asks: {request.to === "private" ? `make “${title}” only yours?` : `show “${title}” to ${VISIBILITY[request.to].label.toLowerCase()}?`}
          </DialogTitle>
          <DialogDescription>
            {request.why ? <>“{request.why}” </> : null}
            {moveNote(doc, request.to, true)}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={() => decide(false)}>Decline</Button>
          <Button disabled={busy} onClick={() => decide(true)}>Approve</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
