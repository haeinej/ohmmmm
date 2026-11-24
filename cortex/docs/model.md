# The cortex, made minimal

**Status:** agreed and built in cortex, 2026-11-20. It replaces the identity, memory, working memory, settlement and inference parts of [plan.md](plan.md), [guide.md](guide.md) and [journal-and-history.md](journal-and-history.md); where they differ, this stands. The journal, history, skills, tools, hooks and MCP server stay. The open decisions below were taken as proposed. Built differently from the first draft: an agent's tool for removing its own observation is `cortex_observe` with `remove`, and the account's public profile is read by the host (ohm), since cortex never waits on the network.

## In one paragraph

The cortex is what your agents know about you. It has four parts: your **profile**, the **observations** your agents make as you work with them, the **skills** they use, and the **tools** they may use. Memory builds itself: hooks in your agents ask them to write down what they learned, and that becomes observations. There is no separate memory, inference or settlement layer. The model reads your profile and observations when it needs them and draws its own conclusions each time. **You can edit everything.** Agents can only add observations and propose things. Every change is logged with who made it and can be undone.

## Principles

1. **You are the centre.** Everything in the cortex is about you, for you, or acts for you.
2. **You can edit everything.** No part is read-only to you. Your edit always wins.
3. **Less design, more model.** Store what was seen, not conclusions. The model works conclusions out when it reads.
4. **Memory comes from use.** You never have to write it. Hooks capture it as you work with agents.
5. **Agents touch your writing only where you let them.** By default an agent can't edit a block, link two blocks, or change your profile: it writes observations, which can *point at* blocks, and it proposes. You can grant an agent write or link on chosen channels (`ohm vault grant`); every change it makes there is journaled, its old version kept, and undone with `ohm vault restore`. The profile stays yours alone.
6. **Everything has a history.** The journal records every change and who made it, and any change can be reverted. This part exists today and stays.

## The four parts

| Part | What it is | Agents may | You may |
| --- | --- | --- | --- |
| **Profile** | Who you are: your account, plus your preferences and goals | Propose an addition | Edit all of it |
| **Observations** | What agents learned while working with you, about you and about your vault | Add; edit or delete their own | Edit, delete, write your own |
| **Skills** | How to do things your way | Propose | Approve, edit, remove |
| **Tools** | What agents may act with | Ask for one | Switch on and off, edit |

### Profile

The profile replaces `identity.md` and its fixed list of 15 fields.

**Account part**: your AT Protocol account. It is read live from your PDS, so the cortex never holds a copy that goes stale.

| Field | Where it lives | Editing it |
| --- | --- | --- |
| DID | Your DID document | Never changes. The profile's anchor |
| Handle | Your DID document and PDS | Changed through your PDS (the account app) |
| Display name, bio, avatar | Your public profile record (`app.bsky.actor.profile`) on your PDS | Edited in ohm; saved back to your PDS. Public, as it is today |

**Your part**: private, in `profile.md`, plain Markdown under three headings you can rename or add to:

```markdown
## Preferences
- Keep drafts to short paragraphs.
- New things start private.

## Goals
- Ship the workspace by December.

## Notes
- Prefers to be called Mira.
```

The model reads all of it at the start of every session. An agent can **propose** a line, for example after you said "always keep titles short". You see the proposal and accept, edit or decline it. Agents never write `profile.md` themselves.

Fields that used to be private (emails, city, birthdate, timezone) go away as fields. If you want an agent to know one, you write it under Notes.

### Observations

Observations replace `memory/`, settlement and inference. They are the cortex's memory, and you can see all of it.

**How they are made (hooks):**

| Moment | Hook | What happens |
| --- | --- | --- |
| Session starts | `SessionStart` | The agent gets your profile, your skills and tools, and the recent and relevant observations |
| You send a prompt | `UserPromptSubmit` | Up to five older observations that match the prompt's words, beyond the ones session start gave, each once a session, so a long history stays useful |
| A turn ends | `Stop` | From the second turn, if nothing was recorded yet, the agent is asked to record what it learned with `cortex_observe`: corrections, what was wrong or missing or out of date, repeated requests, preferences. Asked again after eight more turns with nothing recorded, at most four times a session |
| Session ends | `SessionEnd` | Nothing. The agent's turn has already ended, so it can't be asked |

Agents can also record an observation whenever they notice something, without waiting for the hook.

**What one is:** one file per observation, `observations/<id>.md`, so you can read and edit them like everything else.

```markdown
---
at: 2026-11-18T10:42:00Z
by: claude-code          # the agent, or "you"
session: claude-12
about: [block:3m2k…, block:3m2p…]   # optional: blocks or channels it is about
---
The slowness essay and the Yanaka photos were written in the same week, about the same walk.
```

