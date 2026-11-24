# Rebuilding cortex

> **Superseded in part (2026-11-20).** [model.md](model.md) replaces identity, memory, working memory, settlement and inference with a profile and observations. What this file says about those is history; the rest still holds.

A plan for the cortex as separate software, decided in conversation on 14 November 2026. It replaces the cortex design in `plans/build-plan.md` of ohm-content-layer (now ohm-vault) where the two disagree.

## What cortex is

A person has two things, kept apart.

- **The vault** is what they made: their notes and sources, kept as blocks, and the posts they published. It is the source of truth. Only the person decides what goes into it.
- **The cortex** is how an agent reads and edits that vault for them: who they are, how they like to work, where things are, and how they want things filed. It changes as the agent learns. It holds no content of its own.

If the vault is lost, their work is gone. If the cortex is lost, the agent has to learn them again, and nothing they made is gone.

## Words

Cortex uses ohm's words for what is in a vault. [The guide](guide.md) explains them with examples.

- **Block:** one unit of thought. A published block is a **post**.
- **Channel:** an ordered collection of blocks. A block can be in many. It replaces label, sublabel, section and folder as the organising word.
- **Connection, source, entity:** a link between blocks, where a block came from, and a person, place or thing a block is about.
- **Evidence:** what the content shows: a channel contains a block, a block links or mentions another, a block came from a source. The person makes these. A model never writes one.
- **Inference:** what the cortex concludes, kept as cortex nodes that point at what they were drawn from: a memory grounds, an observation observes, a skill was learned on, a tool acts on. An agent that sees a link between two blocks writes an observation or a memory citing both; it never connects them. It may suggest a connection; making it is the person's.
- **Node:** any block, and any file of the cortex. Cortex files are named `identity`, `playbook`, `memory/<name>`, `working/<agent>`, `skill/<name>`, `tool/<name>` and `channel/<path>`, and each has history like a block.

## Principles

1. **The vault is canonical.** Cortex never holds a fact that belongs in the vault. A memory may point at a block by its ID. It never copies what the block says.
2. **The person controls content.** Something enters the vault only when the person hands it over. The agent files it as given, proposes where it goes, and indexes it. It never writes a block or a fact on its own initiative, and it edits a block only when asked.
3. **The folder is the cortex.** A cortex is a folder of Markdown files the person can open, read and edit. Hand edits are what the agent gets next. There is no hidden second copy. A host such as ohm is a place it syncs to, not the original.
4. **Identity is the root, and it is strict.** Everything in a cortex is about one identity. Identity facts are few, typed, rarely change, and are never guessed.
5. **Agents edit directly; every change is marked with who made it; the person reverts.** The agent writes what it learns without asking, and each write is a change in the journal under its name, so the person can see it and undo it. Identity, skills and tools need the person: the agent cannot set an identity fact, approve its own skill, or give itself a tool.
6. **What the person said outranks what the agent worked out.** Every memory says which it is.
7. **Nothing is lost.** Every replaced or removed file is kept and can be restored.
8. **Private.** A cortex is for one person. Nothing in it is published, used for matching, or sent to another service. Secrets have one place and never leave the machine.
9. **Standalone.** Cortex runs without ohm, a particular vault, or a particular agent. It depends on a small vault contract, and any vault can provide it.

## The folder

```
cortex/
├── agents/
│   ├── AGENTS.md         the rulebook: how an agent keeps this cortex and files into the vault
│   └── secrets/          the person's keys and tokens. Never read into anything, never committed
├── identity.md           who this is: strict fields, confirmed by the person
├── vault.md              how to read the vault: each channel, what it means, what goes where
├── memory/               how they work, and where things are. One thing per file
│   └── MEMORY.md         generated index, one line per memory
├── skills/               how they like a kind of source filed or a task done. <name>/SKILL.md
├── tools/                what the agent may use. One file per tool, on or off
├── .cortex/              machinery the person does not need to look at
│   ├── working/          working memory, one file per agent: this session, and what was left open
│   ├── journal.jsonl     every change, observation, settlement, session and save, with who did it
│   ├── hooks.jsonl       the hooks' checkpoints on this machine: when to ask for a distill. Not committed
│   ├── identity.jsonl    identity facts proposed, confirmed and turned down
│   └── history/          every earlier version of every file, by version
├── .gitignore            policy: secrets and temporary files never leave the machine
└── .gitattributes        policy: same line endings everywhere; generated and append-only files merge cleanly
```

For someone non-technical it is: who I am, how my vault is laid out, what my agent has learned, what it knows how to do, and what it may use.

## Who may change what

