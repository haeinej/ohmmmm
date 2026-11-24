// Connections: the people around you, from the rack. A list or a graph of the friends you let in,
// the people who let you in (and what each shares with you), and who you asked. Make friends asks
// someone by email; whether that email is on ohm is never shown. Asking, and removing a friend, are
// the same handlers an agent reaches: connections.ask stops at a dialog, as the button's does.
import { useEffect, useMemo, useState } from "react"
import { NetworkIcon, ListIcon, UserPlusIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Icon } from "@/components/ui/icon"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { notify } from "@/components/ui/notice"
import type { BlockHead } from "@/data/source"
import { registerStepTool } from "@/webmcp"
import { cn } from "@/lib/cn"
import { askFriend, loadPeople, me, openShared, removeFriend, report, sharedBy, useWorkspace, type People } from "./store"
import { panelTitle, SidePanelFrame } from "./Surface"

type Person = { did: string; name: string; email?: string; theyShare: boolean; youShare: boolean; channels?: "*" | string[] }

/** Everyone in one list: a person is a friend you let in, someone who let you in, or both. */
function peopleOf(people: People): Person[] {
  const byDid = new Map<string, Person>()
  for (const friend of people.friends) byDid.set(friend.did, { did: friend.did, name: friend.name || friend.email || friend.did, email: friend.email, youShare: true, theyShare: false, channels: friend.channels })
  for (const sharer of people.sharers) {
    const held = byDid.get(sharer.did)
    byDid.set(sharer.did, { ...(held ?? { did: sharer.did, name: sharer.name || sharer.email || sharer.did, email: sharer.email, youShare: false }), theyShare: true })
  }
  return [...byDid.values()].sort((a, b) => a.name.localeCompare(b.name))
}
const how = (person: Person) => person.youShare && person.theyShare ? "Friends both ways" : person.youShare ? "Sees what you share" : "Shares with you"

