# The cortex

ohmmmm's `cortex/`, formerly the separate repository ohm-cortex (archived).

What an agent knows about the person it works for, and what it can do for them, kept as a folder that person can read and change.

Cortex is separate software. It does not need ohm, a vault, or any one coding agent. A host such as ohm can store and sync a cortex, and any agent can keep one through the MCP server or the hooks adapter.

## A cortex

```
cortex/
├── profile.md      who it belongs to: the account, and their preferences, goals and notes, in their words
├── observations/   what agents learned working with them, one file each
├── skills/         <name>/SKILL.md, in the form coding agents already read
├── tools/          the list of what the agent can do, each on or off
└── agents/         AGENTS.md, the rulebook for keeping this cortex, and secrets/
```

For the person it is four things: who I am, what my agents have learned about me and my vault, what they know how to do, and what they are able to use. [docs/model.md](docs/model.md) is the design.

## Who may change each part

| Part | Where | Agents may | The person may |
| --- | --- | --- | --- |
| Profile | `profile.md` | Read it every session, and propose a line | Edit all of it; accept or decline a proposed line |
| Observations | `observations/<id>.md` | Add one at once; rewrite or remove their own until the person changes it | Edit, remove, pin, or write their own |
| Skills | `skills/` | Propose one | Approve, edit, remove |
| Tools | `tools/` | Ask for one | Add, switch on or off |
| Rulebook | `agents/AGENTS.md` | Read it every session | Add their own rules |
| Secrets | `agents/secrets/` | Never read. Never committed | Put a secret there |
| Machinery | `.cortex/` | Never shown to the model directly | |

**Memory builds itself from use.** As people work with their agents, hooks in Claude Code and Codex hand the agent the profile and the observations at the start of a session, and ask it once, near the end, to write down what it learned. What it writes is an observation: about the person ("keeps titles to three words"), or about blocks and channels of their vault ("these two essays are about the same walk"). There is no memory, inference or settling layer behind it: the model reads the observations and draws its own conclusions each time.

**Agents write; every change is marked with who made it; the person can change anything.** Each write is a change in the journal under its writer's name, with a reason, and `cortex revert` or `cortex restore` undoes what the person does not want.

`.cortex/` holds what the person does not need to think about: the journal (every change, session and save, with who made it), earlier versions of every file, profile proposals, and the hooks' bookkeeping.

A cortex also carries `.gitignore` and `.gitattributes`, so that one kept in git never commits a secret, keeps the same line endings everywhere, and joins two machines' journals without a conflict.

## Words

Cortex uses ohm's words. A **block** is one unit of thought, and a published one is a **post**. A **channel** is an ordered collection of blocks, and a block can be in many. Only the person connects blocks. An **observation** that is about two or more blocks shows that they connect, as the agent saw it; it never becomes one of the person's links. [docs/guide.md](docs/guide.md) explains the words with examples.

## Use it

```bash
node bin/cortex.mjs init ~/cortex
```

Then connect an agent to it over MCP, with this as the server's command. When it connects, the agent is told to call `cortex_start`, which returns the cortex's playbook. It can also read the cortex's files as `cortex://` resources; secrets and birthdate are never served. In Claude Code, the `start` prompt appears as a slash command for beginning a session from your cortex.

```bash
node /path/to/cortex/bin/cortex.mjs mcp ~/cortex
```

