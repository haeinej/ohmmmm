# Cortex and history: one path

> **Superseded in part (2026-11-20).** [model.md](model.md) replaces identity, memory, working memory, settlement and inference with a profile and observations. What this file says about those is history; the rest still holds.

Written 19 November 2026 as a proposal, and changed the same day as the owner decided its details. It joins what were separate: the cortex, version history, and what agents did. It goes with the personal brain plan for ohm-content-layer, which is not published yet. Steps 2 and 3 of the order below are built in ohm-cortex, with evidence from step 4, every change marked with who made it, and sessions with dead ends; see "Built" at the end. [The guide](guide.md) explains the result for people and agents.

For a day this design had every agent edit go through the person: an agent proposed, and nothing changed until the person accepted. The owner reversed that on 19 November 2026, and [plan.md](plan.md) records it: **agents edit directly; every change is marked with who made it; the person reverts.** What needs trust stays the person's: identity facts are proposed with evidence and confirmed, skills are approved, and tools are only asked for.

Two earlier decisions still hold:

- **When something becomes a memory is judgement in the playbook, not a count in code.** The evidence counts below are playbook guidance; code checks only that cited evidence is well formed and exists.
- **Cortex is not synced with ohm.** Sync below stays optional and off unless chosen.

## What existed

There were two cortexes. **ohm-cortex (B) is the cortex.** The one in ohm-content-layer (A) was the first MVP and will not be used; it is listed only so nothing in it is mistaken for current.

| | A · ohm-content-layer cortex | B · ohm-cortex (this repository) |
| --- | --- | --- |
| Where it keeps things | D1 tables on the vault service (`cortex_*` in `service/schema.sql`) | A folder of Markdown the person can open |
| Built | Memories with versions and history, context, notes and settlement (server checks two-session evidence), skills with approval, proposed tools | Identity with proposals, `vault.md`, memories, **working memory per agent**, **distill**, observations and settlement, skill and tool proposals, filing advice, `.cortex/history/`, MCP over stdio and HTTP, **hooks for Claude Code and Codex** |
| Turns | Tables and requests reserved, not built | Not taken; replaced by working memory and distill |
| Hooks | Designed in `plans/build-plan.md`, not built here | Built: `session-start`, `prompt` (empty), `stop` (asks to distill once per change), `session-end`. Not yet tried in a real session |
| Status | B's plan says B replaces A's design, and that B does not sync with ohm | 97 tests, CI on Node 20 and 22 |

### Overlaps and gaps it found

1. **The same rules were written twice,** in A and B, and had diverged.
2. **There were too many ways to write memory.** B alone had nine, each writing the folder on its own.
3. **There were five half-logs:** `.cortex/notes.jsonl`, `.cortex/sessions.jsonl`, `.cortex/history/`, A's version and turn tables, and the vault's `seq`. None recorded who changed what, or what was tried and dropped.
4. **Evidence meant sessions, not things.** Nothing tied a memory to the blocks it was drawn from.

## The design

### 1. One cortex: ohm-cortex

Decided: ohm-cortex is the cortex, folder-first and standalone. The ohm-content-layer cortex was the MVP and is retired. Rules live in one place, ohm-cortex's `src/core.mjs`.

The brain folder would hold the cortex inside it (step 7, not built; B keeps `.cortex/` for now):

```
~/Brain/
  blocks/  channels/  entities/  sources/  connections.jsonl     # content (the personal brain plan)
  cortex/  identity.md  vault.md  memory/  skills/  tools/  agents/  # B's layout, unchanged
  .brain/
    journal.jsonl     # the one log (below)
    history/          # every earlier version of every file, by version hash (B's .cortex/history/)
    index.sqlite      # derived and rebuildable
    working/<agent>.md
```

B's principle still holds: the cortex holds no content. It points at blocks by ID and version, and never copies them.

### 2. Cortex files are nodes

Every file of the cortex is a node in the journal, like a block: changes to it are recorded, and it has history, as-of, save, restore and revert. One naming:

| Node | File |
| --- | --- |
| `identity` | `identity.md` |
| `playbook` | `agents/AGENTS.md` (only the person changes it) |
| `memory/<name>` | `memory/<name>.md` |
| `working/<agent>` | `.cortex/working/<agent>.md` |
| `skill/<name>` | `skills/<name>/`, SKILL.md and the files beside it |
| `tool/<name>` | `tools/<name>.md` |
| `channel/<path>` | What `vault.md` says a channel means and how blocks there are filed |

`memory/MEMORY.md` and the headings and counts in `vault.md` follow other things and are rebuilt, so they are not nodes.

### 3. One log: the journal

