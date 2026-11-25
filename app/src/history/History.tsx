// Version history, for you and for agents (flows/history.md). A timeline over the home's journal (data/journal.ts: the sealed cortex journal and this device's changes),
// drawn as a minimal vertical timeline, as VS Code's Timeline is: one line per entry, an icon for who,
// and what was done as a verb with the block it was done to ("Edited Monday, rain").
//
// You and agents both edit directly; every change is marked with who made it, and you revert what
// you don't want. Three tabs: Dates (one autosave per day, opening into that day's changes), You, and
// Agents (their sessions: what they did as one task, the changes inside, and their dead ends). A
// block's own versions open from its toolbar. Each registers its step's tools while on screen.
import { useEffect, useMemo, useState } from "react"
import type { LucideIcon } from "lucide-react"
import { BotIcon, CalendarIcon, ClockIcon, FileTextIcon, FlagIcon, RotateCcwIcon, Undo2Icon, UserIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Icon } from "@/components/ui/icon"
import { notify } from "@/components/ui/notice"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Switch } from "@/components/ui/switch"
import {
  diffWords,
  type Actor, type ChangeLine, type ChangeOp, type DeadEnd, type Line, type SaveLine, type SessionLine, type Snapshot,
} from "@/data/journal"
import { byId, journalOf, titleOf, type Doc } from "@/data/workspace-data"
import { cn } from "@/lib/cn"
import { registerStepTool } from "@/webmcp"
import { finishSession, focusHistory, open, restoreVersion, revertChange, saveNow, useWorkspace } from "@/workspace/store"
import { withAgent } from "@/workspace/tools"

export const when = (at: string) => new Date(at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
const time = (at: string) => new Date(at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
export const dayKey = (at: string) => new Date(at).toLocaleDateString("en-CA")
export const dayOf = (at: string) => new Date(at).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })
const byName = (a: Actor) => (a.kind === "human" ? "You" : a.name)
/** A block's name: as it is now, or for a block that is gone, as its last version had it. */
const nodeTitle = (node: string) => {
  const d = byId(node)
  if (d) return titleOf(d)
  const last = journalOf().linesFor(node).at(-1)
  return (last && (journalOf().snapshotAt(last.before ?? last.after)?.title || undefined)) ?? "a removed item"
}

/** What was done, as a verb. */
const VERB: Record<ChangeOp, string> = {
  create: "Created", edit: "Edited", move: "Moved", channels: "Filed", connect: "Connected",
  restore: "Restored", revert: "Reverted", remove: "Deleted",
}
// ─── The timeline's parts ───────────────────────────────────────────────────────

export type Mark = "human" | "agent" | "save" | "day"
export function MarkIcon({ mark, title }: { mark: Mark; title: string }) {
  const icon: Record<Mark, LucideIcon> = { human: UserIcon, agent: BotIcon, save: FlagIcon, day: CalendarIcon }
  return (
    <span title={title} aria-label={title}
      className={cn("relative flex size-5 flex-none items-center justify-center rounded-full ring-2 ring-card",
        mark === "agent" ? "bg-(--ohm-green-light) text-primary"
          : mark === "day" ? "bg-muted text-foreground"
          : "bg-primary text-primary-foreground dark:bg-foreground dark:text-background")}>
      <Icon icon={icon[mark]} size="xs" />
    </span>
  )
}

