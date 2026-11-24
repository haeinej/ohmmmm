// The home's timeline. The vault owns block changes. Cortex owns its file changes and agent
// sessions; the sealed cortex journal brings them in (`HomeSource.cortex.journal`), and this
// device adds the changes made here. An undo is another change in the same history.
//
//
// You and agents both edit directly. Every change says who made it, so an agent's edits are marked
// as its versions, and you revert what you don't want. When an agent finishes a task it writes a
// session: what it did, the changes it made, and its dead ends, as ANVC (github.com/yodering/anvc)
// keeps abandoned attempts so a later agent does not retry them.
import { isBlock, type Connection, type Doc, type Kind } from "./workspace-model"

export type Actor = { kind: "human" | "agent"; name: string }
export const YOU: Actor = { kind: "human", name: "you" }

/** What a block's version holds: everything a change can touch. */
export type Snapshot = { title: string; body: string; kind: Kind; homeChannel?: string; channels?: string[]; connect?: Connection[]; pin?: boolean; on?: boolean }
export type ChangeOp = "create" | "edit" | "move" | "channels" | "connect" | "restore" | "revert" | "remove"
export type DeadEnd = { tried: string; why: string; recheck?: string }

export type HistoryOwner = "vault" | "cortex"
type Common = { owner: HistoryOwner; seq: number; id: string; at: string; actor: Actor }
/** A change: what was done, to which block, by whom, with the versions before and after. */
export type ChangeLine = Common & { type: "change"; node: string; op: ChangeOp; fields: string[]; before?: string; after: string; reason?: string; summary: string }
/** What an agent did in one task, written when it finished: the changes it made, and its dead ends. */
export type SessionLine = Common & { type: "session"; done: string; changes: string[]; deadEnds: DeadEnd[] }
/** A named point in history. It changes nothing. */
export type SaveLine = Common & { type: "save"; name: string; note?: string }
export type Line = ChangeLine | SessionLine | SaveLine

export const snap = (d: Doc): Snapshot => ({
  title: d.title, body: d.body, kind: d.kind, homeChannel: d.homeChannel,
  channels: d.channels ? [...d.channels] : undefined, connect: d.connect?.map(c => ({ ...c })),
  // A cortex part's switches: an observation pinned, a tool on.
  ...(d.pin ? { pin: true } : {}), ...(d.kind === "tool" ? { on: !!d.on } : {}),
})
/** A short content hash: the same content is the same version everywhere. */
export function versionOf(s: Snapshot) {
  let h = 0x811c9dc5
  for (const ch of JSON.stringify(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) }
  return `v${(h >>> 0).toString(16).padStart(8, "0")}`
}
export function applySnapshot(doc: Doc, s: Snapshot) {
  doc.title = s.title
  doc.body = s.body
  doc.kind = s.kind
  doc.homeChannel = s.homeChannel
  doc.channels = s.channels ? [...s.channels] : undefined
  doc.connect = s.connect?.map(c => ({ ...c }))
  if (s.pin) doc.pin = true; else delete doc.pin
  if (s.on !== undefined) doc.on = s.on
}

/** A word-level difference, for showing what a change did to the text. */
export type DiffPart = { kind: "same" | "added" | "removed"; text: string }
export function diffWords(a: string, b: string): DiffPart[] {
  const x = a.split(/(\s+)/), y = b.split(/(\s+)/)
  const n = x.length, m = y.length
  const lcs = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i][j] = x[i] === y[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
  const out: DiffPart[] = []
  const add = (kind: DiffPart["kind"], text: string) => { const l = out.at(-1); if (l?.kind === kind) l.text += text; else out.push({ kind, text }) }
  let i = 0, j = 0
  while (i < n && j < m) {
    if (x[i] === y[j]) { add("same", x[i]); i++; j++ }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) add("removed", x[i++])
    else add("added", y[j++])
  }
  while (i < n) add("removed", x[i++])
  while (j < m) add("added", y[j++])
  return out
}

// ─── The journal ─────────────────────────

/** A journal entry as the cortex journal keeps it: one line, and the versions it names. */
export type JournalEntry = { line: Line; snapshots?: Record<string, Snapshot> }
export const isJournalEntry = (value: unknown): value is JournalEntry => {
  const line = (value as JournalEntry | null)?.line
  return !!line && typeof line === "object" && ["change", "session", "save"].includes(line.type)
    && (line.owner === "vault" || line.owner === "cortex") && typeof line.at === "string"
}