One append-only file replaces `notes.jsonl`, `sessions.jsonl` and turns. Each line has `seq`, a unique `id`, `at`, `actor` (`{kind: human|agent, name}`), `session` when there is one, and `type`:

| `type` | Written by | Holds | Was |
| --- | --- | --- | --- |
| `change` | The person or an agent, whoever edited | Node, op, `before` and `after` versions, reason, evidence; for a confirmed identity fact or an approved skill, `proposedBy` | Nothing (only `history/`) |
| `observation` (written as `note` until it was renamed) | An agent, or a host | One observation, with `evidence`. It changes no file | `notes.jsonl` |
| `settled` | Settlement | What became of an observation: kept, dropped, or the memory it went into | Settled lines in `notes.jsonl` |
| `session` | An agent, when a task is done or given up | One line of what was done, the IDs of the changes it made, and dead ends | `sessions.jsonl`, now only the hooks' checkpoints |
| `save` | The person or an agent | A name and a note at this `seq`. It changes nothing | Nothing |

- **History is the journal plus `history/`.** "As of a date" means replaying to that day. A save is a line. Restore and revert write a new change; nothing is rewritten.
- **It merges cleanly.** Lines are append-only with IDs, so two machines join by union. That makes sync to ohm, or to Git, a copy, not a merge.
- **Privacy.** The journal stays private, like the rest of the cortex.
- **Old lines.** `proposal` and `decision` lines, written while agents' edits waited for the person, are still read and kept as history, and change nothing. A `decision` about an observation (then called a note) reads as `settled`.

### 4. Agents edit; the person reverts

An agent writes directly: a memory, a rewrite, a removal, what a channel means, its own working memory, a restore or a revert. Each is a `change` line whose actor is that agent, by name, with its versions before and after, its reason and its evidence, so the person can read what each agent did in the history and revert what they do not want. A revert or restore is a new change; the agent's version stays in history. The person's own edits, from the command line, are changes the same way.

What needs trust is not an edit an agent makes. An identity fact is proposed with evidence in `.cortex/identity.jsonl`, and set only when the person confirms it; the change is the person's and names the agent in `proposedBy`. A skill waits in `.cortex/proposed/skills/` until the person approves it. A tool is only asked for. An agent never writes, restores or reverts identity, the playbook, a skill or a tool, never another agent's working memory, and never over channel words the person wrote by hand.

### 5. Capture: hooks, and the agent's own record

| Moment | Hook | Does |
| --- | --- | --- |
| Session start | `SessionStart` | Playbook, identity, always memories, working memory, and the open dead ends near this folder |
| Before a prompt | `UserPromptSubmit` | Nothing yet. Later: memories fitted to the prompt |
| End of a turn | `Stop` | Asks to distill once per change of working memory |
| Session end | `SessionEnd` | Records nothing |

The hooks keep their checkpoints (start, ask, distill) in `.cortex/hooks.jsonl`, this machine's bookkeeping, not history.

Every write holds `.cortex/write.lock` from the moment it reads the version it checks until its line is in the journal, so the bridge and the cortex MCP server, two processes on one folder, never write over each other and never give two lines one seq. A lock left by a process that has gone, or held longer than 30 seconds, is taken. Files are written under a temporary name no other write shares, then moved into place. Nothing is captured on the agent's behalf. When it finishes a task, or gives it up, the agent writes a `session` line with `cortex_session`, like a commit message: what was done, the IDs of the changes it made, and dead ends, each with what was tried, why it was dropped, and a command that would show whether it still holds. A later session can mark a dead end resolved. Open dead ends are listed by `cortex_start`, and the session-start hook shows those near the folder it starts in. This is how [ANVC](https://github.com/yodering/anvc) keeps what was tried.

### 6. One way to write memory: three levels

| Level | What | Written by | Rule |
| --- | --- | --- | --- |
| **Evidence** | Content edges (contains, links, mentions, from) and the journal (changes, sessions) | The person, through content; nobody writes it for them | Checkable and rebuildable |
| **Working** | Each agent's scratch for this session and the threads left open | The agent, at once (`cortex_working`) | Never shown as knowledge |
| **Inference** | Memories, skills, identity facts, and any claim relating blocks | The agent, through observations and settlement; identity facts and skills wait for the person | Must cite evidence |

Evidence on every observation and memory is a list of pointers: `{ node, version }` or `{ session }`.

- **Stated** (the person said it): the session where they said it. Becomes a memory at once.
- **Inferred about the person:** two or more sessions.
- **Inferred about knowledge**, such as "slowness ties the essays to the photos": two or more distinct blocks, each pinned to a version.
- **A skill:** three sessions where the same method was used, cited by session.
- **An identity fact:** the person's words, or the block and passage that state it.