/** One entry on the line: an icon for who, one line of text, the time; open for its details. */
export function Stop({ mark, who, text, at, tag, open: isOpen, onToggle, first, last, children }: {
  mark: Mark; who: string; text: React.ReactNode; at?: string; tag?: React.ReactNode
  open: boolean; onToggle: () => void; first?: boolean; last?: boolean; children?: React.ReactNode
}) {
  return (
    <li className="relative flex gap-2">
      <span aria-hidden className="relative flex w-5 flex-none justify-center">
        <span className={cn("absolute left-1/2 w-px -translate-x-1/2 bg-border", first ? "top-3" : "top-0", last && !isOpen ? "h-3" : "bottom-0")} />
        <span className="relative mt-1.5"><MarkIcon mark={mark} title={who} /></span>
      </span>
      <div className="min-w-0 flex-1">
        <button type="button" aria-expanded={isOpen} onClick={onToggle}
          className={cn("flex h-8 w-full items-center gap-2 rounded-md px-1.5 text-left transition-colors duration-(--ohm-duration-state) hover:bg-muted", isOpen && "bg-muted")}>
          <span className="min-w-0 flex-1 truncate text-body">{text}</span>
          {tag}
          {at && <span className="flex-none text-small text-muted-foreground tabular-nums">{time(at)}</span>}
        </button>
        {isOpen && <div className="flex flex-col gap-2 pb-2 ps-1.5 pt-1">{children}</div>}
      </div>
    </li>
  )
}

export function Day({ day }: { day: string }) {
  return (
    <li className="relative flex gap-2">
      <span aria-hidden className="relative flex w-5 flex-none justify-center"><span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border" /></span>
      <span className="pt-2 pb-0.5 text-small text-muted-foreground">{day}</span>
    </li>
  )
}

/** A verb and the block: the verb plain, the block in weight. */
const Did = ({ verb, node }: { verb: string; node: string }) => <><span className="text-muted-foreground">{verb}</span> <span className="font-medium">{nodeTitle(node)}</span></>

/** What a change touched, as a small tree, as Source Control lists changed files. */
function ChangeTree({ node, before, after }: { node: string; before?: Snapshot; after: Snapshot }) {
  const words = (t: string) => t.split(/\s+/).filter(Boolean).length
  const rows: { name: string; detail: string }[] = []
  if (!before) rows.push({ name: "made", detail: `${words(after.body)} words` })
  else {
    if (before.title !== after.title) rows.push({ name: "title", detail: `“${before.title}” → “${after.title}”` })
    if (before.body !== after.body) {
      const parts = diffWords(before.body, after.body)
      const add = parts.filter(p => p.kind === "added").reduce((n, p) => n + words(p.text), 0)
      const del = parts.filter(p => p.kind === "removed").reduce((n, p) => n + words(p.text), 0)
      rows.push({ name: "text", detail: `+${add} −${del}` })
    }
    const place = (x: Snapshot) => (x.homeChannel?.replaceAll("/", " › ") ?? "")
    if (place(before) !== place(after)) rows.push({ name: "home channel", detail: `${place(before)} → ${place(after)}` })
    if (JSON.stringify(before.channels ?? []) !== JSON.stringify(after.channels ?? [])) rows.push({ name: "channels", detail: `${(before.channels ?? []).join(", ") || "none"} → ${(after.channels ?? []).join(", ") || "none"}` })
    if (JSON.stringify(before.connect ?? []) !== JSON.stringify(after.connect ?? [])) rows.push({ name: "connections", detail: `${(before.connect ?? []).map(c => c.to).join(", ") || "none"} → ${(after.connect ?? []).map(c => c.to).join(", ") || "none"}` })
  }
  return (
    <div className="flex flex-col">
      <span className="flex h-6 items-center gap-1.5 text-small"><Icon icon={FileTextIcon} size="xs" className="text-muted-foreground" />{nodeTitle(node)}</span>
      <ul className="ms-1.5 flex flex-col border-s border-border ps-3">
        {rows.map(row => (
          <li key={row.name} className="flex h-6 items-center gap-2 text-small"><span>{row.name}</span><span className="truncate text-muted-foreground">{row.detail}</span></li>
        ))}
      </ul>
    </div>
  )
}

