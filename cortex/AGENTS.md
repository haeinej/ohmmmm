# For coding agents working on the cortex (`cortex/` in ohmmmm, formerly ohm-cortex)

This file is for agents changing this repository. The rulebook an agent follows when keeping someone's cortex is a different file: [template/agents/AGENTS.md](template/agents/AGENTS.md).

## What this is

Cortex is what a person's agents know about them, kept as a folder of Markdown files the person can read and change: their profile, the observations agents make while working with them, their skills and their tools. The vault is the source of truth; cortex holds no content of its own. Read [docs/model.md](docs/model.md) before changing anything. It is the specification. [docs/plan.md](docs/plan.md) holds the decisions before it; where the two differ, model.md stands.

## The rules

1. **Cortex does not run an agent; agents read it over MCP.** ChatGPT, Claude and coding agents never open the folder. The server's instructions are one paragraph under 512 characters that sends an agent to `cortex_start`; that call returns the playbook. Keep the instructions short, and put anything else an agent must know in the playbook.
2. **Folder first.** The files are the cortex. Do not add a database, a hidden second copy, or anything a person could not read by opening the folder.
3. **Cortex never writes to a vault.** It reads through the vault contract in the plan. Saving content is the vault's job.
4. **Standalone.** Do not import from `vault/` or any host. A host's vault reaches cortex only through the vault contract (`src/vault.mjs`), as a module the person names. No runtime dependencies without a reason written in the commit message; today there are none.
5. **The agent's limits are enforced in code, not only in the rulebook.** No tool writes to `agents/`, `agents/secrets/`, the git policy files or the profile. No tool approves a skill, adds or enables a tool, accepts a profile line, or pins an observation. An agent changes an observation only when it is its own and as it left it.
6. **Agents write; every change is marked with who made it; the person can change anything.** Every write, by the person or an agent, is a `change` line naming its actor. The profile, skill approval and tools stay the person's.
7. **Nothing is lost.** Every replaced or removed file goes to `.cortex/history/`, and every change is a line in `.cortex/journal.jsonl`, written only through `src/journal.mjs`.
8. **Private and synthetic.** Tests and examples use invented people. Never put a real person's details in this repository.

## Layout

```
src/core.mjs       names, versions, the Markdown property format, the Refused error
src/journal.mjs    the journal: the one writer of .cortex/journal.jsonl, its line types, and actors
src/vault.mjs      the vault contract, and a folder vault that answers it
src/folder.mjs     the folder store: profile, observations, skills, tools, nodes, history, sessions, migrate
src/tools.mjs      the MCP tools an agent is given, built only from folder operations, and the server's instructions
src/adapter.mjs    the hooks: what session-start, prompt, stop and session-end answer
src/filing.mjs     filing advice
src/status.mjs     what is waiting for the person
src/prompts.mjs    the prompts a person can pick, such as start
src/resources.mjs  what a client may read without a tool: the playbook, the profile, observations, skills, tools
src/protocol.mjs   MCP over standard input and output; src/http.mjs over HTTP
bin/cortex.mjs     the command line: init, migrate, mcp, vault, profile, accept, observe, history, restore, revert, and more
template/          what a new cortex starts as
test/              node --test
docs/model.md      the specification: four parts, who may change what, the hooks
docs/plan.md       the decisions before model.md, and its build order
docs/guide.md      the words, evidence and history, explained for people and agents
```

## Working here

- Node 20 or newer. No install step.
- Run `npm test` after every change, and add a test for every rule you enforce. A test names the behaviour in plain words.
- Errors an agent may see are `Refused` with a code and a message that says what to do next.
- Keep the plan true: when you build a step, update its row in "What exists now" and mark it done in the build order.
- Work on a branch and open a pull request. Do not push to `main`. CI runs `npm test` on Node 22 for every pull request; the cortex itself still runs on Node 20 or newer.
- If you were given a brief in [docs/handoff/](docs/handoff/), work only on it, and follow its rules for the files shared with other agents.
