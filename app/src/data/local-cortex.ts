// Your cortex on this computer, through `ohm serve` (docs/serve.md, home/cortex-routes.mjs), as
// the workspace reads it: the bridge's parts as Docs (the profile, each observation, each skill and
// each tool), what waits for the person, and the cortex journal as history. The local source
// (local-source.ts) writes each change back through the same routes. Nothing here writes to the vault.
//
// App IDs: `cortex-profile`, `observation-<id>`, `skill-<name>`, `tool-<name>`. None has a "/" or ":",
// which the tree's row IDs use. An observation's `about` stays as the cortex wrote it, block IDs and
// channel:<path>, so the graph's observed connections and a block's connections card find it.
import type { Actor, Snapshot } from "./journal"
import type { PastChange, PastSession } from "./local-source"
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
    past.push({ at: line.at, node, actor: actorOf(line.actor), ...(op ? { op } : {}), ...(before ? { before } : {}), after, ...(line.reason ? { reason: line.reason } : {}) })
  }
  const sessions = journal.sessions.map((each): PastSession => ({
    at: each.at, actor: actorOf(each.actor), done: each.summary,
    deadEnds: each.deadEnds.map(({ tried, why, check }) => ({ tried, why, ...(check ? { recheck: check } : {}) })),
  }))
  return { past, sessions }
}