function Diff({ before, after }: { before?: Snapshot; after: Snapshot }) {
  const parts = diffWords(before?.body ?? "", after.body)
  if (!parts.some(p => p.kind !== "same")) return null
  return (
    <p className="max-h-40 overflow-y-auto rounded-lg bg-muted/60 p-2 text-small leading-relaxed whitespace-pre-wrap">
      {parts.map((p, i) => p.kind === "same" ? <span key={i}>{p.text}</span>
        : <span key={i} className={p.kind === "added" ? "rounded-sm bg-(--ohm-green-light)/45" : "rounded-sm text-muted-foreground line-through"}>{p.text}</span>)}
    </p>
  )
}

const meta = (who: Actor, at: string, reason?: string) => (
  <p className="text-small text-muted-foreground">{byName(who)} · {when(at)}{reason ? <> · <span className="italic">“{reason}”</span></> : null}</p>
)
const act = (fn: () => unknown, message: string, done?: () => void) => {
  Promise.resolve().then(fn).then(() => { notify({ message, tone: "info" }); done?.() })
    .catch(err => notify({ message: (err as Error).message }))
}

/** A change, opened: who and why, what it touched, the words, and Revert, Restore, Open. */
function ChangeDetail({ line, inPage, onDone }: { line: ChangeLine; inPage?: boolean; onDone?: () => void }) {
  const doc = byId(line.node)
  const [againstNow, setAgainstNow] = useState(false)
  const before = line.before ? journalOf().snapshotAt(line.before) : undefined
  const after = journalOf().snapshotAt(line.after)!
  const now = journalOf().currentVersion(line.node)
  const current = now ? journalOf().snapshotAt(now) : undefined
  const editable = doc?.visibility === "private"
  return <>
    {meta(line.actor, line.at, line.reason)}
    <ChangeTree node={line.node} before={before} after={after} />
    {now !== line.after && current && (
      <label className="flex w-fit items-center gap-1.5 text-small text-muted-foreground">Against now <Switch checked={againstNow} onCheckedChange={setAgainstNow} /></label>
    )}
    {againstNow && current ? <Diff before={after} after={current} /> : <Diff before={before} after={after} />}
    {doc && (
      <div className="flex flex-wrap items-center gap-1">
        {editable && line.op !== "create" && line.op !== "remove" && (
          <Button size="sm" className="h-7 gap-1.5" onClick={() => act(() => revertChange(line.id), `Reverted: ${VERB[line.op].toLowerCase()} ${nodeTitle(line.node)}`, onDone)}>
            <Icon icon={Undo2Icon} size="sm" /> Revert this change
          </Button>
        )}
        {editable && now !== line.after && (
          <Button size="sm" variant="ghost" className="h-7 gap-1.5" onClick={() => act(() => restoreVersion(doc.id, line.after), `Restored ${nodeTitle(line.node)} to ${when(line.at)}`, onDone)}>
            <Icon icon={RotateCcwIcon} size="sm" /> Restore this version
          </Button>
        )}
        {!inPage && <Button size="sm" variant="ghost" className="h-7" onClick={() => openVersion(doc.id, line.id)}>Open in editor</Button>}
        {!editable && <span className="text-small text-muted-foreground">Changes to shared blocks require approval.</span>}
      </div>
    )}
  </>
}

/** An agent's session, opened: what it did, the changes it made (each opens and reverts), and its dead ends. */
function SessionDetail({ line }: { line: SessionLine }) {
  const changes = line.changes.map(journalOf().changeById).filter((c): c is ChangeLine => !!c)
  const [picked, setPicked] = useState<string | null>(null)
  return <>
    {meta(line.actor, line.at)}
    {changes.length > 0 && (
      <ol className="flex flex-col">
        {changes.map((c, i) => <Entry key={c.id} line={c} picked={picked} setPicked={setPicked} first={i === 0} last={i === changes.length - 1} />)}
      </ol>
    )}
    {line.deadEnds.length > 0 && <DeadEnds list={line.deadEnds} />}
    {!changes.length && !line.deadEnds.length && <p className="text-small text-muted-foreground">It changed nothing.</p>}
  </>
}

