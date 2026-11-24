# ohm workspace app

User flows for ohm, built so that a person and an agent can both complete them.

A person moves through screens built from the [ohm design system](https://design.ohmmmm.com/overview). An agent in the browser calls the same steps as [WebMCP](https://webmachinelearning.github.io/webmcp/) tools that the page registers. Both use the same code, the same validation and the same end state, and anything lasting waits for the person's approval.

## Why both

An agent that clicks through pixels is slow and fragile. It can also do things the person never meant. WebMCP lets the page say exactly what can be done at each step and run it with its own code. Pairing each tool with a step that is on screen keeps the person able to see what's happening and in charge of what happens.

## The workspace wireframe

A light, Obsidian-like workspace, the first flow ([flows/workspace.md](flows/workspace.md)):

- A **rack** on the page: search, new block, **home** (a pill with your picture and name; All, Cortex, Vault; visibility inside it), **inbox**, notifications, and you.
- A **side panel** card that becomes what the rack chose. The home has cortex and vault as checkable top-level rows, and a **graph** inside it. The graph puts you in the middle, Obsidian-style, with cortex items (green diamonds) close around you and vault blocks (grey dots) further out, clustered by channel or category, and grey lines for links, connections and what the cortex drew from the vault. It behaves like Obsidian's: springy, with hover highlighting and drag.
- A **main panel** card where blocks and cortex files open in the editor:
  - **Path:** the block's path sits in a pill. Drag it out to save the block as `.md` (or a `.zip` with its images), or onto a channel to move it there.
  - **Editing:** a `/` menu, a floating selection toolbar, and block handles with menus.
  - **Tables:** row and column handles.
  - **Dropping:** an image becomes a media block of its own, as on Are.na, and the open block embeds it (`![[slug]]`). Markdown files open as new blocks.

  Inbox items and settings open here too.
- **Search** as a sheet over the workspace (⌘K). It goes through the `workspace.search` WebMCP tool's handler, and uses the same sample home as the editor and graph.

Renaming a sample channel keeps its record and updates its path throughout the tree and graph.

All data is synthetic. Run the app to explore a sample vault and cortex. Reloading restores the sample.

To try saving and searching, create a block titled “Alder lantern”, add a line of text, and open Search. Search for “Alder lantern” to find the same block you just edited. This workspace uses the sample adapter, so those edits last for the current session. The service adapter is available for integrating signed-in vault access in the app. Private service files require an unlocked device and reach the service as ciphertext.

The editor saves pending typing when you switch blocks. Restoring a version or reverting a change loads the resulting text. Links to a draft keep working after you rename it.

```sh
npm ci --prefix app
npm --prefix app run dev   # http://localhost:5190
```

## Blocks, channels and history

Choose **New block** to start a private draft. Type a title in the editor and press Enter to start writing. The title saves as you type, and you can also change it with **Rename** on any of the block's rows. From a channel's menu, **New block here** uses that channel as the block's home. A block can appear in several channels, each with its own order. A post is a published block.

Choose **Home**, then **History**, to see sample changes by date or author. A block's clock opens its own vault versions. Cortex files have their own history. The connections card shows the observations an agent made about a block, and a sample observation keeps the block versions it was written against. The cortex side holds Mira's profile, observations, a skill and a tool, as in [cortex/docs/model.md](../cortex/docs/model.md).

## Where things are

- [flows/paths.md](flows/paths.md): every interaction path, what it is for, its end state, and the WebMCP tool for it
- [AGENTS.md](AGENTS.md): the rules every flow follows
- Install the app from the repository root with `npm ci --prefix app`. Run `npm --prefix app run build` to build it and `npm --prefix app test` to run its tests. Both use the app install.
- The editor, tree, graph, connections and search use the same sample home. Create a private draft and add it to a channel to see it in the tree and find it in search. Sample changes live in memory and reset on reload. [Data sources](docs/agents/home-source.md) describes the sample and service contracts.
- [docs/design.md](docs/design.md): the app's design layer: one radius for every surface, density, compact menus
- [docs/webmcp.md](docs/webmcp.md): the WebMCP API as of the 13 November 2026 draft, and what changed from earlier guides
- [flows/TEMPLATE.md](flows/TEMPLATE.md): start a new flow by copying this
- [src/webmcp.ts](src/webmcp.ts): the one helper for registering tools
