// Settings, inside the profile. The layout follows agentic-twitter's account pages: a heading and
// one line on what the page is for, then sections, each a title over a toned block of rows with
// their controls on the right.
import { useEffect, useId, useState, type ReactNode } from "react"
import { CopyIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Icon } from "@/components/ui/icon"
import { Input } from "@/components/ui/input"
import { notify } from "@/components/ui/notice"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { blocks, cortex, channelRecords, getSource } from "@/data/workspace-data"
import { forgetBridge } from "@/data/bridge"
import { forgetPairedBrowser, homeKeys, type PairedBrowser } from "@/data/browsers"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { SETTINGS_TABS, type SettingsTab } from "./settings-tabs"
import type { Friend } from "@/data/source"
import { ChannelPicker, chosen, pickedNothing, pickedOf, type Picked } from "./ChannelPicker"
import { panelTitle } from "./Surface"
import {
  answerCortex, cortexWaiting, loadPeople, me, removeFriend, report, setAgentsAllowed, setAppearance, setDensity, setFriendChannels, setOffered, setSource, useWorkspace, waitingFriends,
  type Appearance, type Density, type People, type ToolName,
} from "./store"
import { cn } from "@/lib/cn"

function Section({ title, intro, children }: { title: string; intro?: string; children: ReactNode }) {
  return (
    <section className="mb-8">
      <h3 className="mb-3 text-h3">{title}</h3>
      {/* A toned block; controls on it sit on paper so their fills still read. */}
      <div className="rounded-2xl bg-muted px-4 py-1 [--secondary:var(--ohm-paper)] [--input:var(--ohm-paper)]">
        {intro && <p className="pt-3 pb-1 text-body text-muted-foreground">{intro}</p>}
        <ul>{children}</ul>
      </div>
    </section>
  )
}

function Row({ title, note, action }: { title: ReactNode; note?: ReactNode; action?: ReactNode }) {
  return (
    <li className="flex min-h-[62px] flex-wrap items-center justify-between gap-x-5 gap-y-2 py-3.5 text-body">
      <span className="flex min-w-[min(160px,100%)] flex-1 flex-col gap-0.5 break-words">
        {title}
        {note && <small className="text-small text-muted-foreground">{note}</small>}
      </span>
      {action && <span className="flex flex-wrap items-center gap-2">{action}</span>}
    </li>
  )
}

const dayOf = (iso?: string) => {
  if (!iso) return ""
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000)
  return days < 1 ? "today" : days < 2 ? "yesterday" : new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })
}

/**
 * The browsers paired with the home on this computer, each with its own key. Forgetting one shuts it
 * out at once (docs/serve.md); forgetting this one takes the app back to the sample. The person's
 * alone: no tool does it.
 */