function DeadEnds({ list }: { list: DeadEnd[] }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-small font-semibold text-muted-foreground">Dead ends</span>
      {list.map(d => (
        <p key={d.tried} className="text-small">
          <span className="line-through decoration-muted-foreground/60">{d.tried}</span>
          <span className="text-muted-foreground"> · {d.why}{d.recheck ? ` · recheck: ${d.recheck}` : ""}</span>
        </p>
      ))}
    </div>
  )
}

const SaveDetail = ({ line }: { line: SaveLine }) => <p className="text-small text-muted-foreground">{byName(line.actor)} · {when(line.at)}{line.note ? ` · ${line.note}` : ""}</p>

/** One entry of the journal as a stop on the line, in the words the timeline uses. */
function Entry({ line, inPage, picked, setPicked, first, last, onDone }: {
  line: Line; inPage?: boolean; picked: string | null; setPicked: (id: string | null) => void; first?: boolean; last?: boolean; onDone?: () => void
}) {
  const common = { open: picked === line.id, onToggle: () => setPicked(picked === line.id ? null : line.id), first, last }
  switch (line.type) {
    case "change":
      return <Stop {...common} mark={line.actor.kind} who={byName(line.actor)} at={line.at}
        text={inPage ? <span className="text-muted-foreground">{line.summary}</span> : <Did verb={VERB[line.op]} node={line.node} />}>
        <ChangeDetail line={line} inPage={inPage} onDone={onDone} />
      </Stop>
    case "session":
      return <Stop {...common} mark="agent" who={byName(line.actor)} at={line.at}
        tag={line.deadEnds.length ? <span className="flex-none text-small text-muted-foreground">{line.deadEnds.length} dead {line.deadEnds.length === 1 ? "end" : "ends"}</span> : undefined}
        text={<><span className="text-muted-foreground">{byName(line.actor)}:</span> {line.done}</>}>
        <SessionDetail line={line} />
      </Stop>
    case "save":
      return <Stop {...common} mark="save" who={`Saved by ${byName(line.actor)}`} at={line.at} text={<><span className="text-muted-foreground">Saved</span> <span className="font-semibold">{line.name}</span></>}>
        <SaveDetail line={line} />
      </Stop>
    default:
      return null
  }
}

function Timeline({ lines, inPage, picked, setPicked, onDone }: {
  lines: Line[]; inPage?: boolean; picked: string | null; setPicked: (id: string | null) => void; onDone?: () => void
}) {
  const rows: ({ day: string } | Line)[] = []
  let last = ""
  for (const l of lines) { const d = dayOf(l.at); if (d !== last) { rows.push({ day: d }); last = d }; rows.push(l) }
  return (
    <ol aria-label="Timeline" className="flex flex-col">
      {rows.map((r, i) => "day" in r ? <Day key={`day:${r.day}`} day={r.day} />
        : <Entry key={r.id} line={r} inPage={inPage} picked={picked} setPicked={setPicked} first={i === 1} last={i === rows.length - 1} onDone={onDone} />)}
    </ol>
  )
}

// ─── The Days layer: one autosave per day ───────────────────────────────────────

/**
 * The Dates tab groups changes by day. Opening a day shows its changes, newest first.
 */
function dailyAutosaves() {
  const days = new Map<string, ChangeLine[]>()
  for (const l of journalOf().historyLines()) if (l.type === "change") { const k = dayKey(l.at); days.set(k, [...(days.get(k) ?? []), l]) }
  return [...days].sort(([a], [b]) => b.localeCompare(a)).map(([day, lines]) => {
    const sorted = [...lines].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    return { day, at: sorted[0].at, lines: sorted, blocks: new Set(lines.map(l => l.node)).size }
  })
}