| Part | The agent may | Only the person may | Read |
| --- | --- | --- | --- |
| `agents/AGENTS.md` | Nothing | Add their own rules at the end | Every session |
| `agents/secrets/` | Nothing, and never read a value into anything | Put a secret there | When a tool needs it, by file name |
| `identity.md` | Propose a field, with evidence | Confirm, correct or clear a field | Every session, in full |
| `vault.md` | Keep the structure and counts in step with the vault (cortex does this); write a channel's meaning and conventions | Revert the agent's words; edit anything in it; what they write outranks the agent's | Every session |
| `memory/` | Write, rewrite and remove, each a change under its name | Revert or restore any change; edit or remove anything | Index every session; a memory when it fits |
| `.cortex/working/<agent>.md` | Write its own at once; read the others' | Edit or clear any of them | Every session |
| `skills/` | Propose | Approve | Descriptions every session; a skill when it fits |
| `tools/` | Ask for one to be built | Add one, switch one on or off | The list every session |
| The journal | Observe, record its sessions, save; restore and revert what it may write | Restore and revert anything, and everything the agent may | History and as-of |
| `.gitignore`, `.gitattributes` | Nothing | Change the policy | Never by the agent |

## Identity

Identity is the small set of facts about a person or organisation that rarely change. It is structured, typed and held to harder rules than memory.

### Fields

| Field | Type | Example | Notes |
| --- | --- | --- | --- |
| `kind` | `person` or `organization` | `person` | Required before most other fields mean anything |
| `account` | DID or handle | `did:plc:…` | Authoritative when it comes from the signed-in account |
| `name` | Text | `Alex Kim` | Legal or full name, as they give it |
| `preferredName` | Text | `Alex` | What to call them |
| `pronouns` | Text | `they/them` | Only ever stated. Never inferred from a name or writing |
| `emails` | List of addresses, each with a label | `work: alex@example.com` | Validated as addresses |
| `websites` | List of URLs | `https://example.com` | |
| `city` | Text | `Seoul` | Where they are based |
| `timezone` | IANA zone | `Asia/Seoul` | |
| `languages` | List, first is preferred | `ko, en` | |
| `birthdate` | ISO date, or month and day only | `1994-05-02` | Most sensitive field. Never proposed from the vault unless the source states it outright |
| `occupation` | Text | `Product designer` | What they do |
| `organization` | Text | `Example Studio` | Where they do it |
| `position` | Text | `Founder` | Their role there |

An organisation uses the same file with the fields that apply (`name`, `emails`, `websites`, `city`, `timezone`) plus `about`. Fields are fixed: an agent cannot add a new one. A person can add their own below the fixed ones, and the agent treats those as read-only.

### How it is written

`identity.md` holds only confirmed values, as properties at the top, followed by a short `about` in the person's own voice:

```
---
kind: person
preferredName: Alex
pronouns: they/them
city: Seoul
timezone: Asia/Seoul
languages: [ko, en]
occupation: Product designer
---
Designs tools for independent writers. Writes plainly, in short sentences.
```

Behind each value, `.cortex/identity.jsonl` records where it came from: the person stated it, it came from the account, or it was confirmed from a vault block (with the block ID and the passage). It also records when it was confirmed and what it replaced.

### Policies

1. **No field is set without the person.** The agent proposes; the person confirms. The one exception is `account`, which comes from the signed-in account itself.
2. **A proposal needs evidence from the vault or the person's own words.** It names the block ID and quotes the passage that states the fact. A fact the agent worked out (a city from a photo caption's date, a job from writing style) is not evidence.
3. **Never guess.** Pronouns are never inferred from a name. Kind is never inferred from writing style. A field with no evidence stays empty, and empty is a valid answer.
4. **Values are checked.** Emails must be addresses, timezones real zones, dates real dates. A value that fails is refused.
5. **A confirmed field is not overwritten by a proposal.** If the vault later says something different, the new value is proposed beside the old one, and the confirmed one stands until the person chooses.
6. **Sensitive fields stay in.** Email addresses, birthdate and city are never sent to another service, put in a URL, or included in anything published. **Birthdate is hidden from agents altogether:** no tool or resource returns it, and an agent is told only that one is on file. A task that needs it asks the person. The rest are shown to the agent so it can help, not so it can share.
7. **Every change is kept.** An earlier value can be read back and restored.
8. **Proposals do not nag.** A value the person turned down is not proposed again for that field, whatever the evidence. The person can still set it themselves. Two proposals of the same value are one.
9. **An agent never writes as the person.** The names `member` and `account` are reserved; an agent that connects under one is recorded as `agent:<name>`.

## How the vault is read: `vault.md`

`vault.md` is the agent's index of the vault, so a new session knows where things are without reading everything.

- **Structure and counts** come from the vault: each channel and sub-channel, how many blocks, what is recent. Cortex keeps these in step with vault events, without asking, because they are derived, not content.
- **Meanings** say what each channel is for and what goes in it. The agent writes them without being asked, from what it sees in the vault and what the person says. The person can edit any of it, and what they write outranks what the agent wrote.
- **Filing conventions** per channel: how titles are written, what properties a block there carries, what it usually links to.