export function createJournal(nodes: Doc[] | (() => Doc[]), kept: readonly JournalEntry[] = []) {
  const docs = typeof nodes === "function" ? nodes : () => nodes
  const journals: Record<HistoryOwner, Line[]> = { vault: [], cortex: [] }
  const historyLines = (owner?: HistoryOwner): readonly Line[] =>
    owner ? journals[owner] : [...journals.vault, ...journals.cortex].sort((a, b) => a.seq - b.seq)
  /** Every version of every block, by version hash. */
  const versions = new Map<string, Snapshot>()

  let seq = 0
  const baseline = new Map<string, string>()
  /** Every node this device has held while this journal was open. */
  const held = new Set<string>()
  const lineId = () => `${Date.now().toString(36)}-${(++seq).toString(36)}`
  function push<L extends Line>(line: Omit<L, "seq" | "id">): L {
    const full = { ...line, seq: seq + 1, id: lineId() } as L
    journals[line.owner].push(full)
    return full
  }

  /** Who is acting now: you, unless an agent's tool is running (workspace/tools.ts withAgent). */
  let acting: Actor = YOU
  const actor = () => acting
  async function actingAs<T>(who: Actor, fn: () => Promise<T>): Promise<T> {
    const was = acting
    acting = who
    try { return await fn() } finally { acting = was }
  }

  const changeById = (id: string) => historyLines().find((l): l is ChangeLine => l.type === "change" && l.id === id)
  const linesFor = (node: string) => historyLines().filter((l): l is ChangeLine => l.type === "change" && l.node === node)
  // What a node is now: its last line made on this device, else what it held when this journal
  // opened. A line the journal brought in is history, not now: the file may have changed since,
  // on another device, and that is not a change by whoever acts here next.
  const currentVersion = (node: string): string | undefined => {
    const last = linesFor(node).at(-1)
    return last && last.seq > openedAt ? last.after : baseline.get(node) ?? last?.after
  }
  const snapshotAt = (version: string) => versions.get(version)

  const words = (s: string) => s.split(/\s+/).filter(Boolean).length
  /** What changed between two snapshots, as fields and one plain line. */
  function describe(before: Snapshot | undefined, after: Snapshot, op: ChangeOp): { fields: string[]; summary: string } {
    if (!before) return { fields: ["title", "body"], summary: "Made it" }
    const fields = (Object.keys(after) as (keyof Snapshot)[]).filter(k => JSON.stringify(before[k]) !== JSON.stringify(after[k]))
    if (op === "restore") return { fields, summary: "Restored an earlier version" }
    if (op === "revert") return { fields, summary: "Reverted a change" }
    const parts: string[] = []
    if (fields.includes("title")) parts.push(`Renamed to “${after.title || "Untitled"}”`)
    if (fields.includes("body")) {
      const d = words(after.body) - words(before.body)
      parts.push(`Edited the text${d ? ` (${d > 0 ? "+" : "−"}${Math.abs(d)} ${Math.abs(d) === 1 ? "word" : "words"})` : ""}`)
    }
    if (fields.includes("homeChannel")) parts.push(`Moved to ${after.homeChannel?.replaceAll("/", " › ")}`)
    if (fields.includes("channels")) parts.push("Changed its channels")
    if (fields.includes("connect")) parts.push("Changed its connections")
    if (fields.includes("pin")) parts.push(after.pin ? "Pinned it" : "Unpinned it")
    if (fields.includes("on")) parts.push(after.on ? "Switched it on" : "Switched it off")
    return { fields, summary: parts.join(" · ") || "No change" }
  }
  function opOf(before: Snapshot | undefined, after: Snapshot): ChangeOp {
    if (!before) return "create"
    const touched = (k: keyof Snapshot) => JSON.stringify(before[k]) !== JSON.stringify(after[k])
    if (touched("title") || touched("body")) return "edit"
    if (touched("homeChannel")) return "move"
    if (touched("channels")) return "channels"
    if (touched("pin") || touched("on")) return "edit"
    return "connect"
  }

  /**
   * Records a change: the one write path. Consecutive edits to the text by the same person or agent
   * within five minutes join one line, so typing makes one change, not one per keystroke.
   */
  function recordChange(doc: Doc, op: ChangeOp, opts: { reason?: string; at?: Date; by?: Actor } = {}) {
    const at = opts.at ?? new Date(), who = opts.by ?? acting
    const after = snap(doc)
    const version = versionOf(after)
    const before = currentVersion(doc.id)
    if (before === version) return null
    versions.set(version, after)
    const owner = isBlock(doc) ? "vault" : "cortex"
    const last = linesFor(doc.id).at(-1)
    const joins = last && op === "edit" && last.op === "edit" && last.actor.kind === who.kind && last.actor.name === who.name
      && journals[owner].at(-1) === last && at.getTime() - Date.parse(last.at) < 5 * 60_000 && !opts.reason
    if (joins) {
      Object.assign(last, { after: version, at: at.toISOString(), ...describe(last.before ? versions.get(last.before) : undefined, after, "edit") })
      return last
    }
    return push<ChangeLine>({
      owner, at: at.toISOString(), actor: who, type: "change", node: doc.id, op, before, after: version,
      ...(opts.reason ? { reason: opts.reason } : {}), ...describe(before ? versions.get(before) : undefined, after, op),
    })
  }

  /**
   * After any change to the home, every block that differs from its last version gets a change
   * line by whoever is acting, and every block that is gone gets a removal. `next` names the op and
   * reason for a change that has one, such as a restore.
   */
  function syncJournal(next?: { op: ChangeOp; reason?: string }) {
    const all = docs()
    for (const p of all) held.add(p.id)
    for (const p of all) {
      const s = snap(p)
      const held = currentVersion(p.id)
      if (held === versionOf(s)) continue
      recordChange(p, next?.op ?? opOf(held ? versions.get(held) : undefined, s), { reason: next?.reason })
    }
    const here = new Set(all.map(p => p.id))
    for (const node of new Set(historyLines().flatMap(l => (l.type === "change" ? [l.node] : [])))) {
      const last = linesFor(node).at(-1)!
      // Only what this device held can be seen to go: a node the journal names that never loaded
      // here (locked, or unreadable) is not removed by anyone.
      if (here.has(node) || last.op === "remove" || !held.has(node)) continue
      const { seq: _s, id: _i, reason: _r, ...rest } = last
      push<ChangeLine>({ ...rest, at: new Date().toISOString(), actor: acting, op: "remove", fields: [], before: last.after, summary: "Removed it" })
    }
  }

  /** An agent finishing a task: what it did, its changes since its last session, and its dead ends. */
  function recordSession(who: Actor, done: string, dead: DeadEnd[] = [], at = new Date()) {
    const lastAt = historyLines("cortex").filter((l): l is SessionLine => l.type === "session" && l.actor.name === who.name).at(-1)?.at ?? ""
    const changes = historyLines().filter(l => l.type === "change" && l.actor.name === who.name && l.at > lastAt && l.at <= at.toISOString()).map(l => l.id)
    return push<SessionLine>({ owner: "cortex", at: at.toISOString(), actor: who, type: "session", done: done.trim(), changes, deadEnds: dead })
  }

  /** Names this point in history. It changes nothing. */
  function save(name: string, note?: string, at = new Date()) {
    return push<SaveLine>({ owner: "vault", at: at.toISOString(), actor: acting, type: "save", name: name.trim(), ...(note?.trim() ? { note: note.trim() } : {}) })
  }

  // What the cortex journal already holds comes first, in its order, with the versions it names.
  for (const { line, snapshots } of kept) {
    for (const [version, snapshot] of Object.entries(snapshots ?? {})) versions.set(version, snapshot)
    journals[line.owner].push({ ...line, seq: ++seq } as Line)
  }
  const openedAt = seq
  // Every node here starts at its current version, so the first change made on this device has a before.
  for (const doc of docs()) {
    held.add(doc.id)
    baseline.set(doc.id, versionOf(snap(doc)))
    versions.set(versionOf(snap(doc)), snap(doc))
  }
  const entryOf = (line: Line): JournalEntry => ({
    line, snapshots: Object.fromEntries((line.type === "change" ? [line.before, line.after] : []).flatMap(version => {
      const held = version && versions.get(version)
      return held ? [[version, held]] : []
    })),
  })

  return { historyLines, actor, actingAs, changeById, linesFor, currentVersion, snapshotAt, syncJournal, recordSession, save, recordChange, entryOf }
}