function DaysLayer() {
  const { rev } = useWorkspace()
  const days = useMemo(dailyAutosaves, [rev])
  const [openDay, setOpenDay] = useState<string | null>(days[0]?.day ?? null)
  const [picked, setPicked] = useState<string | null>(null)
  return (
    <ol aria-label="Daily autosaves" className="flex flex-col">
      {days.map((d, i) => (
        <Stop key={d.day} mark="day" who="Autosave" first={i === 0} last={i === days.length - 1} open={openDay === d.day} onToggle={() => setOpenDay(openDay === d.day ? null : d.day)}
          text={<><span className="font-medium">{dayOf(d.at)}</span> <span className="text-muted-foreground">· {d.blocks} {d.blocks === 1 ? "block" : "blocks"}</span></>}>
          <ol className="flex flex-col">
            {d.lines.map((l, j) => <Entry key={l.id} line={l} picked={picked} setPicked={setPicked} first={j === 0} last={j === d.lines.length - 1} />)}
          </ol>
        </Stop>
      ))}
    </ol>
  )
}

// ─── Revert and restore: one pair of tools for every view that shows them ──────

/**
 * Revert this change and Restore this version are buttons in both the home’s history and a
 * block's versions, so their tools exist while either is on screen: registered by the first view to
 * mount and withdrawn when the last one goes. They name the change or block, so they work the same
 * from both, and call the same handlers as the buttons.
 */