| Command | Who runs it | What it does |
| --- | --- | --- |
| `cortex status [dir] [--json]` | The person | Lists everything waiting or broken, with how to clear each item; reads without changing files |
| `cortex init [dir] [--account <did>]` | The person | Starts a cortex in an empty folder, optionally with the signed-in account |
| `cortex migrate [dir]` | The person | Brings a cortex made before docs/model.md to profile and observations: identity.md becomes profile.md, memories and unsettled observations become observation files, vault.md becomes observations about channels, and working memory goes. Everything replaced is kept in history |
| `cortex vault connect <folder> [dir] [--module <file>]` | The person | Connects the vault kept in that folder. With `--module`, the folder is read by that file's `openVault({ path })`, such as ohmmmm's `vault/cortex.mjs` |
| `cortex vault [sync] [dir]` | The person or a host | Brings the cortex in step with the vault: its channels and counts, and an observation when a block observations are about moved or went |
| `cortex profile [dir]` | The person | Shows the profile and the lines agents proposed for it |
| `cortex account <did-or-handle> [dir]` | The person | Sets the account the profile belongs to |
| `cortex accept <id> [dir]` | The person | Adds a proposed line to the profile |
| `cortex decline <id> [dir]` | The person | Turns one down; that line is not proposed again |
| `cortex observations [dir] [--about <id>] [--json]` | The person | Lists what agents observed, newest first |
| `cortex observe <text> [dir] [--about <ids>] [--settles <ids>] [--pin]` | The person | Writes an observation of their own; with `--settles`, the decision that settles flags marked `needs: curator` |
| `cortex forget <id> [dir]` | The person | Removes an observation; it is kept in history |
| `cortex mcp [dir]` | An agent | Serves the fourteen `cortex_*` tools over standard input and output |
| `cortex serve [dir] [--port 8765] [--host 127.0.0.1]` | The person | Serves the same tools over HTTP at `/mcp`, for clients that connect to a server |
| `cortex token [dir] [--replace]` | The person | Makes the token HTTP clients sign in with, saves it in `agents/secrets/mcp-token`, and prints it once |
| `cortex approve <skill> [dir]` | The person | Moves a skill an agent proposed into `skills/` |
| `cortex event <text> [dir]` | A host | Records something from outside as an observation by the host |
| `cortex hook <moment> [dir] --agent <name>` | Claude Code or Codex, as a hook | Answers `session-start`, `prompt`, `stop` or `session-end` from the folder: the playbook, the profile, the observations and the open dead ends near its folder at the start; once a session, from the second turn, a request to write down what it learned; nothing at the end. Exits 0 and writes nothing on any error |
| `cortex install-hooks claude-code\|codex` | The person | Prints the hooks to add to that client's settings. Writes nothing |
| `cortex history [dir] [--node <node>] [--since <seq or date>] [--actor <name>] [--json]` | The person | Lists every change and save, with who made each |
| `cortex as-of <node> <save, date or seq> [dir]` | The person | Prints a node as it was then, such as `observation/<id>` or `profile` |
| `cortex save <name> <note> [dir]` | The person | Names this point in history. Changes nothing |
| `cortex restore <node> <version> [dir] [--reason <why>]` | The person | Brings a node back to an earlier version, as a new change |
| `cortex revert <change> [dir] [--reason <why>]` | The person | Undoes one change, an agent's or their own, as a new change |

An agent writes and finds observations (`cortex_observe`, `cortex_recall`), proposes profile lines, skills and tools, has the same history views as tools (`cortex_history`, `cortex_as_of`, `cortex_save`), restores and reverts what it may write (`cortex_restore`, `cortex_revert`), and records each task it finishes or gives up, with its dead ends, with `cortex_session`.

### Over HTTP

For a client that connects to a server rather than starting one, such as a coding agent on another machine. Make a token, then serve:

```bash
node bin/cortex.mjs token ~/cortex      # prints the token once; it is kept in agents/secrets/mcp-token
node bin/cortex.mjs serve ~/cortex      # http://127.0.0.1:8765/mcp
```

Every request must carry `Authorization: Bearer <token>`, or it is answered 401. `cortex serve` binds to 127.0.0.1 unless given `--host`, and with no token it refuses any other host. It does not do TLS: to reach it from another machine, put it behind something that does. Restart it after `cortex token --replace`.

Claude Code:

```bash
claude mcp add --transport http cortex http://127.0.0.1:8765/mcp --header "Authorization: Bearer $CORTEX_TOKEN"
```

Codex, in `~/.codex/config.toml`:

```toml
[mcp_servers.cortex]
url = "http://127.0.0.1:8765/mcp"
http_headers = { Authorization = "Bearer <token>" }
```

ChatGPT and Claude's web connectors sign in with OAuth, which is not built yet.

The folder is the one named, or `CORTEX_DIR`, or `~/cortex`. Files a person edits by hand are what the agent is given next.

## This repository

```
template/   what every new cortex starts as
src/        the rules, the folder store, the MCP protocol and the tools
bin/        the command line
test/       run with npm test
```

## Status

Built:
- the folder store: profile, observations, skills, tools ([docs/model.md](docs/model.md), 2026-11-20);
- `cortex migrate` from the earlier identity and memory design;
- the vault contract, with a folder vault;
- filing advice and `cortex status`;
- MCP over standard input and output, and over HTTP with a token;
- the hooks adapter for Claude Code and Codex;
- the journal: changes marked with who made them, sessions with dead ends, and saves; history, as-of, restore and revert;
- blocks and channels as the vault's words;
- the fourteen tools and the commands above.

The tests run against temporary folders, and CI runs them on Node 20 and 22 for every pull request.

Not yet tried: the hooks in a real Claude Code or Codex session.

Not built: OAuth for ChatGPT and Claude's web connectors; observations fitted to each prompt; reading the account's public profile (name, bio, avatar) from its PDS, which the host does for now; a webhook for observations from outside, beyond `cortex event`.

Not planned: syncing a cortex with ohm. A cortex stays a folder of its own. It reads an ohm vault through the vault contract, with `cortex vault connect <folder> --module <file>`; the first cortex that lived inside ohm's vault (then called ohm-content-layer, now ohm-vault) has been removed.

See [docs/model.md](docs/model.md) for the design, [docs/plan.md](docs/plan.md) for the decisions before it, [docs/journal-and-history.md](docs/journal-and-history.md) for the history design, and [docs/guide.md](docs/guide.md) for a guide.
