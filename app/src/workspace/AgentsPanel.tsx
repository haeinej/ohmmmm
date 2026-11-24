// Agents: the coding agents connected to ohm's tools, from the rack. Each agent, what it did lately,
// and a card for every action it waits on: the person approves or declines it here, and nowhere
// else. A yes in the agent's own chat approves nothing (vault/service/src/agents.mjs). Pause,
// resume and disconnect are here too; talking to the agent stays in its own chat.
//
// An agent in the browser reaches the same handlers through agents.answer, which stops at the same
// dialog, so the person still decides.
import { useEffect, useState } from "react"
import { BotIcon, ChevronDownIcon, ChevronRightIcon, DownloadIcon, EyeOffIcon, GlobeIcon, MailIcon, PauseIcon, PencilIcon, PlayIcon, Trash2Icon, UnplugIcon, UserMinusIcon, UserPlusIcon } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { ApprovalCard } from "@/components/approval-card"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Icon } from "@/components/ui/icon"
import { notify } from "@/components/ui/notice"
import type { AgentAccess, AgentApproval, AgentInfo } from "@/data/source"
import { cn } from "@/lib/cn"
import { registerStepTool } from "@/webmcp"
import { ago } from "./notifications"
import { answerAgent, loadAgents, report, setAgentState, useWorkspace, type Agents } from "./store"
import { panelTitle, SidePanelFrame } from "./Surface"

const nameOf = (agent: string) => agent.replace(/^agent:/, "")
const STATE: Record<AgentAccess, string> = { active: "Connected", paused: "Paused", disconnected: "Disconnected" }
const text = (value: unknown) => (typeof value === "string" ? value : value === undefined || value === null ? "" : JSON.stringify(value))
const list = (value: unknown) => (Array.isArray(value) ? value.map(text).join(", ") : text(value))

/** What one action asks for, in the person's words: a title and the lines that matter. */
export function describe(approval: AgentApproval): { title: string; lines: [string, string][]; body?: string; warning?: string } {
  const shown = approval.shown
  const warning = typeof shown.warning === "string" ? shown.warning : undefined
  switch (approval.tool) {
    case "vault_mail_ask":
      return { title: "Send an email", lines: [["To", list(shown.to)], ...(shown.cc ? [["Cc", list(shown.cc)] as [string, string]] : []), ["Subject", text(shown.subject)]], body: text(shown.body), warning }
    case "vault_friends_ask":
      return { title: "Ask someone to be your friend", lines: [["Email", text(shown.email)], ...(shown.alreadyAsked ? [["Before", `asked, ${text(shown.alreadyAsked)}`] as [string, string]] : [])], body: shown.message ? text(shown.message) : undefined, warning }
    case "vault_save":
      return { title: "Change a post", lines: [["Post", text(shown.post)], ["Seen by", text(shown.audience)], ["Changes", list(shown.changes)]], warning }
    case "vault_set_visibility":
      return { title: "Hide a block from friends", lines: [["Block", text(shown.block)], ["From", text(shown.from)], ["To", text(shown.to)]], body: text(shown.outcome), warning }
    case "vault_publish":
      return { title: "Publish", lines: [["Changes", typeof shown.changes === "number" ? `${shown.changes} ${shown.changes === 1 ? "post" : "posts"}` : text(shown.changes ?? "")]], body: "Writes to your own repository. Published records are public at once.", warning }
    case "vault_mirror":
      return { title: "Bring in what you published", lines: [["Found", text(shown.found ?? shown.posts ?? "")]], warning }
    case "vault_delete":
      return { title: "Remove a post for good", lines: [["Post", text(shown.post ?? shown.key)]], warning }
    case "vault_friends_save":
      return { title: "Change a block friends read", lines: [["Path", text(shown.path)]], warning }
    case "vault_friends_delete":
      return { title: "Remove a block friends read", lines: [["Block", text(shown.id)]], warning }
    case "vault_friends_remove":
      return { title: "Stop sharing with someone", lines: [["Who", text(shown.did)]], warning }
    default:
      return { title: approval.tool, lines: Object.entries(shown).filter(([key]) => key !== "warning").map(([key, value]) => [key, text(value)]), warning }
  }
}