**Freshness (not built):** when a `change` lands on a node a memory pins, that memory is stale. `cortex_start` would list stale memories so the agent re-reads the evidence and confirms or rewrites it.

**Dead ends:** what a session recorded as tried and dropped, a change the person reverted, and an identity value they rejected, are what an agent should not try again unless something changed.

### 7. Tools

| Keep | Change | New |
| --- | --- | --- |
| `cortex_start` (adds dead ends) | `cortex_remember`, `cortex_forget` and `cortex_settle` record each write as the agent's change, with a reason; `cortex_describe_channel` (was `cortex_describe_section`) | `cortex_history`, `cortex_as_of`, `cortex_save` |
| `cortex_working`, `cortex_distill` | `cortex_observe` and memories take `evidence` | `cortex_restore`, `cortex_revert` |
| `cortex_recall`, `cortex_skill`, `cortex_file_advice`, `cortex_propose_identity`, `cortex_propose_skill`, `cortex_propose_tool` | | `cortex_session` |

Confirming an identity fact and approving a skill are the person's, from the command line (`cortex confirm`, `cortex reject`, `cortex approve`), and so are their restores and reverts of what an agent did (`cortex restore`, `cortex revert`). No MCP tool confirms or approves, because no MCP client is known to be the person.

### 8. How each cortex layer joins the graph

| Node | Points at | Edge (inference) | Its evidence |
| --- | --- | --- | --- |
| Memory about knowledge | Blocks, channels, entities | `grounds` | Two or more pinned nodes |
| Memory about the person | Sessions, blocks they wrote | `grounds` | Two or more sessions, or a stated quote |
| Observation | What it saw | `observes` | One session, or a node at a version |
| Skill | Channels and blocks it was used on | `learned` | Three or more sessions |
| Tool | What it reads and writes | `acts` | Its declaration (the person's) |
| Identity fact | You | `about` | A quote |
| Session | The changes it made | Shown from the journal, not stored as edges | The journal |

This is what the ohm-ux graph draws: grey evidence edges, green cortex edges.

## Order

1. **Remove the MVP cortex** from ohm-content-layer, once the vault editor no longer reads it. *Done: removed when the repository became ohm-vault.*
2. **Journal in B:** `observation` (first written as `note`) and `settled` lines; read the old `notes.jsonl` and `sessions.jsonl` for compatibility. *Built.*
3. **`change` lines** from every write, with actor; history views (`cortex_history`, `cortex_as_of`, `cortex_save`). *Built, with `cortex_restore` and `cortex_revert`, and cortex files as nodes.*
4. **Evidence on observations and memories**, settlement rules per kind, staleness. *Evidence built; settlement rules per kind and staleness not.*
5. **Sessions and dead ends** from agents, shown at session start. *Built.*
6. **One `cortex_propose`**; remove the separate proposal tools. *Dropped: agents edit directly, and only identity facts, skills and tools are proposed, each in its own way.*
7. **Brain folder layout**: the cortex inside `~/Brain`; the vault contract reads blocks and channels.
8. **ohm-ux graph and timeline** read the journal.
9. **Sync to ohm**, optional: copy the journal and files.

## To decide

- **One folder** (`~/Brain` with `cortex/` inside) or two (B's `~/cortex` beside the brain)? Proposed: one.

## Built

On 19 November 2026, in ohm-cortex, on the branch `journal-and-vocabulary`. [plan.md](plan.md) has the details and the decisions made while building.

- **The journal** is `.cortex/journal.jsonl` with `change`, `observation`, `settled`, `session` and `save` lines; `note` lines from before the rename read as observations. Lines written as `stamp` before the rename read as saves; `proposal` and `decision` lines from the day agents' edits waited for the person are read and change nothing.
- **Changes:** every write, by the person or an agent, is a change marked with who made it. The person reverts or restores what they do not want. Identity proposals live in `.cortex/identity.jsonl`, skill and tool proposals in `.cortex/proposed/`, as before.
- **History views:** `cortex_history`, `cortex_as_of`, `cortex_save`, `cortex_restore` and `cortex_revert`, and the commands `history`, `as-of`, `save`, `restore` and `revert`.
- **Sessions:** `cortex_session`; dead ends in `cortex_start` and at session start near the folder.
- **Evidence** on observations, distilled observations and memories, checked for shape and existence; the counts in §6 are playbook guidance.
- **Words:** blocks and channels, and `cortex_describe_channel`.

Not built, for later: staleness and settlement rules per kind from step 4; the `~/Brain` layout (step 7); the ohm-ux timeline reading the journal (step 8); sync (step 9).
