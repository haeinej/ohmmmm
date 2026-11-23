// The inbox (flows/paths.md › Inbox): blocks agents proposed wait in the channel `inbox` until you
// keep one in a channel or decline it. Both are consequential: an agent's tool stops at the
// approval dialog, and the person's own click is the approval.
import { useEffect, useRef, useState } from "react"
import { BotIcon } from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Icon } from "@/components/ui/icon"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { notify } from "@/components/ui/notice"
import { agenda, channelRecords, inbox, titleOf, type Doc } from "@/data/workspace-data"
import { INBOX } from "@/data/source"
import { registerStepTool } from "@/webmcp"
import { panelTitle, SidePanelFrame } from "./Surface"
import { declineProposal, keepProposal, openInbox, report, useWorkspace } from "./store"
import { withAgent } from "./tools"

const shown = (path: string) => path.replaceAll("/", " › ")
/** A block's `by` is `me` or `agent:<name>`. */
const proposer = (doc: Doc) => doc.by === "me" ? "you" : doc.by?.replace(/^agent:/, "") || "an agent"
const keepable = () => channelRecords.map(channel => channel.path).filter(path => path !== INBOX && !path.startsWith(`${INBOX}/`))

export function InboxPanel() {
  const { view, rev } = useWorkspace()
  void rev
  const waiting = agenda?.waiting ?? 0
  return (
    <SidePanelFrame label="Inbox"
      heading={<>
        <h1 className={panelTitle}>Inbox</h1>
        <p className="text-small text-muted-foreground">
          {inbox.length ? `${inbox.length} proposed${waiting ? `, ${waiting} waiting over a week` : ""}` : "Nothing waiting"}
        </p>
      </>}>
      {inbox.length === 0 ? (
        <Empty className="flex-1">
          <EmptyHeader>
            <EmptyTitle>Nothing to review</EmptyTitle>
            <EmptyDescription>What your agents capture for you waits here until you keep or decline it.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {inbox.map(item => (
            <li key={item.id}>
              <button type="button" onClick={() => openInbox(item.id)} aria-current={(view.kind === "inbox" && view.id === item.id) || undefined}
                className="flex w-full items-start gap-3 rounded-lg px-2.5 py-2.5 text-left transition-colors duration-(--ohm-duration-state) hover:bg-muted aria-[current=true]:bg-muted">
                <Avatar className="mt-0.5 size-8"><AvatarFallback className="bg-muted text-small text-muted-foreground"><Icon icon={BotIcon} size="sm" /></AvatarFallback></Avatar>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-body font-semibold">{titleOf(item)}</span>
                    <span className="ms-auto flex-none text-small text-muted-foreground">{item.updated.slice(5).replace("-", "/")}</span>
                  </span>
                  <span className="text-small text-muted-foreground">Proposed by {proposer(item)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </SidePanelFrame>
  )
}

type Asking = { action: "keep" | "decline"; channel?: string; resolve: (ok: boolean) => void }

/** One proposal, and its one step: keep it in a channel (the forest action) or decline it. */
export function ProposalView({ id }: { id: string }) {
  const { rev } = useWorkspace()
  void rev
  const item = inbox.find(each => each.id === id)
  const channels = keepable()
  const [channel, setChannel] = useState(() => channels.find(path => path !== "other") ?? "other")
  const [busy, setBusy] = useState(false)
  const [asking, setAsking] = useState<Asking | null>(null)
  const askingRef = useRef<Asking | null>(null)
  askingRef.current = asking

  const keep = async (into: string) => {
    setBusy(true)
    try {
      await keepProposal(id, into)
      notify({ message: `Kept in ${shown(into)}`, tone: "info" })
    } finally { setBusy(false) }
  }
  const decline = async () => {
    setBusy(true)
    try {
      await declineProposal(id)
      notify({ message: "Declined", tone: "info" })
    } finally { setBusy(false) }
  }

  // The step's tools, for as long as this proposal is on screen (AGENTS.md rules 4 and 11).
  useEffect(() => {
    if (!item) return
    const ac = new AbortController()
    const approve = (action: Asking["action"], into?: string) => (_input: unknown, signal: AbortSignal) => new Promise<boolean>((resolve, reject) => {
      // Each call clears only its own dialog: a later abort of a call already answered does nothing.
      const mine: Asking = { action, channel: into, resolve: ok => finish(() => resolve(ok)) }
      const finish = (then: () => void) => {
        signal.removeEventListener("abort", aborted)
        setAsking(current => current === mine ? null : current)
        then()
      }
      const aborted = () => finish(() => reject(new DOMException("Cancelled", "AbortError")))
      if (signal.aborted) return aborted()
      signal.addEventListener("abort", aborted, { once: true })
      setAsking(mine)
    })
    registerStepTool({
      name: "inbox.keep",
      title: "Keep",
      description: "Keeps the proposal on screen: files it in the given channel and clears its proposed mark, after the person approves. Returns its id, the channel and the next tool.",
      annotations: { consequentialHint: true, untrustedContentHint: true },
      inputSchema: {
        type: "object",
        properties: { channel: { type: "string", minLength: 1, maxLength: 120 } },
        required: ["channel"],
        additionalProperties: false,
      },
      outputSchema: { type: "object", properties: { id: { type: "string" }, channel: { type: "string" }, next: { const: "workspace.open" } } },
      approve: (input: { channel: string }, signal) => approve("keep", input.channel)(input, signal),
      run: withAgent("Keeping a proposal", async ({ channel: into }: { channel: string }) => keepProposal(id, into)),
    }, ac.signal).catch(console.error)
    registerStepTool({
      name: "inbox.decline",
      title: "Decline",
      description: "Declines the proposal on screen and removes it from the inbox, after the person approves. Returns its id.",
      annotations: { consequentialHint: true },
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      outputSchema: { type: "object", properties: { id: { type: "string" }, declined: { const: true } } },
      approve: approve("decline"),
      run: withAgent("Declining a proposal", async () => declineProposal(id)),
    }, ac.signal).catch(console.error)
    return () => {
      ac.abort()
      askingRef.current?.resolve(false)
    }
  }, [id, !!item]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!item) {
    return (
      <Empty className="flex-1">
        <EmptyHeader>
          <EmptyTitle>No longer in the inbox</EmptyTitle>
          <EmptyDescription>It was kept or declined.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }
  return (
    <article className="mx-auto flex w-full max-w-xl flex-col gap-5 px-6 py-16">
      <p className="text-small text-muted-foreground">Proposed by {proposer(item)} · {item.updated}</p>
      <ProposalBody doc={item} />
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-small text-muted-foreground">
          Keep in
          <NativeSelect value={channel} onChange={e => setChannel(e.target.value)} aria-label="Channel to keep it in">
            {channels.map(path => <NativeSelectOption key={path} value={path}>{shown(path)}</NativeSelectOption>)}
          </NativeSelect>
        </label>
        <Button disabled={busy || !channel} onClick={() => void report(keep(channel))}>Keep</Button>
        <Button variant="ghost" disabled={busy} onClick={() => void report(decline())}>Decline</Button>
      </div>

      <Dialog open={!!asking} onOpenChange={open => { if (!open) asking?.resolve(false) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{asking?.action === "keep" ? `Keep “${titleOf(item)}” in ${shown(asking.channel ?? "")}?` : `Decline “${titleOf(item)}”?`}</DialogTitle>
            <DialogDescription>
              {asking?.action === "keep"
                ? "An agent asks to keep this proposal. It joins the channel with the visibility it has now."
                : "An agent asks to decline this proposal. It is removed from your inbox."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => asking?.resolve(false)}>Not now</Button>
            <Button variant={asking?.action === "decline" ? "destructive" : "default"} onClick={() => asking?.resolve(true)}>
              {asking?.action === "keep" ? "Keep" : "Decline"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </article>
  )
}

/** The proposal as plain text: it was written by an agent, so it is shown, not rendered. */
function ProposalBody({ doc }: { doc: Doc }) {
  return <div className="whitespace-pre-wrap text-body">{doc.body.trim() || titleOf(doc)}</div>
}