- **About you:** no `about`. For example, "Shortens titles to three words."
- **About one block or channel:** extra context on it. It shows in that block's connections card, and the agent sees it when it reads the block.
- **About two or more blocks:** it also **connects them**. In the graph that's an observed connection, drawn green; hover it to read the observation. It never becomes one of your links. If you connect the blocks yourself, that connection is yours.

- **A flag for the curator:** `needs: curator` on an observation about a block or channel asks the curator, the one agent that settles labels, channels, moves and merges with you, to take it up. The curator answers with an observation of its own whose `settles` names the flags and whose text says what you decided; `cortex_recall` with `needs: curator` lists the flags not yet settled. A settle names the flag at the version it answered, so a flag rewritten with a new question is open again, and its author withdraws it by rewriting it with `needs: null`. The cortex cannot tell a curator subagent from the agent it runs in, so a flag counts as settled only by you (`cortex observe … --settles <id>`) or by an agent with another name than the one that raised it; the curator is refused a flag raised under its own name and asks you to settle it.

**Editing:** you can change the text, change what it's about, delete it, or write one yourself (`by: you`). Deleting an observation removes the connections it made. An agent may edit or delete only its own observations, and only while you haven't edited them.

**Reading many:** observations only grow. `cortex_start` gives the most recent ones plus any marked by you as always relevant (`pin: true`). `cortex_recall` searches them by words or by block. Old ones are never thrown away automatically; you delete what you don't want.

**Vault descriptions fold in here.** What `vault.md` said about a channel ("walk photos, filed by date") becomes an observation about that channel. One kind of note instead of two.

### Skills

Unchanged. `skills/<name>/SKILL.md`. Agents propose, you approve, and you can edit or remove any skill.

### Tools

Unchanged. `tools/<name>.md`. You switch each on or off. Agents can only ask.

## The folder

```
cortex/
├── profile.md          your part of the profile (the account part is read live)
├── observations/       one file per observation
├── skills/             <name>/SKILL.md
├── tools/              <name>.md, each on or off
├── agents/             AGENTS.md (the rulebook) and secrets/
└── .cortex/            journal, history, hook bookkeeping (machinery)
```

Gone: `identity.md`, `memory/` and its `MEMORY.md` index, `vault.md`, and per-agent working memory in `.cortex/working/` (see open decision 2).

## In the graph

- **You** in the middle: your avatar, from the account part of your profile.
- **Observations about you** sit close around you, joined to you.
- **Your blocks** gather further out, by channel. Your own links are grey lines.
- **Observed connections** are green lines between blocks an observation is about.
- **Skills and tools** sit close around you, like observations about you.
- White, grey and ohm's green only. No areas, no legend, and the words "cortex" and "vault" are never shown.

## Who may change what

| | Profile (account) | Profile (yours) | Observations | Skills | Tools |
| --- | --- | --- | --- | --- | --- |
| You | Edit (saves to PDS) | Edit | Edit, delete, add | Approve, edit, remove | On, off, edit |
| An agent | Read | Read; propose a line | Add; edit or delete its own | Propose | Ask |

Every change by anyone is a journal line with who, when and why, and can be reverted.

## Rewiring: what changes where

### cortex (this folder)

| Today | Becomes |
| --- | --- |
| `src/identity.mjs`: 15 fixed fields, propose/confirm/reject | `src/profile.mjs`: reads the account from the PDS (given by the host or fetched by DID); reads and writes `profile.md`; keeps proposals for lines |
| `memory/`, `MEMORY.md`, `cortex_remember`, `cortex_forget`, `cortex_settle`, evidence-count rules | `observations/`, `cortex_observe` (now with `about`), `cortex_recall` over observations, edit and delete for an agent's own |
| `cortex_working`, `cortex_distill`, `.cortex/working/` | Removed, or kept as hidden scratch (open decision 2) |
| `vault.md`, `cortex_describe_channel` | Observations about channels. `cortex vault sync` writes moved and removed blocks as observations, as it partly does now |
| `cortex_propose_identity`, `confirm`, `reject`, `clear` | `cortex_propose_profile` (a line under a heading); the person accepts in ohm or with `cortex profile accept` |
| Journal types `change`, `observation`, `settled`, `session`, `save` | `change`, `session`, `save`. An observation is a node now, so creating it is a `change`. Old `observation` and `settled` lines are still read |
| Hooks: `stop` asks to distill when working memory changed | `stop` asks once to record observations when the session has new ground |
| Template: `identity.md`, `memory/working-style.md` | `profile.md` with the three headings, an empty `observations/` |