Pointers to specific blocks live in `reference` memories, by block ID.

## Memory

### Long-term memory: `memory/`

One thing learned per file, with a one-line description. Kinds:

| Kind | Holds | Example |
| --- | --- | --- |
| `preference` | How they want work done | Wants a short first draft before polished prose |
| `reference` | Where something is in the vault, by block ID | The pricing decisions are in block `3m…` |
| `person` | Soft facts about them that are not identity fields and are not vault content | Is learning to write in English |

The `project` kind is dropped: facts about a project are vault content.

Rules carried over from the current implementation:
- A memory is `stated` (the person said it) or inferred.
- A rewrite names the version it replaces.
- Every rewrite keeps what it replaced.
- `always` puts a memory in full into every session.
- `seen` counts how often a memory was confirmed.

### Working memory: `.cortex/working/`

What an agent is noticing in this session, and what was left open last time. Each agent keeps its own file, named for it (`claude-code.md`, `codex.md`), so two agents working at once never write over each other.

| | Long-term memory | Working memory |
| --- | --- | --- |
| Holds | How they work, across sessions | How they are working today, and open threads |
| Example | Wants a short first draft first | Answering in Korean today, one-line replies. Filing three meeting notes, two done |
| Written | When stated, or seen in more than one session | At once, all session, by the agent it belongs to |
| Life | Until corrected | Refreshed every session |

The cycle:

1. **Session start: before, then refresh.** The agent reads its own working memory and every other agent's beside long-term memory and the vault index, then rewrites its own for today. It keeps open threads, takes up any another agent left, and drops what was only about that day.
2. **During the session.** The agent updates its own working memory as it works. A correction goes there at once. Anything the person states outright is also written to long-term memory straight away.
3. **Session end: distill and merge.** The agent reads every agent's working memory together. What more than one of them saw, or one saw across sessions, becomes an observation, and a memory at the next settle. What is left stays in its own file as "last time".

When something has been seen enough to become a memory is judgement, written in the playbook, not a count kept in code. Style is learned in three steps: noticed today, seen again, remembered.

## Filing into the vault

The agent helps put the person's sources into the vault and keeps the index. It does not author.

1. The person hands something over: pastes it, uploads it, says "save this", or connects a folder.
2. The agent reads `vault.md` and any skill for that kind of source.
3. It proposes a place under the person's own channel names, a title in their style, and links to related blocks. It asks once.
4. On their yes, it saves through the vault's API, leaving their words as given.
5. The vault reports the new block. Cortex updates `vault.md` and any pointers.
6. Anything the agent learned about how they file (they shortened its title again) goes into working memory.

Publishing is a separate step owned by the vault, and needs its own approval.

## In, cortex, out

What each part can do, in plain words. Tool names are given where they exist.

### In

**From the person**
- **Tell it something about themselves.** Remembered at once, marked as theirs. `cortex_remember`
- **Correct it.** Rewritten at once; the old version kept. `cortex_remember`
- **Have it forget.** They see exactly what goes first. `cortex_forget`
- **Undo what an agent did, or go back to a version.** `cortex history --actor agent`, then `cortex revert`, `cortex restore`. *Built*
- **Confirm who they are.** Accept, correct or clear an identity field. *New*
- **Approve a skill.** A procedure the agent proposed becomes usable. `cortex approve`
- **Switch a tool on or off.** By editing its file. *A command is new*
- **Edit anything by hand.** The agent gets it next session.

**From the agent**
- **Record what it saw.** One line, what happened rather than what it concludes; changes nothing yet. `cortex_observe`
- **Edit the cortex.** Each edit is a change marked as its own, with a reason and evidence. *Built*
- **Record a task.** What was done, the changes it made, and the dead ends. `cortex_session`. *Built*
- **Update working memory.** What is happening this session. *New*
- **Propose an identity fact,** with the block and passage that state it. *New*
- **Propose a skill,** or ask for a tool. `cortex_propose_skill`, `cortex_propose_tool`

**From the vault**
- **Report a change.** A block saved, moved or removed; a channel added or renamed. `cortex event` today; *structured events are new*
- **Report its shape.** Channels and counts. *New*

**From the agent's harness, through hooks**
- **A session started, a turn ended.** Triggers refresh, open dead ends near the folder, and distill, without the model having to remember. *Built*

### Cortex

- **Settle** observations into memories, keeping what was stated above what was inferred. *Built*
- **Refresh and distill working memory.** *New*
- **Keep `vault.md` in step** with the vault's structure. *New*
- **Check its pointers** to blocks that moved or were removed. *New*
- **Keep history** of every file, with every change and who made it in the journal. *Built*: `cortex_history`, `cortex_as_of`, `cortex_save`, `cortex_restore`, `cortex_revert`

### Out

