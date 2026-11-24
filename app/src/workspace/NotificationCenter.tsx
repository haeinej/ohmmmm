// The bell above your picture in the rack, after agentic-twitter's notification center: what an agent
// is doing now, then what agents did and the workspace's notices from the last week, in two tabs.
import { useEffect, useState } from "react"
import { BellIcon, BotIcon, InfoIcon, Trash2Icon, TriangleAlertIcon, XIcon } from "lucide-react"
import { AgentStatus } from "@/components/agent-status"
import { Button } from "@/components/ui/button"
import { Icon } from "@/components/ui/icon"
import { onNotice } from "@/components/ui/notice"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/cn"
import { ago, clearAll, markRead, record, remove, useNotifications, type NotificationKind } from "./notifications"
import { approveFriend, approveMoveRequest, declineFriend, declineMoveRequest, loadFriendRequests, loadMoveRequests, open as openDoc, previewMove, report, useWorkspace, waitingFriends, waitingRequests } from "./store"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { notify } from "@/components/ui/notice"
import { byId, channelRecords, titleOf } from "@/data/workspace-data"
import type { FriendRequest, MoveRequest } from "@/data/source"

const LAYER = { private: "only you", friends: "friends", public: "everyone" } as const

const TABS: { kind: NotificationKind; label: string }[] = [{ kind: "agent", label: "Agent" }, { kind: "system", label: "System" }]

const rackButton = cn(
  "relative inline-flex size-10 items-center justify-center rounded-md text-muted-foreground transition-colors outline-none",
  "hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40",
  "aria-expanded:bg-muted aria-expanded:text-foreground",
)

