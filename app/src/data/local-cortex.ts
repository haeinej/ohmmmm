// Your cortex on this computer, through `ohmmmm serve` (docs/serve.md, home/cortex-routes.mjs). It is
// read once into the workspace's own part (`demo.cortex`) as Docs, the way the sample's are: the
// profile, each observation, each skill and each tool. What the person changes is written back
// through the bridge, one change at a time, only over the version read (If-Match); the cortex keeps
// what it replaces and journals the change as theirs. Nothing here writes to the vault.
//
// App IDs: `cortex-profile`, `observation-<id>`, `skill-<name>`, `tool-<name>`. None has a "/" or ":",
// which the tree's row IDs use. An observation's `about` stays as the cortex wrote it, block IDs and
// channel:<path>, so the graph's observed connections and a block's connections card find it.
import { bridgeFetch, type Bridge } from "./bridge"
import type { Actor, PastChange, PastSession, Snapshot } from "./journal"
import type { CortexWaiting, Doc } from "./workspace-model"

export type CortexParts = {
  profile: { account: string | null; text: string; version: string | null }
  proposals: { id: string; heading: string; line: string; by: string; quote?: string }[]
  observations: { id: string; text: string; by: string; at: string | null; about?: string[]; pin?: boolean; version: string }[]
  skills: { name: string; description: string; body: string; version: string }[]
  proposedSkills: { name: string; description: string; text: string; by: string | null }[]
  tools: { name: string; description: string; on: boolean; body: string; version: string }[]
  proposedTools: { name: string; description: string; by: string | null }[]
}
type Line = { seq: number; id: string; at: string; actor: { kind: "human" | "agent"; name: string }; node: string; op: string; before: string | null; after: string | null; reason?: string }
export type CortexJournal = {
  changes: Line[]
  sessions: { at: string; actor: { kind: "human" | "agent"; name: string }; summary: string; made: string[]; deadEnds: { tried: string; why: string; check?: string }[] }[]
  texts: Record<string, string | null>
}

export const PROFILE_ID = "cortex-profile"
/** The app's ID for a cortex node, as the cortex's journal names it. */
export function cortexId(node: string) {
  if (node === "profile") return PROFILE_ID
  const found = /^(observation|skill|tool)\/(.+)$/.exec(node)
  return found ? `${found[1]}-${found[2]}` : undefined
}
const nodeFor = (doc: Doc) => doc.kind === "profile" ? "profile" : `${doc.kind}/${doc.id.slice(doc.kind.length + 1)}`