export function ConnectionsPanel() {
  const { rev } = useWorkspace()
  const [people, setPeople] = useState<People | null>(null)
  const [mode, setMode] = useState<"list" | "graph">("list")
  const [chosen, setChosen] = useState<string | null>(null)
  const [making, setMaking] = useState(false)
  const [removing, setRemoving] = useState<Person | null>(null)
  const [agentAsk, setAgentAsk] = useState<{ email: string; resolve: (ok: boolean) => void } | null>(null)
  const reload = () => { void report(loadPeople().then(setPeople)) }
  useEffect(reload, [rev]) // eslint-disable-line react-hooks/exhaustive-deps
  const everyone = useMemo(() => (people ? peopleOf(people) : []), [people])
  const person = everyone.find(each => each.did === chosen) ?? null

  // An agent's ways in, while the panel is on screen: the same handlers, the same dialogs.
  useEffect(() => {
    const steps = new AbortController()
    void registerStepTool<{ email: string; message?: string }, Awaited<ReturnType<typeof askFriend>>>({
      name: "connections.ask", title: "Make friends",
      description: "Asks someone, by their email, to let the person see what they share with friends. The answer is the same whether or not the email is on ohm. Returns the email asked.",
      inputSchema: { type: "object", properties: { email: { type: "string" }, message: { type: "string", maxLength: 1000 } }, required: ["email"] },
      annotations: { consequentialHint: true },
      approve: ({ email }, signal) => new Promise<boolean>((resolve, reject) => {
        signal.addEventListener("abort", () => { setAgentAsk(null); reject(new DOMException("Cancelled", "AbortError")) })
        setAgentAsk({ email, resolve })
      }),
      run: async ({ email, message }) => { const asked = await askFriend(email, message); reload(); return asked },
    }, steps.signal)
    return () => steps.abort()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <SidePanelFrame label="Connections" scroll={mode === "list"}
      heading={<h2 className={cn(panelTitle, "px-1.5")}>Connections</h2>}
      actions={<>
        <Button size="icon-sm" variant="ghost" aria-label={mode === "list" ? "Show as a graph" : "Show as a list"} title={mode === "list" ? "Graph" : "List"}
          onClick={() => setMode(mode === "list" ? "graph" : "list")}>
          <Icon icon={mode === "list" ? NetworkIcon : ListIcon} size="sm" />
        </Button>
        <Button size="sm" onClick={() => setMaking(true)}><Icon icon={UserPlusIcon} size="sm" /> Make friends</Button>
      </>}>
      {!people ? null : mode === "graph" ? (
        <PeopleGraph people={everyone} chosen={chosen} onChoose={setChosen} />
      ) : (
        <div className="flex flex-col gap-4">
          <section aria-label="People" className="flex flex-col gap-px">
            {everyone.map(each => (
              <button key={each.did} type="button" onClick={() => setChosen(chosen === each.did ? null : each.did)} aria-expanded={chosen === each.did}
                className="ux-row flex w-full flex-col items-start gap-0.5 px-2.5 py-2 text-left">
                <span className="text-body">{each.name}</span>
                <span className="truncate text-small text-muted-foreground">{[how(each), each.email].filter(Boolean).join(" · ")}</span>
              </button>
            ))}
            {!everyone.length && <p className="px-2.5 py-6 text-center text-small text-muted-foreground">No friends yet. Make friends by their email.</p>}
          </section>
          {people.asks.some(ask => ask.state === "waiting") && (
            <section aria-label="Asked" className="flex flex-col gap-px">
              <h3 className="px-2.5 text-small text-muted-foreground">Asked</h3>
              {people.asks.filter(ask => ask.state === "waiting").map(ask => (
                <div key={ask.email} className="flex items-center justify-between px-2.5 py-1.5 text-body">
                  <span className="truncate">{ask.email}</span><span className="text-small text-muted-foreground">Waiting</span>
                </div>
              ))}
            </section>
          )}
        </div>
      )}
      {person && <PersonCard person={person} onRemove={() => setRemoving(person)} />}

      <MakeFriends open={making} onClose={() => setMaking(false)} onAsked={reload} />
      <Dialog open={!!agentAsk} onOpenChange={o => { if (!o) { agentAsk?.resolve(false); setAgentAsk(null) } }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Ask {agentAsk?.email} to be your friend?</DialogTitle>
            <DialogDescription>Your agent asks for you. They’ll see your name and email, and can let you in.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { agentAsk?.resolve(false); setAgentAsk(null) }}>Cancel</Button>
            <Button onClick={() => { agentAsk?.resolve(true); setAgentAsk(null) }}>Ask</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!removing} onOpenChange={o => !o && setRemoving(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Stop sharing with {removing?.name}?</DialogTitle>
            <DialogDescription>They, and their agents, stop reading your friends-only blocks from now on. What they already read can’t be taken back.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRemoving(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => {
              if (!removing) return
              const { did, name } = removing
              setRemoving(null)
              report(removeFriend(did)).then(() => { notify({ message: `${name} no longer sees what you share.`, tone: "info" }); reload() })
            }}>Stop sharing</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SidePanelFrame>
  )
}

/** One person: how you are connected, and what they share with you, each opened read-only. */
function PersonCard({ person, onRemove }: { person: Person; onRemove: () => void }) {
  const [shared, setShared] = useState<BlockHead[] | null>(null)
  useEffect(() => {
    setShared(null)
    if (person.theyShare) report(sharedBy(person.did).then(setShared))
  }, [person.did, person.theyShare])
  return (
    <section aria-label={person.name} className="mt-3 flex flex-col gap-1.5 rounded-lg bg-muted px-2.5 py-2">
      <span className="text-body font-semibold">{person.name}</span>
      <span className="text-small text-muted-foreground">{how(person)}{person.youShare && person.channels && ` · ${person.channels === "*" ? "every channel" : person.channels.join(", ")}`}</span>
      {person.theyShare && (
        <ul className="flex flex-col gap-px">
          {(shared ?? []).map(head => (
            <li key={head.id}>
              <button type="button" className="ux-row w-full px-2 py-1.5 text-left text-body" onClick={() => openShared(person.did, head.id)}>
                {head.title || head.path?.split("/").at(-1)?.replace(/\.md$/, "") || head.id}
              </button>
            </li>
          ))}
          {shared && !shared.length && <li className="px-2 py-1.5 text-small text-muted-foreground">Nothing shared with you yet.</li>}
        </ul>
      )}
      {person.youShare && (
        <div className="flex justify-end"><Button size="sm" variant="ghost" onClick={onRemove}>Stop sharing</Button></div>
      )}
    </section>
  )
}

/** You in the middle, everyone around you. A solid line is friends both ways; a dashed one, one way. */
function PeopleGraph({ people, chosen, onChoose }: { people: Person[]; chosen: string | null; onChoose: (did: string | null) => void }) {
  const size = 320, middle = size / 2, ring = size / 2 - 40
  const placed = people.map((person, index) => {
    const angle = (index / Math.max(people.length, 1)) * Math.PI * 2 - Math.PI / 2
    return { person, x: middle + ring * Math.cos(angle), y: middle + ring * Math.sin(angle) }
  })
  return (
    <svg role="img" aria-label="You and your connections" viewBox={`0 0 ${size} ${size}`} className="h-auto w-full">
      {placed.map(({ person, x, y }) => (
        <line key={`l-${person.did}`} x1={middle} y1={middle} x2={x} y2={y}
          className={cn("stroke-muted-foreground/40", person.did === chosen && "stroke-primary")} strokeWidth={1.5}
          strokeDasharray={person.youShare && person.theyShare ? undefined : "4 4"} />
      ))}
      <g>
        <circle cx={middle} cy={middle} r={18} className="fill-primary" />
        <text x={middle} y={middle + 34} textAnchor="middle" className="fill-foreground text-[11px]">{me.name}</text>
      </g>
      {placed.map(({ person, x, y }) => (
        <g key={person.did} role="button" tabIndex={0} aria-label={`${person.name}: ${how(person)}`} className="cursor-pointer outline-none"
          onClick={() => onChoose(chosen === person.did ? null : person.did)}
          onKeyDown={event => { if (event.key === "Enter") onChoose(chosen === person.did ? null : person.did) }}>
          <circle cx={x} cy={y} r={12} className={cn("fill-muted stroke-foreground/30", person.did === chosen && "stroke-primary")} strokeWidth={1.5} />
          <text x={x} y={y + 26} textAnchor="middle" className="fill-foreground text-[11px]">{person.name.slice(0, 18)}</text>
        </g>
      ))}
    </svg>
  )
}

function MakeFriends({ open, onClose, onAsked }: { open: boolean; onClose: () => void; onAsked: () => void }) {
  const [email, setEmail] = useState("")
  const [message, setMessage] = useState("")
  const send = () => report(askFriend(email, message)).then(() => {
    notify({ message: `Asked ${email.trim()}. They’ll see your name and email, and can let you in.`, tone: "info" })
    setEmail(""); setMessage(""); onClose(); onAsked()
  })
  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Make friends</DialogTitle>
          <DialogDescription>Ask someone by the email of their ohm account. If they let you in, you’ll see what they share with friends here.</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-2" onSubmit={event => { event.preventDefault(); send() }}>
          <Input type="email" required autoFocus placeholder="their@email.com" aria-label="Their email" value={email} onChange={event => setEmail(event.target.value)} />
          <Textarea placeholder="A line for them (optional)" aria-label="Message" maxLength={1000} value={message} onChange={event => setMessage(event.target.value)} />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={!email.trim()}>Ask</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
