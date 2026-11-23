# ohm workspace app

User flows for ohm, built so that a person and an agent can both complete them.

A person moves through screens built from the [ohm design system](https://design.ohmmmm.com/overview). An agent in the browser calls the same steps as [WebMCP](https://webmachinelearning.github.io/webmcp/) tools that the page registers. Both use the same code, the same validation and the same end state, and anything lasting waits for the person's approval.

## Why both

An agent that clicks through pixels is slow and fragile. It can also do things the person never meant. WebMCP lets the page say exactly what can be done at each step and run it with its own code. Pairing each tool with a step that is on screen keeps the person able to see what's happening and in charge of what happens.

## The workspace

A light, Obsidian-like workspace over the signed-in member's own home, the first flow ([flows/workspace.md](flows/workspace.md)). **Production first:** it reads and writes the member's vault service and nothing else. There is no sample data in the app; synthetic fixtures live only in `test/fixtures/` for tests. Signed out, it shows sign-in.

- A **rack** on the page: search, new block, **home** (a pill with your picture and name; All, Cortex, Vault; visibility inside it), **inbox**, notifications, and you.
- A **side panel** card that becomes what the rack chose. The home has cortex and vault as checkable top-level rows, and a **graph** inside it. In the graph a node is a block and an edge is a connect ([words](../docs/words.md#in-the-graph)): you are in the middle, blocks are coloured by their label and sized by their backlinks, and a connection an agent only observed is dashed and drawn apart. The cortex is a toggle, off by default. It behaves like Obsidian's: springy, with hover highlighting and drag.
- A **main panel** card where blocks and cortex files open in the editor:
  - **Path:** the block's path sits in a pill. Drag it out to save the block as `.md`, or onto a channel to move it there.
  - **Editing:** a `/` menu, a floating selection toolbar, and block handles with menus.
  - **Tables:** row and column handles.
  - **Dropping:** images go into the open block and Markdown files open as new blocks.

  Proposals from the inbox and settings open here too.
- An **inbox**: what agents captured for you waits in the channel `inbox` until you **Keep** it in a channel or **Decline** it. An agent can ask for either through WebMCP (`inbox.keep`, `inbox.decline`), and you approve it first.
- **Search** as a sheet over the workspace (⌘K). It goes through the `workspace.search` WebMCP tool's handler, and searches the same home as the editor and graph.

Channels are files (`_channel.md`) on the service, each with its own version. Renaming or moving one moves it with everything filed in it, at the service, then refiles the sealed blocks on this device; a channel with published posts in it moves through Publish instead.

New blocks start private: sealed on this device and sent as ciphertext, so writing needs a device that has unlocked the account's keys. Shared blocks (friends) and published posts are read and kept by the service. The cortex is sealed too, under its own context, and opens only on an unlocked device.

To try it, run the app on the same address as a vault service (`/vault/xrpc/…`) and sign in there. With no service, the workspace shows sign-in.

The editor saves pending typing when you switch blocks. Restoring a version or reverting a change loads the resulting text. Links to a draft keep working after you rename it.

```sh
npm ci --prefix app
npm --prefix app run dev   # http://localhost:5190
```

## Blocks, channels and history

Choose **New block** to start a private draft. Type a title in the editor and press Enter to start writing. The title saves as you type, and you can also change it with **Rename** on any of the block's rows. From a channel's menu, **New block here** uses that channel as the block's home. A block can appear in several channels, each with its own order. A post is a published block.

Choose **Home**, then **History**, to see changes by date or author: the sealed cortex journal, and the changes made on this device. A private block's clock opens the versions the service keeps. Cortex files have their own history. The connections card shows the observations an agent made about a block. The cortex holds your profile, observations, skills and tools, as in [cortex/docs/model.md](../cortex/docs/model.md).

## Where things are

- [flows/paths.md](flows/paths.md): every interaction path, what it is for, its end state, and the WebMCP tool for it
- [AGENTS.md](AGENTS.md): the rules every flow follows
- Install the app from the repository root with `npm ci --prefix app`. Run `npm --prefix app run build` to build it and `npm --prefix app test` to run its tests. Both use the app install.
- The editor, tree, graph, connections and search use the same home, from one source. [Data sources](docs/agents/home-source.md) describes the source contract, the service adapter and the test fixture.
- [docs/design.md](docs/design.md): the app's design layer: one radius for every surface, density, compact menus
- [docs/webmcp.md](docs/webmcp.md): the WebMCP API as of the 13 November 2026 draft, and what changed from earlier guides
- [flows/TEMPLATE.md](flows/TEMPLATE.md): start a new flow by copying this
- [src/webmcp.ts](src/webmcp.ts): the one helper for registering tools
