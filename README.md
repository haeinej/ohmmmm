# ohmmmm

A personal knowledge home on AT Protocol. What a person thinks and keeps (their **vault**), and what an agent knows about them (their **cortex**), in one folder they own, read by any agent, and published only when they say so.

```
ohmmmm.alice.example.com/
├── vault/     blocks and channels: what you think and keep. Canonical
└── cortex/    identity, memory, skills, tools: what an agent knows about you
```

This repository holds the vault, the cortex, and the app that brings them together.

| Folder | What it is |
| --- | --- |
| [`vault/`](vault/README.md) | The vault: blocks, channels, entities and sources as Markdown files; the `ohm` command; the vault service (Cloudflare Worker and D1); publishing to your PDS as `com.ohmmmm.post`; the Claude Code plugin |
| [`cortex/`](cortex/README.md) | The cortex: a folder an agent keeps about the person it works for; the `cortex` command, its MCP server and hooks |
| [`app/`](app/README.md) | The workspace app for exploring and editing a synthetic example home |
| [`home/`](home/home.mjs) | Naming, finding and making a home, `ohmmmm.<handle>` |
| [`contract/`](contract/vault-reader.mjs) | The vault reader contract: the one way cortex reads a vault |
| [`docs/words.md`](docs/words.md) | One word list for every part |

Sign-in, onboarding, agent grants and the keys of the private layer are in the account app, [ohm-onboarding](https://github.com/haeinej/ohm-onboarding).

## Three layers

Each block's `visibility` decides where it is kept and who can read it ([vault/plans/encryption.md](vault/plans/encryption.md)):

| Layer | Who reads it | Kept |
| --- | --- | --- |
| **Public** | Anyone | A `com.ohmmmm.post` on your PDS |
| **Friends** | You, the friends you chose, and the vault service | The vault service, readable, checked by DID |
| **Private** (the default) | Your devices only | The vault service, as ciphertext it cannot open |

Private blocks are sealed on your device. The service keeps them as `{ id, ciphertext, version }`: changes to several files land together or not at all, every version is kept for restoring, the journal of changes is sealed too, and rotating your key re-wraps all of it. The keys stay on your devices; the account app keeps only copies wrapped by your unlock passkeys and your recovery code.

## Start a home

Node 22.13 or newer.

```sh
npx github:haeinej/ohmmmm init alice.example.com   # makes ~/ohmmmm.alice.example.com
cd ~/ohmmmm.alice.example.com
npx github:haeinej/ohmmmm vault index               # the vault finds ./vault by itself
npx github:haeinej/ohmmmm cortex status             # the cortex finds ./cortex, and reads ./vault
npx github:haeinej/ohmmmm serve                     # the bridge for the app and local agents: open the link it prints
npx github:haeinej/ohmmmm pair                      # a link that pairs one more browser
npx github:haeinej/ohmmmm agents add claude-code    # a key of its own for an agent, shown once
```

`npx github:haeinej/ohmmmm` runs `bin/ohmmmm.mjs`: `init` and `where` are its own, `serve` starts the home's bridge on this machine, `pair` pairs another browser with it, and `agents` gives each agent its own key ([docs/serve.md](docs/serve.md)), `cortex …` goes to the cortex, and every other command to the vault's `ohm` (`vault`, `publish`, `sync`, `mcp`…), so commands written for ohm-vault still work. From a checkout, use `node bin/ohmmmm.mjs`, or `node vault/bin/ohm.mjs` and `node cortex/bin/cortex.mjs` directly.

Inside a home, or with `OHMMMM_HOME` set, the vault and the cortex each find their own folder, and a cortex reads its sibling vault through the vault's reader unless `.cortex/vault.json` names another. Either folder still works on its own.

Two MCP servers, both named `ohm-vault`, give agents the vault. `ohmmmm mcp` serves the service-backed tools for public posts and the Friends layer; it has no tool that adds a friend, and never returns private content. `ohmmmm vault mcp` serves the local vault in a home over stdio: search, read, neighbors, capture, collect and index ([vault/docs/agents/vault-format.md](vault/docs/agents/vault-format.md#mcp-entry-points)).

To use it from Claude Code, add this repository as a plugin marketplace; the plugin is the vault's ([vault/.claude-plugin/](vault/.claude-plugin/plugin.json)).

## How the parts meet

- **The vault is canonical.** Cortex never copies what a block says; its memories point at blocks by ID.
- **Cortex only reads the vault**, through `shape`, `read`, `exists`, `changes`, `profile` and optionally `search` ([contract/vault-reader.mjs](contract/vault-reader.mjs)). Saving content is the vault's own job.
- **History belongs to whoever owns what changed.** The vault keeps versions, the journal and daily autosaves for blocks and channels; cortex keeps its own pages' history.
- **Evidence and inference stay apart.** What the content shows (a channel holds a block, a block links to another) is the vault's; what a model concludes is a cortex node pointing at that evidence.

## Develop

```sh
npm ci --prefix vault && npm ci --prefix vault/service && npm ci --prefix app
npm test            # home, vault and cortex tests, then the app typecheck, build and tests
npm --prefix app run dev  # open http://localhost:5190
```

Read [AGENTS.md](AGENTS.md) first, then the guide for [vault](vault/AGENTS.md), [cortex](cortex/AGENTS.md) or [app](app/AGENTS.md).

## Where this came from

This repository joins three projects with their full histories. The original `haeinej/ohm-vault` was renamed `haeinej/ohmmmm` and now lives in `vault/`. The archived `haeinej/ohm-cortex` lives in `cortex/`. The workspace from `haeinej/ohm-ux` lives in `app/`, and ohm-ux is retired: change the workspace here. Use `git log -m --follow -- app/src/App.tsx` to trace a file into its original repository.

## Status

- Built and tested locally: the home, the shared contract, the vault and its service, the friends layer, the private store, and the cortex.
- The [app](app/) still runs on sample data. The private store awaits deployment, migration and integration with the account app.