/** The body under a cortex file's properties. */
export const bodyOf = (text: string) => text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim()
/** An observation's title: its first line, without Markdown's marks, at most 80 characters. */
export function observationTitle(text: string) {
  const first = text.trim().split("\n")[0].replace(/^\s*(#+|[-*]|\d+\.)\s+/, "").trim()
  return first.length > 80 ? `${first.slice(0, 79)}…` : first || "Observation"
}
const day = (at?: string | null) => (at ?? new Date().toISOString()).slice(0, 10)
const actorOf = (actor: Line["actor"]): Actor => actor.kind === "human" ? { kind: "human", name: "you" } : { kind: "agent", name: actor.name }

/** The cortex's parts as the workspace's Docs. */
export function cortexDocs(parts: CortexParts): Doc[] {
  const base = { visibility: "private" as const }
  return [
    { ...base, id: PROFILE_ID, kind: "profile", title: "Profile", slug: PROFILE_ID, updated: day(), body: parts.profile.text },
    ...parts.observations.map((each): Doc => ({
      ...base, id: `observation-${each.id}`, kind: "observation", slug: `observation-${each.id}`, title: observationTitle(each.text), body: each.text, by: each.by,
      updated: day(each.at), ...(each.about?.length ? { about: [...each.about] } : {}), ...(each.pin ? { pin: true } : {}),
    })),
    ...parts.skills.map((each): Doc => ({ ...base, id: `skill-${each.name}`, kind: "skill", slug: `skill-${each.name}`, title: each.name, description: each.description, body: each.body.trim(), updated: day() })),
    ...parts.tools.map((each): Doc => ({ ...base, id: `tool-${each.name}`, kind: "tool", slug: `tool-${each.name}`, title: each.name, description: each.description, on: each.on, body: each.body.trim(), updated: day() })),
  ]
}

/** What waits for the person, from the parts. */
export const waitingOf = (parts: CortexParts): CortexWaiting => ({
  profile: parts.proposals.map(({ id, heading, line, by, quote }) => ({ id, heading, line, by, ...(quote ? { quote } : {}) })),
  skills: parts.proposedSkills.map(({ name, description, text, by }) => ({ name, description, text, by })),
  tools: parts.proposedTools.map(({ name, description, by }) => ({ name, description, by })),
})

/**
 * The cortex journal's changes and sessions as history lines: each change on the Doc it names, with
 * the versions before and after read from the texts the bridge sent. A version no longer kept is left out.
 */
export function cortexPast(journal: CortexJournal): { past: PastChange[]; sessions: PastSession[] } {
  const snapOf = (node: string, text: string | null | undefined): Snapshot | undefined => {
    if (typeof text !== "string") return undefined
    const kind = node.split("/")[0] as Doc["kind"]
    const body = bodyOf(text)
    const title = node === "profile" ? "Profile" : kind === "observation" ? observationTitle(body) : node.split("/")[1]
    const head = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? ""
    return { title, body, kind, ...(/^pin:\s*true\s*$/m.test(head) ? { pin: true } : {}), ...(kind === "tool" ? { on: /^on:\s*true\s*$/m.test(head) } : {}) }
  }
  const past: PastChange[] = []
  for (const line of journal.changes) {
    const node = cortexId(line.node)
    if (!node) continue
    const before = line.before ? snapOf(line.node, journal.texts[line.before]) : undefined
    const after = line.after ? snapOf(line.node, journal.texts[line.after]) : before
    if (!after) continue
    // A change to what the app does not show, such as the profile's account, is not a line here.
    if (before && line.op !== "remove" && JSON.stringify(before) === JSON.stringify(after)) continue
    const op = line.op === "remove" ? "remove" : line.op === "restore" ? "restore" : line.op === "create" ? "create" : undefined
    past.push({ at: line.at, node, actor: actorOf(line.actor), owner: "cortex", ref: line.id, ...(op ? { op } : {}), ...(before ? { before } : {}), after, ...(line.reason ? { reason: line.reason } : {}) })
  }
  const sessions = journal.sessions.map((each): PastSession => ({
    at: each.at, actor: actorOf(each.actor), done: each.summary, changes: each.made,
    deadEnds: each.deadEnds.map(({ tried, why, check }) => ({ tried, why, ...(check ? { recheck: check } : {}) })),
  }))
  return { past, sessions }
}

type Held = { version: string | null; sent: string }
/** What of a Doc is written back for its kind, to compare with what was last sent. */
const written = (doc: Doc) => JSON.stringify(
  doc.kind === "observation" ? { text: doc.body.trim(), about: doc.about ?? [], pin: !!doc.pin }
    : doc.kind === "tool" ? { body: doc.body.trim(), on: !!doc.on } : { body: doc.body.trim() },
)

export type CortexOptions = {
  bridge: Bridge
  /** The source's write queue: work for one key runs after everything before it, and stops that key on a refusal. */
  later: (key: string, work: () => Promise<void>) => void
  failed: (response: Response) => Promise<Error>
  /** Who is acting now: the person, or an agent in the page whose change they approved. */
  actor: () => Actor
}

/**
 * The cortex's working copy: its Docs (the array the workspace shows), and the operations that write
 * them back. `docs` is changed in place, so the workspace reads it as it is.
 */
export function createLocalCortex(parts: CortexParts | undefined, { bridge, later, failed, actor }: CortexOptions) {
  const docs: Doc[] = parts ? cortexDocs(parts) : []
  const held = new Map<string, Held>()
  const versionAt = (doc: Doc) => doc.kind === "profile" ? parts?.profile.version ?? null
    : doc.kind === "observation" ? parts?.observations.find(each => `observation-${each.id}` === doc.id)?.version ?? null
      : doc.kind === "skill" ? parts?.skills.find(each => `skill-${each.name}` === doc.id)?.version ?? null
        : parts?.tools.find(each => `tool-${each.name}` === doc.id)?.version ?? null
  for (const doc of docs) held.set(doc.id, { version: versionAt(doc), sent: written(doc) })
  let waiting: CortexWaiting = parts ? waitingOf(parts) : { profile: [], skills: [], tools: [] }

  const call = async (path: string, init: RequestInit & { version?: string | null }) => {
    const { version, ...rest } = init
    const response = await bridgeFetch(path, {
      ...rest, headers: { ...rest.headers, ...(version === undefined ? {} : version ? { "If-Match": `"${version}"` } : { "If-None-Match": "*" }) },
    }, bridge)
    if (!response.ok) throw await failed(response)
    return response.json() as Promise<{ version?: string | null }>
  }
  const json = (value: unknown) => ({ body: JSON.stringify(value), headers: { "Content-Type": "application/json" } })
  const name = (doc: Doc) => encodeURIComponent(doc.id.slice(doc.kind.length + 1))

  // One Doc written back: what it is now, over the version last read or written.
  const writeBack = (doc: Doc, asked?: { agent: string; why?: string }) => later(`cortex:${doc.id}`, async () => {
    const state = held.get(doc.id)
    const now = written(doc)
    if (state && state.sent === now) return
    const version = state?.version ?? null
    let done: { version?: string | null }
    if (doc.kind === "profile") done = await call("/cortex/profile", { method: "PUT", body: doc.body.trim(), headers: { "Content-Type": "text/markdown" }, version })
    else if (doc.kind === "observation") {
      const { body, headers } = json({ text: doc.body.trim(), ...(doc.about?.length || state ? { about: doc.about ?? [] } : {}), ...(asked ? { agent: asked.agent, ...(asked.why ? { why: asked.why } : {}) } : { pin: !!doc.pin }) })
      done = await call(`/cortex/observation?id=${name(doc)}`, { method: "PUT", body, headers, version })
    } else if (doc.kind === "skill") done = await call(`/cortex/skill?name=${name(doc)}`, { method: "PUT", body: doc.body.trim(), headers: { "Content-Type": "text/markdown" }, version })
    else {
      const { body, headers } = json({ body: doc.body.trim(), on: !!doc.on })
      done = await call(`/cortex/tool?name=${name(doc)}`, { method: "PUT", body, headers, version })
    }
    held.set(doc.id, { version: done.version ?? version, sent: now })
  })

  return {
    docs,
    /** Whether anything is not on disk yet; a change the home refused (`stopped`) is not waiting. */
    unsent: (stopped: (key: string) => boolean = () => false) => docs.some(doc => held.get(doc.id)?.sent !== written(doc) && !stopped(`cortex:${doc.id}`)),
    /** Takes a change the store made (a copy of the Doc), and writes it back. A new Doc is an observation; `why` is an agent's reason. */
    save(doc: Doc, why?: string) {
      const there = docs.find(each => each.id === doc.id)
      if (there) {
        if (doc.kind === "observation") doc.title = observationTitle(doc.body)
        Object.assign(there, doc)
        writeBack(there)
        return there
      }
      if (doc.kind !== "observation" || !/^observation-[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(doc.id)) throw new DOMException("Only an observation is new in the cortex here. Skills and tools are proposed by agents, and approved in Settings › Cortex.", "DataError")
      const made: Doc = { ...doc, title: observationTitle(doc.body), by: "you" }
      const who = actor()
      if (who.kind === "agent") made.by = who.name
      docs.push(made)
      writeBack(made, who.kind === "agent" ? { agent: who.name.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 64) || "agent", why } : undefined)
      return made
    },
    /** Forgets an observation, or removes a skill. The cortex keeps what it removes. */
    remove(id: string) {
      const doc = docs.find(each => each.id === id)
      if (!doc) return
      if (doc.kind !== "observation" && doc.kind !== "skill") throw new DOMException("Only an observation or a skill is removed here.", "DataError")
      docs.splice(docs.indexOf(doc), 1)
      later(`cortex:${doc.id}`, async () => {
        const version = held.get(doc.id)?.version
        if (!version) return
        await call(`/cortex/${doc.kind}?${doc.kind === "observation" ? "id" : "name"}=${name(doc)}`, { method: "DELETE", version })
        held.delete(doc.id)
      })
    },
    waiting: () => waiting,
    /**
     * The person's answer to what an agent proposed: a profile line accepted or declined, a skill
     * approved or declined. The cortex is read again after, so the profile and skills are as it left them.
     */
    async answer(kind: "profile" | "skill", id: string, yes: boolean, settled: () => Promise<void>) {
      await settled()
      if (kind === "profile") await call(`/cortex/profile/${encodeURIComponent(id)}`, { method: "POST", ...json({ accept: yes }) })
      else await call(`/cortex/skills/${encodeURIComponent(id)}`, { method: "POST", ...json({ approve: yes }) })
      const response = await bridgeFetch("/cortex/parts", {}, bridge)
      if (!response.ok) throw await failed(response)
      const next = await response.json() as CortexParts
      waiting = waitingOf(next)
      // What the answer changed is taken as it is on disk; nothing else was waiting to be written.
      for (const fresh of cortexDocs(next)) {
        const there = docs.find(each => each.id === fresh.id)
        const version = fresh.kind === "profile" ? next.profile.version : fresh.kind === "skill" ? next.skills.find(each => `skill-${each.name}` === fresh.id)!.version : undefined
        if (version === undefined) continue
        if (there && held.get(there.id)?.version === version) continue
        if (there) Object.assign(there, { body: fresh.body, description: fresh.description, updated: fresh.updated })
        else docs.push(fresh)
        held.set(fresh.id, { version, sent: written(there ?? fresh) })
      }
    },
    nodeFor,
  }
}

export type LocalCortex = ReturnType<typeof createLocalCortex>