**Tools after the change:** `cortex_start`, `cortex_observe`, `cortex_recall`, `cortex_propose_profile`, `cortex_skill`, `cortex_propose_skill`, `cortex_propose_tool`, `cortex_file_advice`, `cortex_session`, and the history tools (`cortex_history`, `cortex_as_of`, `cortex_save`, `cortex_restore`, `cortex_revert`). That's 14, down from 20.

**Migration:** a one-time `cortex migrate`:
- each memory becomes an observation, keeping its blocks as `about` and its history;
- stated memories that read as preferences or goals become proposed profile lines;
- `identity.md` fields become Notes lines;
- `vault.md` channel notes become observations about channels.

### app (the workspace)

- **Sample data:** cortex docs become a profile, observations (some about you, some about blocks), skills and tools. Memory and inference items go.
- **Tree:** the cortex side shows Profile, Observations, Skills and Tools.
- **Editing:** the profile, observations, skills and tools all open in the editor and save like blocks.
- **Graph:** you in the middle from the profile, observations and observed connections as above (`src/graph/model.ts` and `GraphView.tsx`).
- **Connections card:** observations about a block, with the text on hover.
- **History:** the cortex timeline reads the same journal, now without settlements.
- **WebMCP:** the history tools stay. Editing an observation is a new step with its own tool, per the app's rules.

### ohm-onboarding (the account app)

- **Writing the public profile** (display name, bio, avatar) to the PDS needs an OAuth scope for `app.bsky.actor.profile`. Profile import already reads it.
- **Keys:** syncing the private profile and observations to ohm uses the existing private layer (`packages/keys`, sealed files). No new key work.

### vault

- **Sync:** observations and `profile.md` are private files. When a cortex syncs to ohm, they go into the private, end-to-end encrypted store, like private blocks.
- **Graph:** observed connections are read from observations, never written as vault evidence. `contract/vault-reader.mjs` doesn't change.

## AT Protocol Spaces

**Where it stands (checked 2026-11-20):**
- **Status:** [proposal 0016](https://github.com/bluesky-social/proposals/blob/main/0016-permissioned-data/README.md) describes itself as a proposal, not the final spec. Its implementation ([atproto#5187](https://github.com/bluesky-social/atproto/pull/5187)) is a draft, last updated 2026-11-16, so it's still moving.
- **What a space is:**
  - It's named by an authority DID, a space type and a key.
  - Each member writes their records into their own space repo on their own PDS.
  - Apps read with short-lived credentials from the authority.
- **Personal spaces:** use your own DID as the authority, for things like bookmarks, mutes and drafts.
- **Group spaces:** have a member list or an app that decides access.
- **No end-to-end encryption.** The proposal says so outright: your PDS and the apps you authorise can read what they handle.

**What it means for the cortex:**

| Part | Where it should live | Why |
| --- | --- | --- |
| Profile, account part | Your public PDS profile, as now | It's already public and already AT Protocol |
| Profile, your part | Private, end-to-end encrypted layer | Preferences and goals are personal; a personal space would let your PDS read them |
| Observations | Private, end-to-end encrypted layer | The most sensitive part: what agents learned about you |
| Skills, tools | Could move to a personal space later | Not very sensitive, and a space would make them portable across apps that speak AT Protocol |

So Spaces doesn't replace the private layer. That matches what ohmmmm decided on 2026-11-19 (see [vault/plans/encryption.md](../../vault/plans/encryption.md)). Spaces could still matter in three ways:

1. **The Friends layer** could move from the vault service into a group space once spaces ship, as `encryption.md` already notes.
2. **Shared cortex:** a group space could hold observations a team shares, such as how a project works. That's later, and only for what isn't private.
3. **Portability:** the cortex's shapes should be written as AT Protocol records (lexicons such as `com.ohmmmm.cortex.observation`), even while they're stored in sealed files. Then moving any part into a space later is a change of storage, not of shape.

**Re-check before building on Spaces:** the scope names, which are being renamed ([atproto#5953](https://github.com/bluesky-social/atproto/pull/5953)), and whether personal spaces end up with any encryption.

## Decisions taken

1. **When the Stop hook asks for observations:** from the second turn, unless the agent already wrote one in that session; then again after eight more turns with nothing recorded since the last ask, at most four times a session (changed 2026-11-23, so a long session's later corrections are not lost).
2. **Working memory:** removed. Observations cover it.
3. **Agents editing their own observations:** allowed until the person or another agent has changed one, through cortex or by hand.
4. **How many observations `cortex_start` gives:** the 30 most recent plus the pinned ones.
5. **Profile proposals:** accepted in ohm or with `cortex accept`.
6. **Lexicons:** `com.ohmmmm.cortex.*` lexicons are written when the cortex first syncs to ohm, so storage can change later. Not written yet.
