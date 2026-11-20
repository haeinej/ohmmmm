# The cortex, its words, and its history: a guide

> **Superseded in part (2026-11-20).** [model.md](model.md) replaces identity, memory, working memory, settlement and inference with a profile and observations. What this file says about those is history; the rest still holds.

For the person whose cortex it is, and for any agent that keeps one. It explains the words ohm and cortex now share, what is evidence and what is inference, how each part of a cortex joins the graph of a vault, and how every change is recorded with who made it, and undone. [plan.md](plan.md) is the specification; [journal-and-history.md](journal-and-history.md) is the design this came from.

Every person, block and file below is invented. The examples follow one person, Mira Okafor, who writes essays and takes photographs on walks.

## 1. The words

| Word | What it is | Example |
| --- | --- | --- |
| **Block** | One unit of thought: a note, a passage, a photo with its caption, a link. | A note: "Walking is the speed at which I notice things." |
| **Post** | A published block. Publishing does not make a new thing; it is the same block, now readable by others. | Mira publishes the block "On slowness". It is now a post. |
| **Channel** | An ordered collection of blocks. | `essays`, `photos/walks` |
| **Connection** | A link from one block to another, made by the person. | "On slowness" connects to the photo "Bridge at dusk". |
| **Source** | Where a block came from: a book, a web page, a conversation. | A reading note comes from the book *Wanderlust*. |
| **Entity** | A person, place or thing that blocks are about. | The river Thames; a friend named Teo. |

Channels replace label, sublabel, section and folder as the organising word. What makes a channel a channel:

- **It is ordered.** The person decides what comes first. `essays` might open with the finished essays and end with drafts.
- **A block can be in many.** "On slowness" can be in `essays` and in `walks-and-thinking` at once. Channels are many-to-many; nothing is copied.
- **It is its own record, with a stable ID.** Renaming `walks` to `walking` keeps its ID, so everything that pointed at it still does.
- **It can be empty.** A channel made today, before anything is in it, is still a channel.
- **A block's first channel sets its published address.** If "On slowness" was first put in `essays`, its post lives under `essays`, wherever else it goes later.

In ohm a block can be in many channels. The folder vault cortex uses in its tests is simpler: a Markdown file is in the one channel whose folder it sits in (`essays/on-slowness.md` is in `essays`; `photos/walks/bridge.md` is in `photos/walks`, and counts in `photos` too).

## 2. Evidence and inference

There are two kinds of edge in the graph, and who may draw each is the point.

### Evidence: what the content shows

Evidence edges come from the content itself. The person makes them, by writing and filing. **A model never makes one.**

| Edge | Made when | Example |
| --- | --- | --- |
| **contains** | A channel holds a block | `essays` contains "On slowness" |
| **links** | A block links to another, in its text or as a whole | See below |
| **mentions** | A block names an entity | "On slowness" mentions the Thames |
| **from** | A block came from a source | A reading note is from *Wanderlust* |

A link can be made two ways:

- **In the text,** with the other block's slug in double brackets: `I walked the [[bridge-at-dusk]] route again`, or with words of your own shown in its place: `the light on [[bridge-at-dusk|that bridge]]`.
- **As a whole-block connection,** from one block to another, with an optional "why": "On slowness" → "Bridge at dusk", why: "the photo that started the essay".

### Inference: what the cortex concludes

Inference is what an agent works out. It is never an edge between two blocks. It is a node of the cortex, such as a memory or an observation, that points at what it was drawn from.

| Cortex node | Edge it draws | Points at | Example |
| --- | --- | --- | --- |
| Memory | **grounds** | The blocks, sessions or channels it rests on | "Slowness ties the essays to the walk photos" grounds on "On slowness" and "Bridge at dusk" |
| Observation | **observes** | What it saw it in | "Shortened a title to three words again" observes session `claude-12` |
| Skill | **learned** | The channels and blocks it was used on | "How Mira files walk photos" was learned on `photos/walks` |
| Tool | **acts** | What it reads and writes | A calendar tool acts on the person's calendar |

So **a model never draws an edge between two blocks.** If an agent sees that two blocks belong together, it writes an observation or a memory that cites both. It may also suggest the connection to the person, in words; if the person agrees and connects them, that connection is theirs, an evidence edge like any other. Accepting a suggestion is the person connecting.

## 3. How each part of the cortex joins the graph

Every file of the cortex is a node, just as every block is. Each is named one way, everywhere:

| Node | File | Who changes it |
| --- | --- | --- |
| `identity` | `identity.md` | The person confirms; agents propose facts, with evidence |
| `playbook` | `agents/AGENTS.md` | The person only |
| `memory/<name>` | `memory/<name>.md` | Agents and the person, at once; the person reverts what they do not want |
| `working/<agent>` | `.cortex/working/<agent>.md` | That agent, at once |
| `skill/<name>` | `skills/<name>/` | Agents propose; the person approves |
| `tool/<name>` | `tools/<name>.md` | The person adds it and switches it on; agents only ask for one |
| `channel/<path>` | What `vault.md` says the channel means and how blocks there are filed | Agents and the person, at once; what the person wrote by hand stands |

How each kind of cortex node joins the graph, and what evidence it needs:

| Node | Points at | Edge | Its evidence |
| --- | --- | --- | --- |
| Memory about knowledge | Blocks, channels, entities | grounds | Two or more distinct blocks, each at the version read |
| Memory about the person | Sessions, blocks they wrote | grounds | Two or more sessions, or the session where they said it |
| Observation | What it saw | observes | One session, or a node at a version |
| Skill | Channels and blocks it was used on | learned | Three or more sessions |
| Tool | What it reads and writes | acts | Its declaration, which the person writes |
| Identity fact | The person | about | Their words, or the block and passage that state it |
| Session | The changes it made | shown from the journal, not stored as edges | The journal |

### Evidence in practice

An observation or a memory carries `evidence`: a list of pointers, each a node at a version, or a session.

```json
{
  "name": "slowness-ties-essays-and-walks",
  "description": "Slowness is the thread between the essays and the walk photos",
  "kind": "reference",
  "stated": false,
  "body": "Both return to walking pace as the way to notice things.",
  "blocks": ["b-on-slowness", "b-bridge-at-dusk"],
  "evidence": [
    { "node": "b-on-slowness", "version": "v7" },
    { "node": "b-bridge-at-dusk", "version": "v2" }
  ]
}
```

Cortex checks that each pointer is well formed, that a cited cortex node had that version, and, when a vault is connected, that a cited block is still there. It does not count. How much evidence is enough is judgement, written in the playbook as a guide:

- **Stated** by the person: the session they said it in. Written as a memory at once.
- **Inferred about the person:** two or more sessions.
- **Inferred about their work:** two or more distinct blocks, each at the version read.
- **A skill:** three sessions where the same method was used.
- **An identity fact:** their words, or the block and passage that state it.

## 4. Version control

### The journal

Everything that happens in a cortex is a line in one append-only file, `.cortex/journal.jsonl`. Every line has `seq` (a running count), a unique `id`, `at` (when), `actor` (`{kind: "human" or "agent", name}`), sometimes `session`, and a `type`:

| Type | Written when | It holds |
| --- | --- | --- |
| `change` | A node changes, by the person or an agent | Node, op (create, update, remove, restore), versions before and after, why, evidence |
| `observation` | An agent or a host observes something | One line, with evidence. It changes no file. Lines written as `note` before the rename read as observations |
| `settled` | Observations are settled | What became of an observation: kept, dropped, or the memory it went into |
| `session` | An agent finishes or gives up a task | What was done, the IDs of the changes it made, and its dead ends |
| `save` | Someone names a point in history | A name and a note. It changes nothing |

A journal from an earlier version of cortex, when every agent edit waited for the person, may also hold `proposal` and `decision` lines. They are still read and kept, and change nothing.

The person and the signed-in account are human actors; every other name is an agent, by the name it connected with. An agent can never act under the person's name.

The file is marked `merge=union` for git. Every line has its own ID, so when two machines' journals are joined, both sides' lines are kept, and none clash. Two lines may then share a `seq`; every reader orders them by time, then ID.

`.cortex/history/` keeps every earlier version of every node, filed by its version hash. Between the two, any node can be read as it was at any point.

### Agents edit; every change says who made it

An agent writes directly. When Codex learns that Mira wants short titles, it writes the memory, and the journal records it as Codex's:

```json
{"seq":41,"id":"m3x1-4f2a9c0b7d11","at":"2026-11-19T10:02:00.000Z","actor":{"kind":"agent","name":"codex"},"type":"change","node":"memory/likes-short-titles","op":"create","before":null,"after":"c91…","reason":"Mira cut three titles to four words"}
```

The write returns the change's ID. Mira sees what agents did in the history:

```
$ cortex history --actor agent
41  2026-11-19T10:02:00.000Z  codex  create memory/likes-short-titles  (none) -> c91…  Mira cut three titles to four words
```

If she does not want it, she reverts it:

```
$ cortex revert 41 --reason "Only for essays"
Change 41 is undone: memory/likes-short-titles is back as it was. What it replaced is kept.
```