function PairedBrowsers() {
  const [browsers, setBrowsers] = useState<PairedBrowser[] | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [forgetting, setForgetting] = useState<PairedBrowser | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let live = true
    homeKeys().then(keys => { if (live) setBrowsers(keys.browsers) }).catch(error => { if (live) setProblem(error instanceof Error ? error.message : String(error)) })
    return () => { live = false }
  }, [])
  const nameOf = (each: PairedBrowser) => each.name ?? "A browser not named yet"
  const forget = () => {
    if (!forgetting) return
    setBusy(true)
    forgetPairedBrowser(forgetting.id)
      .then(done => {
        setBrowsers(list => list?.filter(each => each.id !== done.forgotten) ?? null)
        notify({ message: done.you ? "This browser can no longer open your home. This is the sample." : `Forgot ${forgetting.name ?? "that browser"}: it can no longer open your home`, tone: "info" })
        if (done.you) { forgetBridge(); void setSource() }
        setForgetting(null)
      })
      .catch(error => setProblem(error instanceof Error ? error.message : String(error)))
      .finally(() => setBusy(false))
  }
  return (
    <Section title="Browsers paired with your home" intro="Each has its own key. Forget one you no longer use, or have lost: it can no longer open your home. To pair a browser, run ohm pair in your home.">
      {problem ? <Row title="The list could not be read" note={problem} /> : null}
      {browsers?.map(each => (
        <Row key={each.id}
          title={<span className="flex flex-wrap items-center gap-2">{nameOf(each)}{each.you ? <Badge variant="secondary">This browser</Badge> : null}</span>}
          note={[`Paired ${dayOf(each.made)}`, each.seen ? `last used ${dayOf(each.seen)}` : null, each.app ?? null].filter(Boolean).join(" · ")}
          action={<Button variant="secondary" onClick={() => setForgetting(each)}>Forget</Button>} />
      ))}
      <Dialog open={!!forgetting} onOpenChange={open => { if (!open && !busy) setForgetting(null) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{forgetting?.you ? "Forget this browser?" : forgetting?.name ? `Forget ${forgetting.name}?` : `Forget the browser paired ${dayOf(forgetting?.made)}?`}</DialogTitle>
            <DialogDescription>
              {forgetting?.you
                ? "This browser can no longer open your home, and goes back to the sample. To use it again, run ohm pair in your home and open the link."
                : "It can no longer open your home, from now on. To use it again, pair it with ohm pair."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" disabled={busy} onClick={() => setForgetting(null)}>Cancel</Button>
            <Button variant="destructive" disabled={busy} onClick={forget}>Forget</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Section>
  )
}

function FieldRow({ label, children }: { label: string; children: (id: string) => ReactNode }) {
  const id = useId()
  return (
    <li className="flex flex-col gap-1.5 py-3">
      <label htmlFor={id} className="text-body font-medium">{label}</label>
      {children(id)}
    </li>
  )
}

const copy = (text: string) => {
  void navigator.clipboard?.writeText(text)
  notify({ message: "Copied", tone: "info" })
}

const TOOLS: { name: ToolName; title: string; does: string; reads: boolean }[] = [
  { name: "workspace.search", title: "Search", does: "Searches your Collections and Agents", reads: true },
  { name: "workspace.open", title: "Open", does: "Opens a block or cortex file", reads: true },
  { name: "short.write", title: "Save", does: "Saves a short post as private; nothing is published", reads: false },
  { name: "feed.read", title: "Feed", does: "Shows your feed and reads what changed in your home, newest first", reads: true },
  { name: "workspace.graph", title: "Show graph", does: "Shows the graph of your blocks, or of those mentioning a person", reads: true },
  { name: "workspace.create", title: "New block", does: "Starts a private draft", reads: false },
  { name: "workspace.save-draft", title: "Save draft", does: "Saves the open draft as private", reads: false },
  { name: "workspace.add-image", title: "Image", does: "Adds an image to the open private block, as a media block it embeds", reads: false },
  { name: "visibility.preview", title: "Who can see it", does: "Says what moving a block to other people would do", reads: true },
  { name: "visibility.move", title: "Change visibility", does: "Asks you to move a block between only you and friends; nothing moves until you approve", reads: false },
  { name: "history.list", title: "History", does: "Reads who changed what, and when", reads: true },
  { name: "history.save", title: "Save", does: "Names this point in history; changes nothing", reads: false },
  { name: "history.session", title: "Finish task", does: "Records what an agent did and its dead ends", reads: false },
  { name: "history.revert", title: "Revert this change", does: "Undoes one change", reads: false },
  { name: "history.versions", title: "Versions", does: "Reads the versions of the open block", reads: true },
  { name: "history.restore", title: "Restore this version", does: "Brings a private block back to an earlier version", reads: false },
  { name: "cortex.observe", title: "Write observation", does: "Writes an observation about the open block into Agents, once you approve it", reads: false },
]

/** Friends: each one, with what they see, changed or taken away here. */
function FriendsPage() {
  const { rev } = useWorkspace()
  const [people, setPeople] = useState<People | null>(null)
  const [editing, setEditing] = useState<{ friend: Friend } & Picked | null>(null)
  const [removing, setRemoving] = useState<Friend | null>(null)
  const reload = () => { void report(loadPeople().then(setPeople)) }
  useEffect(reload, [rev]) // eslint-disable-line react-hooks/exhaustive-deps
  const waiting = waitingFriends()
  const nameOf = (friend: Friend) => friend.name || friend.email || friend.did
  const sees = (channels: Friend["channels"]) => (!channels || channels === "*" ? "Every channel" : channels.join(", "))
  if (!people) return null
  return <>
    <Section title="Friends" intro="They, and their agents, read your friends-only blocks in the channels shown. It lasts until you stop sharing with them.">
      {people.friends.map(friend => (
        <Row key={friend.did} title={nameOf(friend)}
          note={<>{[friend.email, nameOf(friend) === friend.did ? null : friend.did].filter(Boolean).join(" · ")}{(friend.email || nameOf(friend) !== friend.did) && <br />}Sees: {sees(friend.channels)}</>}
          action={<>
            <Button variant="secondary" size="sm" onClick={() => setEditing({ friend, ...pickedOf(friend.channels) })}>Channels</Button>
            <Button variant="ghost" size="sm" onClick={() => setRemoving(friend)}>Stop sharing</Button>
          </>} />
      ))}
      {!people.friends.length && <Row title="No friends yet" note="Make friends from Connections in the rack, by their email." />}
    </Section>
    {waiting.length > 0 && (
      <Section title="Waiting for you">
        <Row title={`${waiting.length} asking to be your friend`} note="Answer them in Notifications, under Agent." />
      </Section>
    )}
    {people.asks.some(ask => ask.state === "waiting") && (
      <Section title="You asked">
        {people.asks.filter(ask => ask.state === "waiting").map(ask => <Row key={ask.email} title={ask.email} note="Waiting for them to let you in" />)}
      </Section>
    )}

    <Dialog open={!!editing} onOpenChange={o => !o && setEditing(null)}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>What {editing && nameOf(editing.friend)} sees</DialogTitle>
          <DialogDescription>They and their agents read your friends-only blocks filed in these channels, and the channels inside them.</DialogDescription>
        </DialogHeader>
        {editing && <ChannelPicker value={editing} onChange={picked => setEditing({ ...editing, ...picked })} />}
        <DialogFooter>
          <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
          <Button disabled={!!editing && pickedNothing(editing)} onClick={() => {
            if (!editing) return
            const { friend } = editing
            const next = chosen(editing)
            setEditing(null)
            report(setFriendChannels(friend.did, next)).then(() => { notify({ message: `${nameOf(friend)} now sees ${sees(next).toLowerCase()}.`, tone: "info" }); reload() })
          }}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={!!removing} onOpenChange={o => !o && setRemoving(null)}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Stop sharing with {removing && nameOf(removing)}?</DialogTitle>
          <DialogDescription>They, and their agents, stop reading your friends-only blocks from now on. What they already read can’t be taken back.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setRemoving(null)}>Cancel</Button>
          <Button variant="destructive" onClick={() => {
            if (!removing) return
            const friend = removing
            setRemoving(null)
            report(removeFriend(friend.did)).then(() => { notify({ message: `${nameOf(friend)} no longer sees what you share.`, tone: "info" }); reload() })
          }}>Stop sharing</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>
}

function Page({ tab }: { tab: SettingsTab }) {
  const { appearance, density, agentsAllowed, offered } = useWorkspace()
  switch (tab) {
    case "friends":
      return <FriendsPage />
    case "profile":
      return <>
        <Section title="Profile">
          <FieldRow label="Display name">{id => <Input id={id} defaultValue={me.name} />}</FieldRow>
          <FieldRow label="Description">{id => <Textarea id={id} defaultValue="Writes slowly. Walks in cities." />}</FieldRow>
          <Row title="Picture" note="Square, at least 400 pixels"
            action={<Button variant="secondary" onClick={() => notify({ message: "Not part of this wireframe", tone: "info" })}>Choose</Button>} />
        </Section>
        <Section title="Publishing">
          <Row title="Your profile is public" note="You approve profile changes before they are published."
            action={<Button onClick={() => notify({ message: "Publishing your profile asks you first; not part of this wireframe", tone: "info" })}>Review changes</Button>} />
        </Section>
      </>
    case "identity":
      return <Section title="Identity" intro="Your DID is the root. Its document names your handle and the server that holds your repository.">
        <Row title="DID" note={<code>{me.did}</code>} action={<Button size="icon-sm" variant="ghost" aria-label="Copy DID" onClick={() => copy(me.did)}><Icon icon={CopyIcon} size="sm" /></Button>} />
        <Row title="Handle" note={`@${me.handle}`} action={<Button variant="secondary">Change</Button>} />
        <Row title="Server (PDS)" note="pds.example" action={<Badge variant="secondary">Yours</Badge>} />
      </Section>
    case "agents":
      return <>
        <Section title="Workspace">
          <Row title="Offer tools to browser agents" note="An agent in your browser sees only the tools below, and only while their screen is open."
            action={<Switch aria-label="Offer tools to browser agents" checked={agentsAllowed} onCheckedChange={setAgentsAllowed} />} />
        </Section>
        <Section title="Tools">
          {TOOLS.map(t => (
            <Row key={t.name} title={<span className="flex flex-wrap items-center gap-2">{t.title} <code className="text-small text-muted-foreground">{t.name}</code></span>}
              note={<>{t.does} · {t.reads ? "Reads only" : t.name === "visibility.move" ? "Asks you first" : "Changes private drafts"}</>}
              action={<Switch aria-label={`Offer ${t.title}`} disabled={!agentsAllowed} checked={agentsAllowed && offered[t.name]} onCheckedChange={v => setOffered(t.name, v)} />} />
          ))}
        </Section>
        <p className="text-small text-muted-foreground">Nothing an agent does here is public. Publishing will be its own step, and it always asks you.</p>
      </>
    case "vault": {
      const paths = channelRecords.map(channel => channel.path)
      const source = getSource()
      const home = source && "home" in source ? (source.home as { handle: string; url: string }) : null
      return <>
        <Section title="Where this is">
          {home
            ? <Row title={`Your ohm, ohm.${home.handle}`} note={`On this computer, through ohm serve at ${home.url}. Changes are written to its files.`}
                action={<Button variant="secondary" onClick={() => { forgetBridge(); void setSource() }}>Use the sample</Button>} />
            : <Row title="A sample home" note="Run ohm serve in your home and open the link it prints, to work on your own files. Changes here last until you reload." />}
        </Section>
        {home ? <PairedBrowsers /> : null}
        <Section title="New blocks">
          <Row title="Start private" note="Every new block is yours alone until you choose who it is for." action={<Badge variant="secondary">Always</Badge>} />
        </Section>
        <Section title="Channels">
          {paths.map(path => (
            <Row key={path} title={path} note={`${blocks.filter(block => block.homeChannel === path).length} blocks`} action={<Button variant="secondary">Rename</Button>} />
          ))}
        </Section>
      </>
    }
    case "cortex":
      return <CortexPage />
    case "appearance":
      return <>
        <Section title="Theme">
          <Row title="Appearance" action={(["system", "light", "dark"] as Appearance[]).map(m => (
            <Button key={m} variant={appearance === m ? "default" : "secondary"} aria-pressed={appearance === m} onClick={() => setAppearance(m)} className="capitalize">
              {m}
            </Button>
          ))} />
        </Section>
        <Section title="Density">
          <Row title="Corners and menus"
            note="One radius for panels, menus and popovers. Compact menus have tight rows, and the highlighted one is filled forest."
            action={(["compact", "comfortable", "rounded"] as Density[]).map(d => (
              <Button key={d} variant={density === d ? "default" : "secondary"} aria-pressed={density === d} onClick={() => setDensity(d)} className="capitalize">
                {d}
              </Button>
            ))} />
        </Section>
      </>
  }
}

/**
 * The cortex: how many of each part, and what agents proposed or asked for, waiting for the person.
 * Accepting a profile line adds it under its heading; approving a skill puts it in force. Tools
 * agents asked for are built by the person and added to tools/, so they are listed, not approved here.
 */
function CortexPage() {
  useWorkspace()
  const waiting = cortexWaiting()
  const count = (kind: string) => cortex.filter(c => c.kind === kind).length
  const tools = cortex.filter(c => c.kind === "tool")
  const answer = (kind: "profile" | "skill", id: string, yes: boolean, said: string) => {
    answerCortex(kind, id, yes)
      .then(() => notify({ message: said, tone: "info" }))
      .catch((error: unknown) => notify({ message: error instanceof Error ? error.message : "Agents did not take the answer" }))
  }
  const waits = waiting.profile.length + waiting.skills.length + waiting.tools.length
  return <>
    <Section title="Waiting for you" intro={waits ? "What your agents proposed. Nothing changes until you answer." : "Nothing is waiting. When an agent proposes a profile line or a skill, it shows here."}>
      {waiting.profile.map(p => (
        <Row key={p.id} title={<span>Add to {p.heading}: “{p.line}”</span>}
          note={`Proposed by ${p.by}${p.quote ? `, after you said “${p.quote}”` : ""}`}
          action={<>
            <Button variant="ghost" onClick={() => answer("profile", p.id, false, "Declined. Agents will not propose it again")}>Decline</Button>
            <Button variant="secondary" onClick={() => answer("profile", p.id, true, `Added to ${p.heading}`)}>Accept</Button>
          </>} />
      ))}
      {waiting.skills.map(k => (
        <Row key={k.name} title={<span>Skill: {k.name}</span>} note={`${k.description}${k.by ? ` · proposed by ${k.by}` : ""}`}
          action={<>
            <Button variant="ghost" onClick={() => answer("skill", k.name, false, `Declined ${k.name}`)}>Decline</Button>
            <Button variant="secondary" onClick={() => answer("skill", k.name, true, `${k.name} is in force`)}>Approve</Button>
          </>} />
      ))}
      {waiting.tools.map(t => (
        <Row key={t.name} title={<span>Tool asked for: {t.name}</span>} note={`${t.description}${t.by ? ` · asked by ${t.by}` : ""}. A tool is built, then added to tools/ in Agents, where you switch it on.`} />
      ))}
    </Section>
    <Section title="Agents">
      <Row title="Profile" note="Your preferences, goals and notes. Agents read it every session and only propose changes. Open it to edit it." />
      <Row title="Observations" note={`${count("observation")} written as your agents work, and by you. Open one to edit, pin or forget it`} />
      <Row title="Skills" note={`${count("skill")} approved. Open one to edit or remove it`} />
      <Row title="Tools" note={`${tools.filter(t => t.on).length} of ${tools.length} switched on`} />
    </Section>
  </>
}

export function SettingsView({ tab }: { tab: SettingsTab }) {
  const current = SETTINGS_TABS.find(t => t.id === tab)!
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className={cn("mx-auto w-full max-w-[720px] px-8 py-16 max-md:px-5 max-md:py-10")}>
        <header className="mb-9">
          <h2 className={panelTitle}>{current.label}</h2>
          <p className="mt-2 text-body text-muted-foreground">{current.description}</p>
        </header>
        <Page tab={tab} />
      </div>
    </div>
  )
}
