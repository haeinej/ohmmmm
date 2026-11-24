// The cortex of the home on this computer, in the workspace (src/data/local-cortex.ts): read through
// the real bridge (home/serve.mjs, home/cortex-routes.mjs) from a real home folder, changed by the
// person in the app, written back through the cortex's own operations and journaled as theirs. Every
// person here is invented.
import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"
import { initHome } from "../../bin/ohmmmm.mjs"
import { homeBridge, listenHome, pairApp } from "../../home/serve.mjs"
import { openCortex as openFolder } from "../../cortex/src/folder.mjs"
import { createLocalSource } from "../src/data/local-source"
import { cortexPast, observationTitle } from "../src/data/local-cortex"
import { blockKey, byId, cortex, journalOf } from "../src/data/workspace-data"
import { buildGraph } from "../src/graph/model"
import {
  answerCortex, cortexWaiting, editCortex, forgetCortex, pinObservation, setSource, sourceChanged, switchTool, writeObservation,
} from "../src/workspace/store"

// The cortex's own operations, in JavaScript: typed loosely here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const openCortex = (dir: string, options?: { actor: string }) => openFolder(dir, options) as any
const WALK = "3m2zx5u6ifk2a", RAIN = "3m2zx5u6ifk2b"

async function withHome(t: test.TestContext) {
  const parent = await mkdtemp(join(tmpdir(), "ohmmmm-app-cortex-"))
  const layout = await initHome(parent, "mira.example.com")
  await mkdir(join(layout.vault, "notes"), { recursive: true })
  await writeFile(join(layout.vault, "notes/walk.md"), `---\nid: ${WALK}\ntitle: Slow walk\n---\n\nYanaka, lanterns, cats.\n`)
  await writeFile(join(layout.vault, "notes/rain.md"), `---\nid: ${RAIN}\ntitle: Rain\n---\n\nWrites more when it rains.\n`)
  await writeFile(join(layout.cortex, "tools", "vault-search.md"), '---\nname: "vault-search"\ndescription: "Searches the vault"\non: false\n---\n\nSearches by text.\n')
  const agent = openCortex(layout.cortex, { actor: "claude-code" })
  const seen = await agent.observe({ id: "walks-and-rain", text: "The walk and the rain notes are the same week.", about: [WALK, RAIN] })
  await agent.recordSession({ summary: "Read the notes from that week", made: [seen.change], deadEnds: [{ tried: "Filing the rain note under weather", why: "There is no such channel" }] })
  await agent.proposeProfile({ heading: "Preferences", line: "Titles stay short.", quote: "Shorter titles." })
  await agent.proposeSkill({ text: "---\nname: short-titles\ndescription: Keep titles short\n---\nThree words.\n" })
  await agent.proposeTool({ name: "send-mail", description: "Sends a mail", inputs: "to, text", outputs: "sent" })

  const token = await pairApp(layout.home) as string
  const server = await listenHome(homeBridge({ layout, DatabaseSync, agent: undefined }), { port: 0 }) as import("node:http").Server
  const bridge = { url: `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`, token }
  const problems: string[] = []
  const source = await createLocalSource(bridge, { onProblem: message => { problems.push(message) }, onChange: sourceChanged })
  await setSource(source)
  t.after(async () => {
    await source.settled()
    await setSource(null)
    await new Promise(done => { server.closeAllConnections(); server.close(done) })
    await rm(parent, { recursive: true, force: true })
  })
  const lines = async () => (await readFile(join(layout.cortex, ".cortex", "journal.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line))
  const file = (...path: string[]) => readFile(join(layout.cortex, ...path), "utf8")
  return { layout, source, problems, lines, file }
}

test("the paired app shows the real home's profile, observations, skills and tools; evidence resolves to its blocks", async t => {
  await withHome(t)
  const kinds = cortex.map(doc => `${doc.kind}:${doc.title}`).sort()
  assert.deepEqual(kinds, ["observation:The walk and the rain notes are the same week.", "profile:Profile", "skill:file-a-source", "tool:vault-search"])
  const seen = byId("observation-walks-and-rain")!
  assert.deepEqual([seen.by, seen.about], ["claude-code", [WALK, RAIN]])
  // What it is about resolves to the blocks the workspace shows.
  assert.deepEqual(seen.about!.map(id => byId(id)?.title), ["Slow walk", "Rain"])
  // In the graph, an observed connection joins the two blocks.
  const edge = buildGraph().edges.find(each => each.observed?.includes(seen.title))
  assert.ok(edge, "the observation draws an observed connection")
  assert.deepEqual([edge.source, edge.target].sort(), [blockKey(WALK), blockKey(RAIN)].sort())
  assert.equal(byId("tool-vault-search")!.on, false)
  const waiting = cortexWaiting()
  assert.deepEqual([waiting.profile.map(p => p.line), waiting.skills.map(s => s.name), waiting.tools.map(x => x.name)], [["Titles stay short."], ["short-titles"], ["send-mail"]])
})

test("the cortex's history joins the vault's: its changes by who made them, and an agent's session with its dead end", async t => {
  await withHome(t)
  const lines = journalOf().historyLines("cortex")
  const made = lines.find(line => line.type === "change" && line.node === "observation-walks-and-rain")
  assert.ok(made && made.type === "change")
  assert.deepEqual([made.op, made.actor], ["create", { kind: "agent", name: "claude-code" }])
  const session = lines.find(line => line.type === "session")
  assert.ok(session && session.type === "session")
  assert.deepEqual([session.done, session.changes, session.deadEnds[0].tried], ["Read the notes from that week", [made.id], "Filing the rain note under weather"])
  // One timeline: the vault's and the cortex's lines in the order they happened.
  const all = journalOf().historyLines()
  assert.deepEqual(all.map(line => line.at), [...all.map(line => line.at)].sort())
})

test("the person edits the profile, a skill and a tool, and each is written through the cortex, journaled as theirs", async t => {
  const { source, lines, file, problems } = await withHome(t)
  await editCortex("cortex-profile", "## Preferences\n\n- Short paragraphs.\n\n## Goals\n\n## Notes")
  await editCortex("skill-file-a-source", "# Filing a source\n\nAsk once, then file.")
  await switchTool("tool-vault-search", true)
  await source.settled()
  assert.deepEqual(problems, [])
  assert.match(await file("profile.md"), /- Short paragraphs\./)
  assert.match(await file("skills", "file-a-source", "SKILL.md"), /^---\nname: file-a-source[\s\S]*\n---\n# Filing a source\n\nAsk once, then file\.\n$/)
  assert.match(await file("tools", "vault-search.md"), /on: true/)
  const mine = (await lines()).filter(line => line.actor.name === "member").map(line => [line.node, line.op])
  assert.deepEqual(mine.slice(-3), [["profile", "update"], ["skill/file-a-source", "update"], ["tool/vault-search", "update"]])
  assert.equal(source.unsent(), false)
  // In the app's history too, as the person's.
  const profile = journalOf().linesFor("cortex-profile").at(-1)!
  assert.deepEqual(profile.actor, { kind: "human", name: "you" })
  assert.equal(journalOf().linesFor("tool-vault-search").at(-1)!.summary, "Switched it on")
})

test("the person writes, pins and forgets an observation about a block", async t => {
  const { source, lines, file, layout } = await withHome(t)
  const made = await writeObservation({ text: "Walks before writing.", about: [WALK] })
  await source.settled()
  // Its name in the cortex is its file's: the slug the workspace gave it.
  const id = byId(made.id)!.slug.slice("observation-".length)
  assert.match(await file("observations", `${id}.md`), new RegExp(`by: "you"[\\s\\S]*about: \\["${WALK}"\\]`))
  await pinObservation(made.id, true)
  await editCortex(made.id, "Walks before writing, most mornings.")
  await source.settled()
  assert.match(await file("observations", `${id}.md`), /pin: true[\s\S]*most mornings/)
  assert.equal(byId(made.id)!.title, "Walks before writing, most mornings.")
  await forgetCortex(made.id)
  await source.settled()
  await assert.rejects(file("observations", `${id}.md`))
  assert.deepEqual((await lines()).filter(line => line.node === `observation/${id}`).map(line => [line.op, line.actor.name]), [["create", "member"], ["update", "member"], ["update", "member"], ["remove", "member"]], "made, pinned, edited, forgotten: one write each")
  assert.equal(byId(made.id), undefined)
  // Forgotten, it is kept: the person can restore it with the cortex.
  const removed = (await lines()).at(-1)
  await openCortex(layout.cortex).restore({ node: `observation/${id}`, version: removed.before })
  assert.match(await file("observations", `${id}.md`), /most mornings/)
})

test("an agent in the page writes an observation, once approved, as its own", async t => {
  const { source, lines } = await withHome(t)
  const made = await journalOf().actingAs({ kind: "agent", name: "Agent in this page" }, async () => writeObservation({ text: "Prefers lists.", about: [RAIN] }, "Asked for a list twice"))
  await source.settled()
  const last = (await lines()).at(-1)
  assert.deepEqual([last.node, last.actor, last.reason], [`observation/${byId(made.id)!.slug.slice(12)}`, { kind: "agent", name: "Agent-in-this-page" }, "approved by the person in the app: Asked for a list twice"])
  assert.equal(byId(made.id)!.by, "Agent in this page")
})

test("the person accepts a profile line and approves a skill; the workspace reads them from the cortex", async t => {
  const { lines, file } = await withHome(t)
  await answerCortex("profile", cortexWaiting().profile[0].id, true)
  await answerCortex("skill", "short-titles", true)
  assert.match(await file("profile.md"), /## Preferences\n\n- Titles stay short\./)
  assert.match(byId("cortex-profile")!.body, /- Titles stay short\./)
  assert.equal(byId("skill-short-titles")!.body, "Three words.")
  assert.deepEqual(cortexWaiting().profile, [])
  assert.deepEqual(cortexWaiting().skills, [])
  const answers = (await lines()).slice(-2).map(line => [line.node, line.actor.name, line.reason])
  assert.deepEqual(answers, [["profile", "member", "accepted: Titles stay short."], ["skill/short-titles", "member", "approved"]])
})

test("a change made on disk since the app read it is not written over", async t => {
  const { source, layout, problems, file } = await withHome(t)
  await writeFile(join(layout.cortex, "profile.md"), "---\n---\n\n## Notes\n\n- Written by hand.\n")
  // Refused, and said: the store reports it as a notice.
  await assert.rejects(editCortex("cortex-profile", "## Notes\n\n- From the app."), /changed on disk/)
  await source.settled()
  assert.match(await file("profile.md"), /Written by hand/)
  assert.deepEqual(problems, [])
})

test("cortex history lines read their versions from the texts the bridge sent", () => {
  const { past, sessions } = cortexPast({
    changes: [{ seq: 1, id: "a", at: "2026-11-20T10:00:00.000Z", actor: { kind: "agent", name: "codex" }, node: "observation/x", op: "create", before: null, after: "c1" },
      { seq: 2, id: "b", at: "2026-11-20T11:00:00.000Z", actor: { kind: "human", name: "member" }, node: "observation/x", op: "update", before: "c1", after: "c2" },
      { seq: 3, id: "d", at: "2026-11-20T11:30:00.000Z", actor: { kind: "human", name: "account" }, node: "profile", op: "update", before: "p1", after: "p2" },
      { seq: 4, id: "c", at: "2026-11-20T12:00:00.000Z", actor: { kind: "human", name: "member" }, node: "agents/unknown", op: "update", before: null, after: "c3" }],
    sessions: [],
    texts: { p1: "## Notes\n", p2: "---\naccount: \"mira.example\"\n---\n## Notes\n", c1: "---\nby: \"codex\"\n---\nFirst.\n", c2: "---\nby: \"codex\"\n---\nSecond line.\n" },
  })
  assert.deepEqual(past.map(each => [each.node, each.op, each.actor.name, each.after.body]), [
    ["observation-x", "create", "codex", "First."], ["observation-x", undefined, "you", "Second line."],
  ])
  assert.deepEqual(sessions, [])
  assert.equal(observationTitle("# Heading here\nmore"), "Heading here")
})