That is a new change, Mira's, which names the change it reverts. Codex's version stays in the history and can be brought back with `cortex restore`.

**What needs trust still waits for the person.** An identity fact is proposed with its evidence and set only when Mira runs `cortex confirm`; `cortex reject` turns it down for good. A skill an agent writes waits in `.cortex/proposed/skills/` until `cortex approve`, and is not used before. A tool is only asked for: Mira builds it, adds it to `tools/` and switches it on. Confirming and approving are command-line only, because an MCP client cannot prove it is the person; the change they make is Mira's, and names the agent that proposed it in `proposedBy`.

An agent never writes the playbook, identity, a skill or a tool, not even by restoring an earlier version, and never another agent's working memory. Where Mira wrote what a channel means by hand, her words stand: an agent's write, restore or revert over them is refused.

### Reading the past

| Tool | Command | Does |
| --- | --- | --- |
| `cortex_history` | `cortex history [--node n] [--since s] [--actor a]` | Lists changes and saves. Filter by node (`memory/likes-short-titles`), by prefix (`memory/`), since a seq (after it) or a date (from it), and by actor (`codex`, or `human`, or `agent`) |
| `cortex_as_of` | `cortex as-of <node> <when>` | A node as it was at a save's name, a date (the end of that day, in UTC), a time, or a seq |
| `cortex_save` | `cortex save <name> <note>` | Names this point, such as `before-reorganising`. It changes nothing |

An agent reading `identity` as it was sees it as agents always do: the birthdate is never shown.

### Undoing

| Tool | Command | Does |
| --- | --- | --- |
| `cortex_restore` | `cortex restore <node> <version>` | Brings a node back to an earlier version, as a new change |
| `cortex_revert` | `cortex revert <change>` | Undoes one change: the node goes back to what it was just before. Refused if the node has changed again since; restore a version instead. Reverting the change that made a node removes it |

Neither rewrites a line of the journal; what they replace is kept. Both are changes at once, from Mira or an agent. Identity, the playbook, skills and tools are restored and reverted only by Mira, and an agent restores only its own working memory.

### Sessions and dead ends

Nothing is captured on an agent's behalf. When it finishes a task, or gives it up, it writes a session, like a commit message:

```json
{
  "summary": "Retitled the walk photos by place",
  "outcome": "done",
  "made": ["m3x1-4f2a9c0b7d11", "m3x9-0a1b2c3d4e5f"],
  "project": "/home/mira/walks",
  "deadEnds": [
    { "tried": "Titling photos by date", "why": "Mira finds them by place", "check": "ls photos/walks | head" }
  ]
}
```

`made` groups the changes the agent made in that task, by the IDs its writes returned. Each dead end gets an ID, and stays open until a later session lists it in `resolved`. `cortex_start` lists the open ones, and when a Claude Code or Codex session starts in `/home/mira/walks`, the hook shows those recorded there, so the next agent does not try dating the photos again. `check` is a command a person or agent can run to see whether the dead end still holds; cortex never runs it.

### The hooks

| Moment | Does |
| --- | --- |
| Session start | Hands the agent the playbook, identity, memories marked always, working memory, and the open dead ends near its folder |
| Prompt | Nothing yet |
| Stop | Asks for `cortex_distill` once for each change of working memory not distilled |
| Session end | Records nothing |

The hooks keep their own checkpoints (start, ask, distill) in `.cortex/hooks.jsonl`. That is this machine's bookkeeping for when to ask, not history, and git does not take it.

### What is not built yet

- **Staleness:** marking a memory out of date when a block it pins changes.
- **Settlement rules per kind,** beyond the playbook's guidance.
- **The `~/Brain` layout,** with the cortex inside the brain folder.
- **The ohm-ux timeline reading the journal,** described below.
- **Sync to ohm,** which stays optional.

## 5. How it shows in ohm

ohm's editor is planned to show the journal to the person. This is how the wireframe draws it; cortex itself has no screens.

- **A timeline,** vertical, like the source control timeline in VS Code: one line per change, newest first, each with an icon saying whether you made it or an agent did, and which. Opening a line shows its details: the node, what changed, why, its evidence, and two actions, **Revert this change** and **Restore this version**. Both make a new change; the line opened stays as it was.
- **A versions card** on each page: its earlier versions, with who made each and when, and the saves that fall among them.
- **A connections card** on each block: the graph around it, the part of the channel tree it sits in, and its connections, grey for evidence and green for what the cortex inferred.
- **Connecting** is pulling a line from a block's dot to another block. That is the person making a connection; an agent's suggestion becomes one only this way.
- **Dragging** a block or a channel moves it. **⌥-dragging** adds it to another channel as well, since a block can be in many.
