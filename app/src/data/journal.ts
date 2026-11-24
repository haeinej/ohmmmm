// In-memory sample histories. The vault owns block changes. Cortex owns its file changes and
// agent sessions. The home timeline can read both. An undo is another change in the same history.
//
//
// You and agents both edit directly. Every change says who made it, so an agent's edits are marked
// as its versions, and you revert what you don't want. When an agent finishes a task it writes a
// session: what it did, the changes it made, and its dead ends, as ANVC (github.com/yodering/anvc)
// keeps abandoned attempts so a later agent does not retry them.
import { blockKey, isBlock, type Connection, type Doc, type Kind } from "./workspace-model"

export type Actor = { kind: "human" | "agent"; name: string }
export const YOU: Actor = { kind: "human", name: "you" }

/** What a block's version holds: everything a change can touch. */
export type Snapshot = { title: string; body: string; kind: Kind; homeChannel?: string; channels?: string[]; connect?: Connection[] }
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
/** A change the vault's journal holds from before the workspace read the home, as a history line takes it. */
export type PastChange = { at: string; node: string; actor: Actor; op?: ChangeOp; before?: Snapshot; after: Snapshot }

export const snap = (d: Doc): Snapshot => ({
  title: d.title, body: d.body, kind: d.kind, homeChannel: d.homeChannel,
  channels: d.channels ? [...d.channels] : undefined, connect: d.connect?.map(c => ({ ...c })),
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

// ─── Seed: a few days of history, by you and two agents ─────────────────────────

/**
 * The workspace's history of its blocks. The sample seeds a few days of it (`fixtureIds`). A home
 * read from disk starts with the vault journal's changes (`past`), and with each block as it is
 * (`baseline`): what changes now is compared with how the block was when it was read.
 */
export function createJournal(all: Doc[], fixtureIds?: Record<"slow" | "monday" | "reading" | "captions" | "privateFirst" | "slowness" | "tokyo" | "dusk", string>, { baseline = false, past = [] }: { baseline?: boolean; past?: readonly PastChange[] } = {}) {
  const byId = (id: string) => all.find(doc => doc.id === id)
  const journals: Record<HistoryOwner, Line[]> = { vault: [], cortex: [] }
  const historyLines = (owner?: HistoryOwner): readonly Line[] =>
    owner ? journals[owner] : [...journals.vault, ...journals.cortex].sort((a, b) => a.seq - b.seq)
  /** Every version of every block, by version hash. */
  const versions = new Map<string, Snapshot>()

  let seq = 0
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
  // How each block was when the home was read; it gives way to the first change made since.
  const bases = new Map<string, string>()
  const currentVersion = (node: string) => bases.get(node) ?? linesFor(node).at(-1)?.after
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
    return { fields, summary: parts.join(" · ") || "No change" }
  }
  function opOf(before: Snapshot | undefined, after: Snapshot): ChangeOp {
    if (!before) return "create"
    const touched = (k: keyof Snapshot) => JSON.stringify(before[k]) !== JSON.stringify(after[k])
    if (touched("title") || touched("body")) return "edit"
    if (touched("homeChannel")) return "move"
    if (touched("channels")) return "channels"
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
    // A change since the home was read never joins a line from the vault's journal.
    const joins = last && !bases.has(doc.id) && op === "edit" && last.op === "edit" && last.actor.kind === who.kind && last.actor.name === who.name
      && journals[owner].at(-1) === last && at.getTime() - Date.parse(last.at) < 5 * 60_000 && !opts.reason
    bases.delete(doc.id)
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
    for (const p of all) {
      const s = snap(p)
      const held = currentVersion(p.id)
      if (held === versionOf(s)) continue
      recordChange(p, next?.op ?? opOf(held ? versions.get(held) : undefined, s), { reason: next?.reason })
    }
    const here = new Set(all.map(p => p.id))
    for (const node of new Set(historyLines().flatMap(l => (l.type === "change" ? [l.node] : [])))) {
      const last = linesFor(node).at(-1)!
      if (here.has(node) || last.op === "remove") continue
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

  const day = (d: string, t = "10:00") => new Date(`${d}T${t}:00`)
  function seed(ids: NonNullable<typeof fixtureIds>) {
    const claude: Actor = { kind: "agent", name: "Claude Code" }
    const muse: Actor = { kind: "agent", name: "Muse" }
    const current = new Map(all.map(p => [p.id, snap(p)]))
    const doc = (id: string) => byId(id)!
    const edit = (id: string, s: Snapshot, op: ChangeOp, by: Actor, at: Date, reason?: string) => { applySnapshot(doc(id), s); recordChange(doc(id), op, { by, at, reason }) }

    // Every block and cortex item starts as it is now, made by you on its date, except two with earlier versions.
    for (const p of all) if (p.id !== ids.monday && p.id !== ids.slow) recordChange(p, "create", { at: day(p.updated, "09:00"), by: YOU })

    const slowNow = current.get(ids.slow)!, mondayNow = current.get(ids.monday)!
    edit(ids.slow, { ...slowNow, body: "# Slow software\n\nTools that wait for you." }, "create", YOU, day("2026-10-18", "21:10"))
    edit(ids.slow, { ...slowNow, body: "# Slow software\n\nTools that wait for you. A draft that is private until you say otherwise." }, "edit", YOU, day("2026-10-20", "08:40"))
    edit(ids.slow, slowNow, "edit", muse, day("2026-10-21", "11:02"), "Linked the two blocks you said say the same thing")
    recordSession(muse, "Linked Slow software to the blocks it echoes", [
      { tried: "Filing Slow software under projects", why: "You keep essays in writing, and moved it back the last time" },
    ], day("2026-10-21", "11:05"))

    edit(ids.monday, { ...mondayNow, body: "# Monday, rain\n\nNothing shipped.", channels: undefined }, "create", YOU, day("2026-11-10", "22:15"))
    save("Before the slowness channel", "Everything as it was before I started collecting slowness", day("2026-11-10", "23:00"))
    edit(ids.monday, { ...mondayNow, body: "# Monday, rain\n\nNothing shipped. Read for an hour.", channels: undefined }, "edit", claude, day("2026-11-11", "07:30"), "Added the line you dictated")
    recordSession(claude, "Added the line you dictated to Monday, rain", [
      { tried: "Turning the entry into a checklist", why: "You said journal entries stay as prose", recheck: "Read your profile's preferences" },
    ], day("2026-11-11", "07:32"))
    edit(ids.monday, mondayNow, "edit", YOU, day("2026-11-11", "08:05"))

    // Recent agent edits, marked as theirs: a cortex item and a connection. Revert either if you don't want it.
    const captions = current.get(ids.captions)!
    edit(ids.captions, { ...captions, body: "# Photo captions are one line\n\nSeen in two sessions, project photos. Three recent photo posts used two lines: one for the place, one for the light." },
      "edit", claude, day("2026-11-18", "18:20"), "Your last three photo captions used two lines")
    recordSession(claude, "Checked the caption observation against recent photos", [], day("2026-11-18", "18:21"))
    const reading = current.get(ids.reading)!
    edit(ids.reading, { ...reading, connect: [{ to: "garden-of-notes", why: "A pattern language is where the garden idea started" }] }, "connect", muse, day("2026-11-19", "09:10"), "Your garden essay quotes the first book on this list")
    recordSession(muse, "Looked for blocks that belong together", [
      { tried: "Connecting Reading list to Tokyo walks, day one", why: "Nothing on the list is about the walks" },
    ], day("2026-11-19", "09:12"))
  }
  for (const change of past) {
    const before = change.before && versionOf(change.before)
    if (change.before) versions.set(before!, change.before)
    const after = versionOf(change.after)
    versions.set(after, change.after)
    const op = change.op ?? opOf(change.before, change.after)
    push<ChangeLine>({
      owner: "vault", at: change.at, actor: change.actor, type: "change", node: change.node, op,
      ...(before ? { before } : {}), after, ...describe(change.before, change.after, op),
      ...(op === "remove" ? { summary: "Removed it", fields: [] } : {}),
    })
  }
  if (baseline) {
    for (const doc of all) {
      const s = snap(doc)
      const version = versionOf(s)
      versions.set(version, s)
      bases.set(doc.id, version)
    }
  }
  if (fixtureIds) {
    seed(fixtureIds)
    // An observation about blocks keeps the versions they had when it was written.
    for (const doc of all.filter(each => each.kind === "observation" && each.about?.some(item => !item.startsWith("channel:")))) {
      doc.evidence = doc.about!.filter(item => !item.startsWith("channel:")).map(id => ({ node: blockKey(id), version: currentVersion(id)! }))
    }
  }
  return { historyLines, actor, actingAs, changeById, linesFor, currentVersion, snapshotAt, syncJournal, recordSession, save }
}