let changeTools: { users: number; ac: AbortController | null; key: string } = { users: 0, ac: null, key: "" }
function registerChangeTools(revert: boolean, restore: boolean) {
  const ac = new AbortController()
  if (revert) registerStepTool<{ change: string; reason?: string }, unknown>({
    name: "history.revert", title: "Revert this change",
    description: "Undoes one change to a private block, as git revert does: only the parts that change touched go back, and later changes to other parts stay. Refused if a later change touched the same part. The revert is a new change, marked as the agent's, which the person can revert. Returns the block id and the parts reverted.",
    inputSchema: { type: "object", properties: { change: { type: "string", maxLength: 64 } }, required: ["change"], additionalProperties: false },
    outputSchema: { type: "object", properties: { id: { type: "string" }, reverted: { type: "string" }, fields: { type: "array" }, next: { const: "history.list" } } },
    run: withAgent("Reverting a change", async ({ change }) => {
      if (!journalOf().changeById(change)) throw new DOMException("There is no such change", "DataError")
      return { ...await revertChange(change), next: "history.list" }
    }),
  }, ac.signal).catch(console.error)
  if (restore) registerStepTool<{ block: string; version: string; reason?: string }, unknown>({
    name: "history.restore", title: "Restore this version",
    description: "Brings a private block back to one of its earlier versions. History is kept: the restore is a new change, marked as the agent's, with the reason given, which the person can revert. Returns the block id and the version restored.",
    inputSchema: {
      type: "object",
      properties: { block: { type: "string", maxLength: 64 }, version: { type: "string", pattern: "^v[0-9a-f]{8}$" }, reason: { type: "string", maxLength: 200 } },
      required: ["block", "version"], additionalProperties: false,
    },
    outputSchema: { type: "object", properties: { id: { type: "string" }, version: { type: "string" }, next: { const: "history.versions" } } },
    run: withAgent("Restoring a version", async ({ block: id, version, reason }) => {
      const mine = journalOf().linesFor(id)
      if (!mine.some(c => c.after === version)) throw new DOMException("That version is not one of this block's", "DataError")
      if (version === journalOf().currentVersion(id)) throw new DOMException("That is the current version", "DataError")
      return { ...await restoreVersion(id, version, reason), next: "history.versions" }
    }),
  }, ac.signal).catch(console.error)
  return ac
}
function useChangeTools() {
  const { agentsAllowed, offered } = useWorkspace()
  const revert = agentsAllowed && offered["history.revert"], restore = agentsAllowed && offered["history.restore"]
  const key = `${revert}|${restore}`
  useEffect(() => {
    changeTools.users++
    if (changeTools.key !== key) { changeTools.ac?.abort(); changeTools.ac = null; changeTools.key = key }
    if (!changeTools.ac && (revert || restore)) changeTools.ac = registerChangeTools(revert, restore)
    return () => {
      changeTools.users--
      if (!changeTools.users) { changeTools.ac?.abort(); changeTools = { users: 0, ac: null, key: "" } }
    }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
}

// ─── A block's versions ──────────────────────────────────────────────────────────

/** A block's own lines, newest first: its changes, and saves between. */
function linesForBlock(id: string): Line[] {
  const changes = journalOf().linesFor(id)
  const from = changes[0] ? Date.parse(changes[0].at) : Infinity
  const saves = journalOf().historyLines(changes[0]?.owner).filter(l => l.type === "save" && Date.parse(l.at) >= from)
  return [...changes, ...saves].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
}

function PageVersions({ doc, focus, onRestored }: { doc: Doc; focus?: string; onRestored: () => void }) {
  const { rev, agentsAllowed, offered } = useWorkspace()
  const editable = doc.visibility === "private"
  const lines = useMemo(() => linesForBlock(doc.id), [doc.id, rev])
  const changes = lines.filter((l): l is ChangeLine => l.type === "change")
  const now = journalOf().currentVersion(doc.id)
  const [picked, setPicked] = useState<string | null>(focus ?? null)

  // This step's tool: read the versions. Revert and restore are shared with the home's history.
  useChangeTools()
  const offer = agentsAllowed && offered["history.versions"]
  useEffect(() => {
    if (!offer) return
    const ac = new AbortController()
    if (offered["history.versions"]) registerStepTool<Record<string, never>, unknown>({
      name: "history.versions", title: "Versions",
      description: "Lists the versions of the block open in the editor, newest first: each with its change id, version id, what was done, who did it (you, or an agent by name), when, and any reason. Returns them and the current version.",
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      outputSchema: { type: "object", properties: { current: { type: "string" }, versions: { type: "array" }, next: { const: "history.restore" } } },
      run: withAgent("Reading versions", async () => ({
        current: now,
        versions: changes.map(c => ({ change: c.id, version: c.after, did: VERB[c.op], by: c.actor, at: c.at, summary: c.summary, reason: c.reason })),
        next: "history.restore",
      })),
    }, ac.signal).catch(console.error)
    return () => ac.abort()
  }, [offer, doc.id, rev, editable]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-col gap-2">
      <p className="px-1 text-small text-muted-foreground">{changes.length} {changes.length === 1 ? "version" : "versions"} of <span className="text-foreground">{titleOf(doc)}</span></p>
      {lines.length ? <Timeline lines={lines} inPage picked={picked} setPicked={setPicked} onDone={onRestored} /> : <p className="px-1 text-small text-muted-foreground">No history yet.</p>}
    </div>
  )
}

/** The block toolbar's History: a card with the block's versions. */
export function HistoryButton({ doc, className }: { doc: Doc; className?: string }) {
  const { historyFocus } = useWorkspace()
  const [isOpen, setOpen] = useState(false)
  useEffect(() => { if (historyFocus?.id === doc.id) setOpen(true) }, [historyFocus?.n]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Popover open={isOpen} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button size="icon-sm" variant="ghost" aria-label="History" className={className} />}>
        <Icon icon={ClockIcon} size="sm" />
      </PopoverTrigger>
      <PopoverContent side="bottom" align="end" sideOffset={8} className="max-h-[min(680px,82vh)] w-[24rem] gap-0 overflow-y-auto p-2.5">
        <PageVersions key={`${doc.id}:${historyFocus?.n ?? 0}`} doc={doc}
          focus={historyFocus?.id === doc.id ? historyFocus.line : undefined} onRestored={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  )
}

// ─── The home's history ───────────────────────────────────────────────────

type Who = "all" | "human" | "agent"
/** The three tabs: the day-by-day autosaves, what you did, what agents did. */
type Tab = "dates" | "you" | "agents"

/** One tab's lines: yours (changes and saves), or agents' (sessions, with the changes they made inside). */
function topLevel(who: "human" | "agent"): Line[] {
  const grouped = new Set(journalOf().historyLines("cortex").flatMap(l => (l.type === "session" ? l.changes : [])))
  return [...journalOf().historyLines()].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .filter(l => l.actor.kind === who && !(l.type === "change" && grouped.has(l.id)))
}

/** An entry as a tool returns it. */
function asTool(l: Line) {
  switch (l.type) {
    case "change": return { type: "change", change: l.id, did: VERB[l.op], owner: l.owner, block: l.node, title: nodeTitle(l.node), version: l.after, summary: l.summary, reason: l.reason, at: l.at, by: l.actor }
    case "session": return { type: "session", session: l.id, done: l.done, changes: l.changes, deadEnds: l.deadEnds, at: l.at, by: l.actor }
    case "save": return { type: "save", name: l.name, note: l.note, at: l.at, by: l.actor }
  }
}

export function RepoHistory() {
  const { rev, agentsAllowed, offered } = useWorkspace()
  const [tab, setTab] = useState<Tab>("dates")
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState("")
  const [picked, setPicked] = useState<string | null>(null)
  const lines = useMemo(() => (tab === "dates" ? [] : topLevel(tab === "you" ? "human" : "agent")), [rev, tab])
  const save = (n: string, note?: string) => {
    const out = saveNow(n, note)
    notify({ message: `Saved “${out.name}”`, tone: "info" })
    setSaving(false); setName("")
    return out
  }

  // This step's tools: read history, save, and (for agents) finish a task. Revert and restore are
  // shared with a block's versions.
  useChangeTools()
  const offer = agentsAllowed && ["history.list", "history.save", "history.session"].some(n => offered[n as keyof typeof offered])
  useEffect(() => {
    if (!offer) return
    const ac = new AbortController()
    if (offered["history.list"]) registerStepTool<{ who?: Who; node?: string; since?: string; limit?: number }, unknown>({
      name: "history.list", title: "History",
      description: "Lists the home's history, newest first: changes (what was done, to which block, by whom, why), agents' sessions with the changes they made and their dead ends, and saves. Filter by who, block id or a since date. Returns the lines and the dead ends a new task should not retry.",
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      inputSchema: {
        type: "object",
        properties: { who: { enum: ["all", "human", "agent"], default: "all" }, node: { type: "string", maxLength: 64 }, since: { type: "string", format: "date" }, limit: { type: "integer", minimum: 1, maximum: 100, default: 30 } },
        additionalProperties: false,
      },
      outputSchema: { type: "object", properties: { lines: { type: "array" }, deadEnds: { type: "array" }, next: { const: "history.session" } } },
      run: withAgent("Reading history", async ({ who: w = "all", node, since, limit = 30 }) => ({
        lines: [...journalOf().historyLines()].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
          .filter(l => (w === "all" || l.actor.kind === w) && (!node || ("node" in l && l.node === node)) && (!since || l.at >= since))
          .slice(0, limit).map(asTool),
        deadEnds: journalOf().historyLines("cortex").filter((l): l is SessionLine => l.type === "session").flatMap(s => s.deadEnds.map(d => ({ ...d, by: s.actor.name, at: s.at }))),
        next: "history.session",
      })),
    }, ac.signal).catch(console.error)
    if (offered["history.session"]) registerStepTool<{ done: string; deadEnds?: DeadEnd[] }, unknown>({
      name: "history.session", title: "Finish task",
      description: "Records that the agent finished a task: one line of what it did, and its dead ends (what it tried and dropped, why, and how to recheck), so a later agent does not retry them. Groups the changes it made since its last session. Changes no block. Returns the session.",
      inputSchema: {
        type: "object",
        properties: {
          done: { type: "string", minLength: 1, maxLength: 200 },
          deadEnds: { type: "array", maxItems: 10, items: { type: "object", properties: { tried: { type: "string", maxLength: 200 }, why: { type: "string", maxLength: 300 }, recheck: { type: "string", maxLength: 200 } }, required: ["tried", "why"], additionalProperties: false } },
        },
        required: ["done"], additionalProperties: false,
      },
      outputSchema: { type: "object", properties: { session: { type: "string" }, changes: { type: "integer" }, deadEnds: { type: "integer" }, next: { const: "history.list" } } },
      run: withAgent("Finishing a task", async ({ done, deadEnds }) => ({ ...finishSession(done, deadEnds), next: "history.list" })),
    }, ac.signal).catch(console.error)
    if (offered["history.save"]) registerStepTool<{ name: string; note?: string }, unknown>({
      name: "history.save", title: "Save",
      description: "Names the home as it is now, so it can be found and compared later. It changes no block. Returns the save's name and its place in the history.",
      inputSchema: { type: "object", properties: { name: { type: "string", minLength: 1, maxLength: 80 }, note: { type: "string", maxLength: 300 } }, required: ["name"], additionalProperties: false },
      outputSchema: { type: "object", properties: { name: { type: "string" }, seq: { type: "integer" }, next: { const: "history.list" } } },
      run: withAgent("Saving", async ({ name: n, note }) => ({ ...save(n, note), next: "history.list" })),
    }, ac.signal).catch(console.error)
    return () => ac.abort()
  }, [offer, ...["history.list", "history.save", "history.session"].map(n => offered[n as keyof typeof offered])]) // eslint-disable-line react-hooks/exhaustive-deps

  const pills = (items: readonly (readonly [string, string])[], value: string, set: (v: never) => void, label: string) => (
    <div role="radiogroup" aria-label={label} className="flex items-center gap-0.5 rounded-full bg-muted p-0.5">
      {items.map(([id, text]) => (
        <button key={id} type="button" role="radio" aria-checked={value === id} onClick={() => set(id as never)}
          className="h-6 rounded-full px-2.5 text-small text-muted-foreground transition-colors duration-(--ohm-duration-state) aria-checked:bg-background aria-checked:text-foreground">{text}</button>
      ))}
    </div>
  )

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        {pills([["dates", "Dates"], ["you", "You"], ["agents", "Agents"]], tab, setTab, "History")}
        {!saving && <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-muted-foreground" onClick={() => setSaving(true)}><Icon icon={FlagIcon} size="sm" /> Save</Button>}
      </div>
      {saving && (
        <form className="flex items-center gap-1.5 rounded-lg bg-muted/60 p-1 animate-in fade-in-0" onSubmit={e => { e.preventDefault(); if (name.trim()) save(name) }}>
          <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Name this point" aria-label="Save name"
            onKeyDown={e => { if (e.key === "Escape") { setSaving(false); setName("") } }}
            className="h-7 min-w-0 flex-1 bg-transparent px-1.5 text-body outline-none placeholder:text-muted-foreground" />
          <Button type="submit" size="sm" className="h-7" disabled={!name.trim()}>Save</Button>
        </form>
      )}
      {tab === "dates" ? <DaysLayer /> : <>
        {lines.length
          ? <Timeline lines={lines} picked={picked} setPicked={setPicked} onDone={() => setPicked(null)} />
          : <p className="px-2 py-6 text-center text-small text-muted-foreground">Nothing by {tab === "agents" ? "agents" : "you"} yet.</p>}
      </>}
    </div>
  )
}

/** Opens a block with its history card on one line. */
export function openVersion(id: string, line: string) {
  open(id)
  focusHistory(id, line)
}