export function NotificationCenter() {
  const items = useNotifications()
  const { agent } = useWorkspace()
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<NotificationKind>("agent")
  const [answering, setAnswering] = useState<MoveRequest | null>(null)
  const waiting = waitingRequests()
  const asking = waitingFriends()
  const [letIn, setLetIn] = useState<{ request: FriendRequest; every: boolean; channels: string[] } | null>(null)
  // Requests are read again whenever the panel opens.
  useEffect(() => { if (open) { report(loadMoveRequests()); report(loadFriendRequests()) } }, [open])
  const topChannels = [...new Set(channelRecords.map(channel => channel.path.split("/")[0]))].sort()
  const nameOf = (request: MoveRequest) => { const doc = byId(request.block); return doc ? titleOf(doc) : "a block locked on this device" }
  const warningOf = (request: MoveRequest) => { try { return previewMove(request.block, request.to).warning } catch (err) { return (err as Error).message } }

  // Everything the workspace raises as a notice is kept here too.
  useEffect(() => onNotice(n => record({ kind: "system", title: typeof n.message === "string" ? n.message : "Notice", tone: n.tone === "error" ? "error" : "info" })), [])
  // What you are looking at counts as read.
  useEffect(() => { if (open) markRead(tab) }, [open, tab, items])

  const unread = (k: NotificationKind) => items.filter(i => i.kind === k && !i.read).length
  const total = unread("agent") + unread("system") + waiting.length + asking.length
  const status = [agent?.state === "working" && `Agent: ${agent.label}`, unread("agent") && `${unread("agent")} from agents`, unread("system") && `${unread("system")} system`]
    .filter(Boolean).join(" · ") || "All caught up"
  const shown = items.filter(i => i.kind === tab)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<button type="button" aria-label={`Notifications: ${status}`} title={status} className={rackButton} />}>
        <Icon icon={BellIcon} />
        {(total > 0 || agent?.state === "working") && (
          <span aria-hidden className={cn("absolute top-2 right-2 size-2 rounded-full ring-2 ring-sidebar dark:ring-background",
            agent?.state === "working" ? "animate-pulse bg-(--ohm-green-light)" : "bg-primary dark:bg-foreground")} />
        )}
      </PopoverTrigger>
      <PopoverContent side="right" align="end" sideOffset={10} className="w-80 gap-0 p-0">
        <header className="flex items-center justify-between gap-2 px-2 pt-2 pb-1">
          <div role="tablist" aria-label="Notification kinds" className="flex gap-0.5">
            {TABS.map(t => (
              <Button key={t.kind} size="sm" variant="ghost" role="tab" aria-selected={tab === t.kind} onClick={() => setTab(t.kind)}
                className="rounded-full text-muted-foreground aria-selected:bg-muted aria-selected:text-foreground">
                {t.label}
                {unread(t.kind) > 0 && <span className="ms-1 rounded-full bg-primary px-1.5 text-small text-primary-foreground tabular-nums dark:bg-foreground dark:text-background">{unread(t.kind)}</span>}
              </Button>
            ))}
          </div>
          <Button size="icon-sm" variant="ghost" aria-label="Clear all notifications" title="Clear all" disabled={!items.length} onClick={clearAll}
            className="rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
            <Icon icon={Trash2Icon} size="sm" />
          </Button>
        </header>

        {tab === "agent" && agent && (
          <div role="status" className="mx-2 mb-1 flex items-center rounded-lg bg-muted px-2 py-2">
            <AgentStatus state={agent.state} label={agent.label} />
          </div>
        )}

        {tab === "agent" && asking.length > 0 && (
          <section aria-label="Asking to be friends" className="mx-1.5 mb-1 flex flex-col gap-px">
            {asking.map(request => (
              <div key={request.id} className="flex flex-col gap-1.5 rounded-lg bg-muted px-2.5 py-2">
                <span className="text-body">{request.name || request.did} asks to be your friend</span>
                <span className="truncate text-small text-muted-foreground">{[request.email, request.did].filter(Boolean).join(" · ")}</span>
                {request.message && <span className="text-small text-muted-foreground">{request.message}</span>}
                <div className="flex justify-end gap-1">
                  <Button size="sm" variant="ghost" onClick={() => report(declineFriend(request.id)).then(() => notify({ message: "Declined. They see nothing.", tone: "info" }))}>Decline</Button>
                  <Button size="sm" onClick={() => setLetIn({ request, every: true, channels: [] })}>Review</Button>
                </div>
              </div>
            ))}
          </section>
        )}

        {tab === "agent" && waiting.length > 0 && (
          <section aria-label="Waiting for you" className="mx-1.5 mb-1 flex flex-col gap-px">
            {waiting.map(request => (
              <div key={request.id} className="flex flex-col gap-1.5 rounded-lg bg-muted px-2.5 py-2">
                <span className="text-body">{request.askedBy.replace(/^agent:/, "")} asks to show “{nameOf(request)}” to {LAYER[request.to]}</span>
                {request.reason && <span className="text-small text-muted-foreground">{request.reason}</span>}
                <div className="flex justify-end gap-1">
                  <Button size="sm" variant="ghost" onClick={() => report(declineMoveRequest(request.id)).then(() => notify({ message: "Declined. Nothing moved.", tone: "info" }))}>Decline</Button>
                  <Button size="sm" onClick={() => setAnswering(request)}>Review</Button>
                </div>
              </div>
            ))}
          </section>
        )}

        <ul role="tabpanel" className="flex max-h-96 flex-col gap-px overflow-y-auto px-1.5 pb-1.5">
          {shown.map(i => (
            <li key={i.id} className="group/item relative">
              <button type="button" disabled={!i.ref} onClick={() => { if (i.ref) { openDoc(i.ref); setOpen(false) } }}
                className="ux-row flex w-full items-start gap-2.5 px-2.5 py-2 pe-9 text-left disabled:cursor-default">
                <span className={cn("mt-0.5 flex size-5 flex-none items-center justify-center rounded-full",
                  i.tone === "error" ? "text-destructive" : i.kind === "agent" ? "text-primary dark:text-foreground" : "text-muted-foreground")}>
                  <Icon icon={i.kind === "agent" ? BotIcon : i.tone === "error" ? TriangleAlertIcon : InfoIcon} size="sm" />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className={cn("text-body", !i.read && "font-semibold")}>{i.title}</span>
                  {i.detail && <span className="truncate text-small text-muted-foreground">{i.detail}</span>}
                </span>
                <time dateTime={new Date(i.at).toISOString()} className="flex-none text-small text-muted-foreground tabular-nums">{ago(i.at)}</time>
              </button>
              <Button size="icon-xs" variant="ghost" aria-label={`Remove “${i.title}”`} onClick={() => remove(i.id)}
                className="absolute top-2 right-2 rounded-full text-muted-foreground opacity-0 transition-opacity group-hover/item:opacity-100 focus-visible:opacity-100">
                <Icon icon={XIcon} size="xs" />
              </Button>
            </li>
          ))}
          {!shown.length && (
            <li className="px-2.5 py-6 text-center text-small text-muted-foreground">
              {tab === "agent" ? "Nothing from agents this week." : "No notices this week."}
            </li>
          )}
        </ul>
      </PopoverContent>
      <Dialog open={!!letIn} onOpenChange={o => !o && setLetIn(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Let {letIn && (letIn.request.name || letIn.request.did)} see your friends-only blocks?</DialogTitle>
            <DialogDescription>
              {letIn?.request.email} can read what you share with friends in the channels you choose, and so can their agents. It lasts until you remove them.
            </DialogDescription>
          </DialogHeader>
          {letIn && (
            <div className="flex flex-col gap-1.5">
              <label className="flex items-center gap-2 text-body">
                <Checkbox checked={letIn.every} onCheckedChange={every => setLetIn({ ...letIn, every: Boolean(every) })} /> Every channel
              </label>
              {!letIn.every && topChannels.map(path => (
                <label key={path} className="flex items-center gap-2 ps-6 text-body">
                  <Checkbox checked={letIn.channels.includes(path)}
                    onCheckedChange={on => setLetIn({ ...letIn, channels: on ? [...letIn.channels, path] : letIn.channels.filter(each => each !== path) })} />
                  {path}
                </label>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setLetIn(null)}>Not now</Button>
            <Button disabled={!!letIn && !letIn.every && !letIn.channels.length} onClick={() => {
              if (!letIn) return
              const { request, every, channels } = letIn
              setLetIn(null)
              report(approveFriend(request.id, every ? "*" : channels)).then(() => notify({ message: `${request.name || "They"} can now see ${every ? "every channel" : channels.join(", ")}.`, tone: "info" }))
            }}>Approve</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!answering} onOpenChange={o => !o && setAnswering(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Show “{answering && nameOf(answering)}” to {answering && LAYER[answering.to]}?</DialogTitle>
            <DialogDescription>{answering && warningOf(answering)}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAnswering(null)}>Not now</Button>
            <Button onClick={() => {
              if (!answering) return
              const request = answering
              setAnswering(null)
              report(approveMoveRequest(request.id)).then(result => {
                if (result.publish) window.open(result.publish, "_blank", "noopener")
                notify({ message: result.publish ? "Marked. Finish it on the Publish page." : "Moved.", tone: "info" })
              })
            }}>Approve</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Popover>
  )
}