**To the agent**
- **Brief me.** Identity, how to read the vault, how they work, working memory from last time, approved skills, tools switched on, and anything waiting. `cortex_start`; *working memory and vault map are new*
- **What do I know about this?** The memories that fit. `cortex_recall`
- **How should I file this?** The likely channel, their conventions for it, the skill for this kind of source, and related blocks. The agent proposes this to the person. *New, read from `vault.md` and skills*
- **How do they like this done?** One skill in full. `cortex_skill`

**To the person**
- **Show me what you know about me.** Every file, who wrote it, where it came from, earlier versions.
- **Is anything off?** Identity, skill and tool proposals, observations waiting, broken pointers, channels with no meaning. `cortex status`, *built*

**To the vault**
- **Nothing directly.** Filing goes through the vault's API on the person's say-so.

## How an agent reaches cortex

Cortex does not run an agent. It is read by one: ChatGPT, Claude, a coding agent, or anything else that speaks MCP. Those clients do not open the folder, so everything an agent must know is served to it over MCP.

- **The instructions send an agent to `cortex_start`.** When a client connects, the server answers with one self-contained paragraph, under 512 characters, because clients read the start of it first: what this server is, call `cortex_start` first and follow the playbook it returns, never guess identity, and keep it private. Codex and Claude Code read these instructions; ChatGPT's handling is not documented.
- **The playbook comes back from `cortex_start`.** Tools are the one MCP feature every client supports, so the cortex's own `agents/AGENTS.md`, the person's added rules included, is returned by that call and read from disk each time.
- **A prompt for the person.** `start` appears where a client shows prompts, such as a slash command in Claude Code, for when the person wants to begin from their cortex explicitly.
- **Hooks are the only way that does not depend on the model.** In Claude Code and Codex the adapter (step 7) puts the playbook in front of the model at session start, whether or not it calls a tool. Nothing in MCP itself does that. Rules guide the agent; what it cannot do is enforced by the tools.
- **The files are resources.** The playbook, identity, `vault.md`, the memory index and each memory, approved skills, and the tool list can be read as `cortex://` resources. Secrets, birthdate, proposals and the journal are never served as resources.
- **The tools change things.** Everything that writes goes through a tool, so the limits are enforced in code.
- **Two ways to connect.** Over standard input and output, for agents on the person's machine (`cortex mcp`). Over HTTP, for clients that connect to a remote server, such as ChatGPT and Claude in the browser. Over HTTP it is `cortex serve`, signed in with a bearer token from `cortex token`; ChatGPT and Claude's web connectors need OAuth, which is not built.

## What cortex needs from a vault

A small contract, so any vault can sit beside a cortex: ohm's service, an Obsidian folder, or another host.

| Operation | What it answers |
| --- | --- |
| Shape | The channels and sub-channels, with counts and recent blocks |
| Read | One block by its ID |
| Exists | For a list of block IDs, whether each still exists, and where it is now, in one call |
| Changes since | What was saved, moved or removed since a point |
| Profile | Identity facts the vault itself holds, such as its account and published profile, each with where it came from |

Cortex reads through this contract and never writes. Saving goes through the vault's own API, called by the agent.

Built in `src/vault.mjs`, with a folder vault that answers it: a folder of Markdown files, `<channel>/<block>.md` or `<channel>/<sub>/<block>.md` (the channel `channel/sub`, which also counts in `channel`), each block known by its `id` property (or its path, when it has none). In a folder a block is in the one channel it is filed in. `changes` takes a cursor the vault gave earlier and cortex keeps in `.cortex/vault-cursor.json` without looking inside. `profile` answers nothing yet for a folder. The person connects one with `cortex vault connect <folder>`, which writes `.cortex/vault.json`. A vault with a reader of its own is connected with `--module <file>`: `.cortex/vault.json` then says `{ kind: 'module', module, path }`, and cortex loads that file the first time it asks the vault anything and reads through the `openVault({ path })` it exports, checked against the contract (`moduleVault` in `src/vault.mjs`). Cortex imports nothing from a vault; the person names the file. ohm-vault's reader is `vault/cortex.mjs`: it counts only blocks (not channel files, entities or sources), includes the blocks of the folders the vault reads, keeps this folder vault's IDs, channels, cursor and hashes, and writes nothing.

Each time the cortex is opened (`cortex_start`, or `cortex vault sync`), cortex:
- rewrites the counts in `vault.md`, keeping every word written about a channel, the person's own lines and any intro above the first channel;
- records as observations what an agent has to act on: a channel `vault.md` does not describe yet, a channel that left the vault, and a block a memory points at that moved or was removed;
- reports memories pointing at blocks that are no longer there.

A block saved in a known channel needs nothing and is not recorded. With a vault connected, identity evidence from the vault must name a block that exists and quote a passage it contains.

## History: the journal

`.cortex/journal.jsonl` is one append-only file, written by `src/journal.mjs` alone. Each line has `seq`, a unique `id`, `at`, `actor` (`{kind: human or agent, name}`: the person and the signed-in account are human, everything else is an agent by its name), `session` when there is one, and `type`:

| `type` | Written when | Holds |
| --- | --- | --- |
| `change` | The person or an agent writes a node | `node`, `op` (create, update, remove, restore), `before` and `after` versions, `reason`, `evidence`; `restores` or `reverts` for an undo; `proposedBy` for a confirmed identity fact or an approved skill |
| `observation` | An agent or a host observes something | The observation's ID (`observation`), text, optional project and `evidence`. It changes no file. Lines written as `note`, with the ID in `note`, read as observations |
| `settled` | Observations are settled | The observation's ID and its outcome: kept, dropped, or a memory's name |
| `session` | An agent finishes or gives up a task | `summary`, `outcome` (done or stopped), `made` (the IDs of its changes), `deadEnds` (each with `id`, `tried`, `why`, and `check`, a command to recheck it), `resolved`, `project` |
| `save` | The person or an agent names a point | `name` and `note`. It changes nothing. Lines written as `stamp` read as saves |

A cortex made before the journal is still read: `.cortex/notes.jsonl` and `.cortex/sessions.jsonl` are read first and never written again. `proposal` and `decision` lines, written while agents' edits waited for the person, are read and kept, and change nothing; a `decision` about a note reads as `settled`. The journal is marked `merge=union`, and since every line has its own ID, two machines' lines join without a conflict; lines that share a `seq` after a merge are ordered by time, then ID.

**Agents edit directly; every change is marked with who made it; the person reverts.** An agent's write is made at once: the replaced version is kept, and a change line records it under the agent's name, with its reason and evidence, and the write returns the change's ID. The person reads what agents did with `cortex history --actor agent` and undoes what they do not want with `cortex revert <change>` or `cortex restore <node> <version>`, each a new change of their own. What needs trust stays with the person, from the command line, since no MCP client is known to be the person: identity facts are proposed in `.cortex/identity.jsonl` and set by `cortex confirm` (or turned down by `cortex reject`), skills wait in `.cortex/proposed/skills/` for `cortex approve`, and tools are asked for in `.cortex/proposed/tools/`. The change a confirmation or approval makes is the person's, and names the agent in `proposedBy`.

`.cortex/history/` keeps every replaced version under its version, so any node can be read back:

- `cortex_history` (and `cortex history`) lists changes and saves, filtered by node or prefix, since a seq or a date, and by actor.
- `cortex_as_of` (and `cortex as-of`) reads a node as it was at a save, a date (the end of that day, in UTC), a time or a seq. An agent reading `identity` gets it as agents always do, without the birthdate.
- `cortex_save` (and `cortex save`) names this point with a note, and changes nothing.
- `cortex_restore` (and `cortex restore`) brings an earlier version back as a new change with op `restore`. `cortex_revert` (and `cortex revert`) undoes one change the same way, or removes the node if that change made it, and is refused once the node has changed again. Nothing in the journal is rewritten. An agent restores and reverts only what it may write: never identity, the playbook, a skill or a tool, never another agent's working memory, and never over channel words the person wrote.

**Sessions** are the agent's record, written when a task is done or given up. Nothing is captured for it: the hooks keep only their checkpoints in `.cortex/hooks.jsonl`, and `session-end` records nothing. Open dead ends (those no later session resolved) come back in `cortex_start`, and the session-start hook shows up to ten near the folder it starts in.

Observations and memories may cite `evidence`: pointers `{node, version}` or `{session}`. Cortex checks the shape, that a cited cortex node had that version, and, with a vault connected, that a cited block is still there. How much evidence makes a memory stays in the playbook.

## Rules enforced in code

1. Nothing in `agents/` or the git policy files is written by any cortex tool.
2. No tool writes inside `agents/secrets/`, and no tool returns a value from it.
3. An identity field changes only through the person's confirmation; proposals need a block ID and a passage.
4. Identity values are validated by type.
5. `memory/MEMORY.md` is generated, never written by hand or by a tool.
6. A save names the version it replaces; a stale version is refused.
7. Every replaced or removed file is kept in `.cortex/history/`.
8. A skill an agent wrote is not used until approved; an agent cannot add a tool or switch one on.
9. Every save records who made it: the person, or which agent. Every write to a file of the cortex is a `change` line in the journal.
10. An agent never writes, restores or reverts identity, the playbook, a skill, a tool or another agent's working memory, and never writes over channel words the person wrote. Every change it makes is marked as its own.
11. No cortex operation writes to the vault.

## What exists now, and what changes

Built in the `ohm-cortex` repository (now `cortex/` in ohmmmm) and tested (119 tests, run by CI on Node 20 and 22). Steps 1 to 7 and 9 are built; step 8 is not planned:

| Built | Keeps | Changes |
| --- | --- | --- |
| `cortex status [dir] [--json]`: identity, skill and tool proposals, observations, broken pointers, undescribed or gone channels, problems and working memory over 30 days old; each item says how to clear it | All | Done (step 5). Uses a read-only folder inspection, without syncing or generating files |
| The folder store (`src/folder.mjs`) | Memories, history, observations, skill proposals, tool proposals, identity, the vault | |
| The vault contract (`src/vault.mjs`), a folder vault, and `vault.md` (`src/vaultmap.mjs`): counts kept in step, meanings and conventions written by the agent with `cortex_describe_channel`, the person's words outranking them, observations for what moved or left, broken pointers reported, `blocks` on memories, `cortex vault connect` and `cortex vault sync` | All | Done (step 2). The folder kind, and the module kind that ohm-vault's reader uses |
| Strict identity (`src/identity.mjs`): fixed typed fields, proposals with evidence in `.cortex/identity.jsonl`, `cortex confirm`, `reject`, `clear` and `identity`, `init --account` | History of changes | Done (step 1). With a vault connected, vault evidence is checked against the block |
| Filing advice (`src/filing.mjs`): `cortex_file_advice` answers "how should I file this?" with up to three channels from `vault.md` (meaning, conventions, why it fits, matched by words), the approved skill that fits the kind, up to five related blocks from the vault's optional `search`, and one question to ask; it writes nothing. A `file-a-source` skill in the template, and a Filing section in the rulebook | All | Done (step 4). Matching is by words, not meaning |
| Memory kinds `person`, `preference`, `project`, `reference` | Rules for names, descriptions, versions | Drop `project` |
| Twenty MCP tools (ten at first), with `cortex_propose_identity` in place of `cortex_identity`; short instructions that send an agent to `cortex_start`, which returns the playbook; a `start` prompt; the files as `cortex://` resources; birthdate hidden from agents | All | Add working memory and filing advice; serve over HTTP |
| Working memory: one file per agent in `.cortex/working/`, `cortex_working` to rewrite your own, `cortex_distill` to record what was seen again and leave what is open, given in `cortex_start` and as `cortex://working/<agent>` resources; when something becomes a memory is in the playbook | All | Done (step 3). The working memory a distill replaces, or a clear removes, is kept; rewrites during a session are not |
| The hooks adapter (`src/adapter.mjs`, `hooks/`): `cortex hook session-start\|prompt\|stop\|session-end --agent <name>` read the folder with no network wait and never fail a session; session start gives the instructions, playbook, identity without birthdate or proposals, memories marked always, the index and working memory, within 9,999 characters for Claude Code and 6,000 for Codex; stop asks for `cortex_distill` once for each change of working memory not distilled, matched by version and session in `.cortex/hooks.jsonl` (and the older `.cortex/sessions.jsonl`); session start adds the open dead ends near its folder; session end records nothing; `cortex install-hooks claude-code\|codex` prints the snippet | All | Built (step 7), tested with synthetic hook inputs. Not yet run in a signed-in Claude Code or Codex |
| Commands `init`, `mcp`, `identity`, `confirm`, `reject`, `clear`, `approve`, `event` | All | `event` takes structured vault events; add `status` |
| The rulebook in `agents/AGENTS.md`, with the identity policy | Secrets, git and identity sections | Rewrite around filing and working memory |
| Git policy files, with `.cortex/identity.jsonl` as append-only | Both | |
| MCP over HTTP (`src/http.mjs`): the Streamable HTTP transport of the initialize-based revisions at `/mcp`, a session ID from `initialize`, tools and agent name for each session, answers as JSON, a bearer token from `cortex token` in `agents/secrets/mcp-token`, `cortex serve` bound to 127.0.0.1 unless told otherwise | All | Done (step 6), with a token. OAuth for ChatGPT and Claude's web connectors, TLS and hosting are not built |
| The journal (`src/journal.mjs`): `.cortex/journal.jsonl` with `change`, `observation`, `settled`, `session` and `save` lines, each with seq, ID, time and actor; the old `notes.jsonl` and `sessions.jsonl` still read, `stamp` lines read as saves, and `proposal` and `decision` lines from before the reversal read and ignored; `merge=union` | All | Done (step 9; step 2 of [journal-and-history.md](journal-and-history.md)) |
| Cortex files as nodes (`identity`, `playbook`, `memory/<name>`, `working/<agent>`, `skill/<name>`, `tool/<name>`, `channel/<path>`), each with change lines, kept versions, `cortex_history`, `cortex_as_of`, `cortex_save`, `cortex_restore` and `cortex_revert`, and the commands `history`, `as-of`, `save`, `restore` and `revert` | All | Done (step 9; step 3 of journal-and-history.md). `memory/MEMORY.md` and the counts in `vault.md` are derived and not nodes. Working memory rewritten within a session is not kept, so `cortex_as_of` says so |
| Agents edit directly: `cortex_remember`, `cortex_forget`, `cortex_settle`, `cortex_describe_channel`, `cortex_working`, `cortex_restore` and `cortex_revert` write at once, each a change marked with the agent; the person reverts with `cortex revert` and `cortex restore`, with `--reason`; identity, skills and tools still wait for `confirm`, `reject` and `approve` | All | Done. Replaces, on 19 November, a day of every agent edit being a proposal |
| Sessions and dead ends: `cortex_session`; open dead ends in `cortex_start` and, near the folder, at session start; hooks' checkpoints in `.cortex/hooks.jsonl`, not committed | All | Done (step 5 of journal-and-history.md) |
| Evidence on observations and memories: `{node, version}` or `{session}`, checked for shape and, where cortex can look, that it exists | All | Part of step 4 of journal-and-history.md. Settlement rules per kind and staleness are not built |
| The person's operations for the app (`src/folder.mjs`): `readSkill`, `writeSkill`, `removeSkill`, `proposedSkills`, `declineSkill` (moved to `.cortex/declined/skills/`), `readTool`, `writeTool` (`on`, and what it says), `proposedTools`, `textAt`; each a change through `edit`, refused to an agent. The bridge's cortex routes are built from them ([home/cortex-routes.mjs](../../home/cortex-routes.mjs)) | All | Done 2026-11-24 |
| Blocks and channels: the vault contract, `vault.md`, `cortex_start`, filing advice and status speak of channels and blocks; memories point at `blocks`; `cortex_describe_channel` | All | Done. `posts`, an identity source's `post`, old `vault.md` files and cursors are still read; `cortex_describe_section` still answers, unlisted |