export function AgentsPanel() {
  const { rev } = useWorkspace()
  const [data, setData] = useState<Agents | null>(null)
  const [disconnecting, setDisconnecting] = useState<AgentInfo | null>(null)
  // One card is open at a time: it shows the whole action and its Approve.
  const [openId, setOpenId] = useState<string | null>(null)
  // An answered card shows its receipt for a moment before the list reads again.
  const [answered, setAnswered] = useState<Record<string, "done" | "denied">>({})
  const [agentAnswer, setAgentAnswer] = useState<{ approval: AgentApproval; approve: boolean; resolve: (ok: boolean) => void } | null>(null)
  // A home without the vault service has no agents: the panel is empty, not an error every few seconds.
  const reload = () => {
    void report(loadAgents().then(setData).catch(problem => {
      if (["NotSupportedError", "InvalidStateError"].includes((problem as DOMException)?.name)) setData({ agents: [], approvals: [] })
      else throw problem
    }))
  }
  useEffect(reload, [rev]) // eslint-disable-line react-hooks/exhaustive-deps
  // An agent waits while the person looks, so the panel reads again every few seconds.
  useEffect(() => { const every = setInterval(reload, 4000); return () => clearInterval(every) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const answer = async (approval: AgentApproval, approve: boolean) => {
    try {
      await answerAgent(approval.id, approve)
      setAnswered(held => ({ ...held, [approval.id]: approve ? "done" : "denied" }))
      notify({ message: approve ? `Approved: ${describe(approval).title}. ${nameOf(approval.agent)} can go ahead.` : `Declined: ${describe(approval).title}.`, tone: "info" })
      setTimeout(reload, 1500)
    } catch (problem) {
      notify({ message: (problem as Error).message, tone: "error" })
      reload()
    }
  }
  const change = async (agent: AgentInfo, state: AgentAccess) => {
    try { await setAgentState(agent.agent, state) } catch (problem) { notify({ message: (problem as Error).message, tone: "error" }) }
    reload()
  }

  // The browser's agent's way in: the same handler, behind the same dialog.
  useEffect(() => {
    const steps = new AbortController()
    void registerStepTool<{ id: string; approve: boolean }, { id: string; state: string }>({
      name: "agents.answer", title: "Approve",
      description: "Approves or declines one action a coding agent waits on, after the person confirms it in the page. Returns the action's new state.",
      inputSchema: { type: "object", properties: { id: { type: "string" }, approve: { type: "boolean" } }, required: ["id", "approve"] },
      annotations: { consequentialHint: true },
      approve: ({ id, approve }, signal) => new Promise<boolean>((resolve, reject) => {
        const approval = data?.approvals.find(each => each.id === id)
        if (!approval) { reject(new DOMException("That action is not waiting", "DataError")); return }
        signal.addEventListener("abort", () => { setAgentAnswer(null); reject(new DOMException("Cancelled", "AbortError")) })
        setAgentAnswer({ approval, approve, resolve })
      }),
      run: async ({ id, approve }) => { const done = await answerAgent(id, approve); reload(); return done },
    }, steps.signal)
    return () => steps.abort()
  }, [data]) // eslint-disable-line react-hooks/exhaustive-deps

  const agents = data?.agents ?? []
  const loose = (data?.approvals ?? []).filter(approval => !agents.some(each => each.agent === approval.agent))

  return (
    <SidePanelFrame label="Agents" heading={<h2 className={cn(panelTitle, "px-1.5")}>Agents</h2>}>
      {!data ? null : !agents.length && !loose.length ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No agents yet</EmptyTitle>
            <EmptyDescription>When a coding agent uses ohm’s tools, it shows here. What it wants to do waits here for you.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="flex flex-col gap-4">
          {agents.map(agent => (
            <section key={agent.agent} aria-label={nameOf(agent.agent)} className="flex flex-col gap-2">
              <div className="flex items-center gap-2 px-1.5">
                <Icon icon={BotIcon} size="sm" />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-body">{nameOf(agent.agent)}</span>
                  <span className="truncate text-small text-muted-foreground">
                    {[STATE[agent.state], agent.lastTool && `${agent.lastTool} ${ago(Date.parse(agent.lastSeen))}`].filter(Boolean).join(" · ")}
                  </span>
                </div>
                {agent.state === "active" && <Button size="icon-sm" variant="ghost" aria-label={`Pause ${nameOf(agent.agent)}`} title="Pause" onClick={() => void change(agent, "paused")}><Icon icon={PauseIcon} size="sm" /></Button>}
                {agent.state !== "active" && <Button size="sm" variant="ghost" onClick={() => void change(agent, "active")}><Icon icon={PlayIcon} size="sm" /> {agent.state === "paused" ? "Resume" : "Allow again"}</Button>}
                {agent.state !== "disconnected" && <Button size="icon-sm" variant="ghost" aria-label={`Disconnect ${nameOf(agent.agent)}`} title="Disconnect" onClick={() => setDisconnecting(agent)}><Icon icon={UnplugIcon} size="sm" /></Button>}
              </div>
              {data.approvals.filter(approval => approval.agent === agent.agent).map(approval => (
                <ActionCard key={approval.id} approval={approval} answered={answered[approval.id]} open={openId === approval.id} onToggle={() => setOpenId(openId === approval.id ? null : approval.id)} onAnswer={approve => void answer(approval, approve)} />
              ))}
              {!!agent.recent.length && (
                <details className="px-1.5 text-small text-muted-foreground">
                  <summary className="cursor-pointer">Recent</summary>
                  <ul className="mt-1 flex flex-col gap-0.5">
                    {agent.recent.map((call, index) => <li key={index} className="flex justify-between gap-2"><span className="truncate">{call.tool}</span><span>{ago(Date.parse(call.at))}</span></li>)}
                  </ul>
                </details>
              )}
            </section>
          ))}
          {loose.map(approval => <ActionCard key={approval.id} approval={approval} answered={answered[approval.id]} open={openId === approval.id} onToggle={() => setOpenId(openId === approval.id ? null : approval.id)} onAnswer={approve => void answer(approval, approve)} />)}
        </div>
      )}

      <Dialog open={!!disconnecting} onOpenChange={o => !o && setDisconnecting(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Disconnect {disconnecting && nameOf(disconnecting.agent)}?</DialogTitle>
            <DialogDescription>ohm’s tools refuse it from now on, and what it waits for is declined. You can allow it again here.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDisconnecting(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => { if (disconnecting) void change(disconnecting, "disconnected"); setDisconnecting(null) }}>Disconnect</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!agentAnswer} onOpenChange={o => { if (!o) { agentAnswer?.resolve(false); setAgentAnswer(null) } }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{agentAnswer?.approve ? "Approve" : "Decline"}: {agentAnswer && describe(agentAnswer.approval).title}?</DialogTitle>
            <DialogDescription>An agent in this page answers for you. {agentAnswer && nameOf(agentAnswer.approval.agent)} goes ahead only if you approve.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { agentAnswer?.resolve(false); setAgentAnswer(null) }}>Cancel</Button>
            <Button onClick={() => { agentAnswer?.resolve(true); setAgentAnswer(null) }}>{agentAnswer?.approve ? "Approve" : "Decline"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SidePanelFrame>
  )
}

/** One line saying what the action is about, for its closed card. */
export const summaryOf = (approval: AgentApproval) => {
  const { lines, body } = describe(approval)
  return lines.map(([, value]) => value).filter(Boolean).slice(0, 2).join(" · ") || body?.split("\n")[0] || ""
}

const ICONS: Record<string, LucideIcon> = {
  vault_mail_ask: MailIcon, vault_friends_ask: UserPlusIcon, vault_save: PencilIcon, vault_set_visibility: EyeOffIcon,
  vault_publish: GlobeIcon, vault_mirror: DownloadIcon, vault_delete: Trash2Icon, vault_friends_save: PencilIcon,
  vault_friends_delete: Trash2Icon, vault_friends_remove: UserMinusIcon,
}
/** Actions that remove something for good are shown in red. */
const DESTRUCTIVE = new Set(["vault_delete", "vault_friends_delete", "vault_friends_remove"])

/**
 * One action an agent waits on. Closed, a row saying what and when; opened, ohm-ui's ApprovalCard
 * with everything the action would do, Approve and Decline, and then its receipt.
 */
function ActionCard({ approval, answered, open, onToggle, onAnswer }: {
  approval: AgentApproval; answered?: "done" | "denied"; open: boolean; onToggle: () => void; onAnswer: (approve: boolean) => void
}) {
  const { title, lines, body, warning } = describe(approval)
  const summary = summaryOf(approval)
  const when = ago(Date.parse(approval.asked))
  const Glyph = ICONS[approval.tool] ?? BotIcon
  if (open || answered) {
    return (
      <div className="flex flex-col gap-1">
        {!answered && (
          <button type="button" onClick={onToggle} aria-expanded className="flex items-center gap-1 self-start rounded-md px-1.5 text-small text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40">
            <Icon icon={ChevronDownIcon} size="sm" /> Close
          </button>
        )}
        <ApprovalCard
          className="max-w-none"
          state={answered ?? "request"}
          title={title}
          subtitle={`${nameOf(approval.agent)} · ${when}`}
          description={warning}
          details={[...lines.filter(([, value]) => value).map(([label, value]) => ({ label, value })), ...(body ? [{ label: approval.tool === "vault_mail_ask" ? "Message" : "Note", value: body }] : [])]}
          variant={DESTRUCTIVE.has(approval.tool) ? "destructive" : "default"}
          icon={<Icon icon={Glyph} size="sm" />}
          allowOnceLabel="Approve"
          denyLabel="Decline"
          statusLabel={answered === "done" ? `Approved. ${nameOf(approval.agent)} can go ahead.` : answered === "denied" ? "Declined. Nothing was done." : undefined}
          onAllowOnce={() => onAnswer(true)}
          onDeny={() => onAnswer(false)}
        />
      </div>
    )
  }
  return (
    <button type="button" onClick={onToggle} aria-expanded={false} aria-label={title}
      className="flex w-full items-center gap-2 rounded-2xl bg-muted/60 p-3 text-left outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40">
      <Icon icon={ChevronRightIcon} size="sm" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-body font-medium">{title}</span>
        {summary && <span className="truncate text-small text-muted-foreground">{summary}</span>}
      </span>
      <span className="shrink-0 text-small text-muted-foreground">{when}</span>
    </button>
  )
}
