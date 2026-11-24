// Settings, inside the profile. The layout follows agentic-twitter's account pages: a heading and
// one line on what the page is for, then sections, each a title over a toned block of rows with
// their controls on the right.
import { useId, type ReactNode } from "react"
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
import { SETTINGS_TABS, type SettingsTab } from "./settings-tabs"
import { panelTitle } from "./Surface"
import {
  me, setAgentsAllowed, setAppearance, setDensity, setOffered, setSource, useWorkspace, type Appearance, type Density, type ToolName,
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
  { name: "workspace.search", title: "Search", does: "Searches your vault and cortex", reads: true },
  { name: "workspace.open", title: "Open", does: "Opens a block or cortex file", reads: true },
  { name: "workspace.graph", title: "Show graph", does: "Shows the graph of your blocks, or of those mentioning a person", reads: true },
  { name: "workspace.create", title: "New block", does: "Starts a private draft", reads: false },
  { name: "workspace.save-draft", title: "Save draft", does: "Saves the open draft as private", reads: false },
  { name: "workspace.add-image", title: "Image", does: "Adds an image to the open private block, as a media block it embeds", reads: false },
  { name: "history.list", title: "History", does: "Reads who changed what, and when", reads: true },
  { name: "history.save", title: "Save", does: "Names this point in history; changes nothing", reads: false },
  { name: "history.session", title: "Finish task", does: "Records what an agent did and its dead ends", reads: false },
  { name: "history.revert", title: "Revert this change", does: "Undoes one change", reads: false },
  { name: "history.versions", title: "Versions", does: "Reads the versions of the open block", reads: true },
  { name: "history.restore", title: "Restore this version", does: "Brings a private block back to an earlier version", reads: false },
]

function Page({ tab }: { tab: SettingsTab }) {
  const { appearance, density, agentsAllowed, offered } = useWorkspace()
  switch (tab) {
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
              note={<>{t.does} · {t.reads ? "Reads only" : "Changes private drafts"}</>}
              action={<Switch aria-label={`Offer ${t.title}`} disabled={!agentsAllowed} checked={agentsAllowed && offered[t.name]} onCheckedChange={v => setOffered(t.name, v)} />} />
          ))}
        </Section>
        <p className="text-small text-muted-foreground">Nothing an agent does here is public. Publishing will be its own step, and it always asks you.</p>
      </>
    case "vault": {
      const paths = channelRecords.map(channel => channel.path)
      const source = getSource()
      const home = "home" in source ? (source.home as { handle: string; url: string }) : null
      return <>
        <Section title="Where this is">
          {home
            ? <Row title={`Your home, ohmmmm.${home.handle}`} note={`On this computer, through ohmmmm serve at ${home.url}. Changes are written to its files.`}
                action={<Button variant="secondary" onClick={() => { forgetBridge(); void setSource() }}>Use the sample</Button>} />
            : <Row title="A sample home" note="Run ohmmmm serve in your home and open the link it prints, to work on your own files. Changes here last until you reload." />}
        </Section>
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
      return <Section title="Cortex">
        <Row title="Profile" note="Your preferences, goals and notes. Agents read it every session and only propose changes" />
        <Row title="Observations" note={`${cortex.filter(c => c.kind === "observation").length} written by your agents as they work. You can edit or remove any`} />
        <Row title="Skills" note={`${cortex.filter(c => c.kind === "skill").length} approved`} />
        <Row title="Tools" note={`${cortex.filter(c => c.kind === "tool").length} switched on`} />
      </Section>
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