## Build order

1. **Identity.** *Done.* Fixed fields, validation, `.cortex/identity.jsonl`, proposals with evidence, `cortex confirm`. Done when a proposal without a block and passage is refused, a confirmed field is not overwritten by a proposal, and pronouns cannot be proposed from anything but the person's own words.
2. **Vault contract and `vault.md`.** *Done.* The contract as an interface, a folder vault that implements it for tests, structured events, and `vault.md` kept in step. Done when removing a block in the test vault flags the memory that pointed at it.
3. **Working memory.** *Done.* One file per agent, a tool to update its own, refresh at start and distill and merge at end, with the rules for when something becomes a memory in the playbook. Callable without hooks. Done when something noticed in two sessions becomes a memory in the third, with nobody asked.
4. **Filing rules and advice.** *Done.* The rulebook rewritten, a filing skill template, and a "how should I file this" answer built from `vault.md` and skills. Done when the answer for a source names a channel, its conventions and related blocks, and nothing is written to the vault.
5. **`cortex status`.** *Done.* Everything waiting or broken, in one answer. Every item it lists has a way to clear it.
6. **Remote MCP over HTTP,** *Done, with a bearer token; OAuth waits for a decision.* With sign-in, so ChatGPT and browser clients can reach a cortex. Done when a client connected over HTTP reads the playbook as its instructions and calls `cortex_start`.
7. **The hooks adapter.** *Built; the run in a real client is still to do.* `cortex hook <moment>` for Claude Code, then Codex, answering from the folder with no network wait. Done when, with neither model calling a tool, a session starts with working memory refreshed and ends with it distilled.
8. **Sync with a host.** *Not planned.* On 14 November 2026 the person decided to keep the cortex a folder of its own, not connected to ohm. The design looked at was an exact copy of the cortex files kept on ohm and synced both ways. It is kept here in case that changes.
9. **The journal and history.** *Done: steps 2, 3 and 5 of [journal-and-history.md](journal-and-history.md), and evidence on observations and memories from its step 4.* One journal; cortex files as nodes; every change marked with who made it; history, as-of, save, restore and revert; sessions with dead ends. Done when every change can be listed with who made it, any node can be read as it was at a save, a date or a seq, a restore or revert is a new change, and the person can undo any change an agent made.

Steps 4 to 7 were built in parallel from the briefs in [handoff/](handoff/README.md).

What is left to verify: step 7 in a real Claude Code or Codex session, and step 6 from a client on another machine. OAuth for step 6 needs a public address and a sign-in, and waits for a decision.

Already done outside this order: short MCP instructions that send an agent to `cortex_start`, the playbook returned from it, a `start` prompt, and the cortex's files as resources, over standard input and output.

## Outside cortex

Nothing outside cortex is needed for what is built. The hooks read the folder directly, so they need no key, and the person confirms identity, skills and tools with commands. ohm-vault answers the vault contract for its own folder (its `vault/cortex.mjs`), which the person connects with `cortex vault connect <folder> --module <file>`; cortex imports nothing from it.

Not planned, since cortex is not connected to ohm's service:
- implementing the vault contract over ohm's vault service;
- an ohm-issued agent key;
- showing this cortex in ohm's editor.

A vault kept as a folder of Markdown works today through the folder vault.

## Decided

On 14 November 2026:

- **Working memory is one file per agent,** merged when it is distilled.
- **The agent writes `vault.md` meanings without the person.** The person can edit them, and their words outrank the agent's.
- **Birthdate is hidden from agents.** An agent knows one is on file, and asks the person when a task needs it.
- **When something becomes a memory is in the playbook,** as judgement, not a session count in code.
- **The playbook reaches agents over MCP,** because cortex does not run the agent and clients do not read its files: short instructions send the agent to `cortex_start`, which returns it. Hooks make it certain where a client has them.
- **Cortex is not synced with ohm.** It stays a folder of its own, and reads an ohm vault only through the vault contract. The older cortex in ohm-content-layer (now ohm-vault) has been removed.

On 19 November 2026, building steps 2 and 3 of [journal-and-history.md](journal-and-history.md), and then as the owner decided its details:

- **One journal, `.cortex/journal.jsonl`,** for changes, observations, settlements, sessions and saves. The old `notes.jsonl` and `sessions.jsonl` are read and never written. Lines carry their own IDs so a union merge is safe; lines sharing a `seq` are ordered by time, then ID.
- **A point named in history is a save, not a stamp.** It changes nothing. Lines written as `stamp` read as saves.
- **No traces.** Nothing records what an agent read or searched. Evidence pointers are `{node, version}` and `{session}`.
- **Cortex files are nodes,** named `identity`, `playbook`, `memory/<name>`, `working/<agent>`, `skill/<name>`, `tool/<name>` and `channel/<path>`. `memory/MEMORY.md` and the headings and counts in `vault.md` are derived from other things, so they are not nodes. A `{node, version}` pointer whose node does not match this naming is a block in the vault.
- **Agents edit directly; every change is marked with who made it; the person reverts.** This replaces "every edit goes through the person", which had made each agent edit a proposal the person accepted with `cortex accept`; the owner reversed it the same day. An agent's write is a change at once, under its name, with its versions before and after and an optional reason, so its edits show in history as its versions, and the person reverts or restores what they do not want. `proposal` and `decision` lines already written are read and change nothing.
- **What needs trust stays the person's, as before this branch.** Identity facts are proposed with evidence in `.cortex/identity.jsonl` and confirmed or rejected with `cortex confirm` and `cortex reject`; a confirmation is the person's change, naming the agent in `proposedBy`, and a rejection is kept in `identity.jsonl` alone, since it changes nothing. Skills wait in `.cortex/proposed/skills/` for `cortex approve`, which is a change too. Tools are asked for in `.cortex/proposed/tools/`, and only the person adds or switches one on. An agent never restores or reverts these nodes either, since an earlier version of a tool could switch it on.
- **Confirming and approving are command-line only.** The MCP server cannot tell the person from an agent: it names the actor by what connects, and an agent can never take the person's name, but nothing proves a client is the person. So no MCP tool confirms or approves.
- **Settling rewrites each memory it touches at once,** its rewrite and its seen count together as one change, and records what became of each observation as a `settled` line.
- **What the person wrote about a channel stands** against an agent's restore or revert, as against its writes.
- **Sessions group the changes an agent made in a task by their IDs.** They are the agent's own record, written with `cortex_session` when a task is done or given up.** A separate tool, not part of `cortex_distill`: a distill ends a session's working memory, and a session line ends a task, which may come several to a session or none. The hooks capture nothing; their checkpoints move to `.cortex/hooks.jsonl`, which git ignores because they belong to this machine's sessions. `session-end` records nothing.
- **A dead end stays open until a later session lists it in `resolved`.** Session start shows up to ten open ones whose project is the folder it starts in, inside it or above it, and keeps them before the full playbook when the budget is tight.
- **Revert undoes one change** and is refused once the node has changed again; restoring a version covers that case. Reverting a change that created a node removes it.
- **A date with no time means the end of that day, in UTC,** for `cortex_as_of`; for `cortex_history`'s `since` it means the start of that day. `since` as a seq means after it.
- **Every replaced file is kept,** now also the seen count's earlier version, `vault.md` before a count update, and skills whole, with the files beside them. A version only an old proposal line carried can still be read back from it.
- **Evidence is checked for shape and existence, never counted.** The counts are guidance in the playbook, as decided on 14 November.
- **The vault's words are block and channel.** Old names are still read; `cortex_describe_section` still answers but is no longer listed, so new sessions see one tool.
- **A failed change line fails the call,** after the file is written: the write stands and the call reports the error, rather than claim a change it could not record.

## Open decisions

- **The rest of the journal.** [journal-and-history.md](journal-and-history.md) steps 2, 3 and 5 are built, and evidence from step 4. Settlement rules per kind, staleness, the `~/Brain` layout and sync are not.

- **Whether a cortex can serve more than one identity,** such as a person and their company. The plan assumes one cortex per identity.
- **How a remote client signs in** to a cortex served over HTTP.
