# Workspace

Every path through it, with its purpose and end state: [paths.md](paths.md).

A light, Obsidian-like home for one person's vault and cortex: find something, read it, write it, see how it connects. This is a wireframe. Data is synthetic and nothing is saved.

- **Flow id:** `workspace`. Tools are named `workspace.<step>`.
- **Starts from:** the app's root, with the person signed in.
- **Ends in:** a block open to read or edit, the graph, or a change of who can see a block.

## Layout

```
┌──────┬────────────────┬────────────────────────────────────────┐
│ rack │ side panel     │ main panel                              │
│ (on  │ (a card, shade │ (a card, shade 2)                       │
│ the  │  3)            │  post · editor · settings               │
│ block)│ repo · visib-  │                                         │
│      │ ility · you    │                                         │
│      │                │                                         │
└──────┴────────────────┴────────────────────────────────────────┘
          Search: a sheet over the dimmed workspace (⌘K)
```

The rack sits on the block itself. The side panel and the main panel are separate cards beside it. After agentic-twitter's directory and centre, they are lifted by shade in light and by tone in dark. Their corners use the item radius (12), not the card radius (24).

| Rack | Side panel becomes |
| --- | --- |
| ohm dot | Nothing. The brand mark, at icon size |
| Search (⌘K) | Unchanged. Search opens over everything |
| New block (⌘N) | Unchanged. A private draft opens in the editor |
| **Home** | The home, read-only. Its heading is you (picture and name) in a pill. Its menu chooses what shows: **All**, then a divider, then **Cortex** and **Vault**, any combination (checks, not checkboxes; All is both). The two top-level folders, **cortex** (a minimal brain) and **vault** (a minimal box), are bold forest rows that open in place. Their icons are outlines when closed and filled when open. The header has the eye (click: who each block is for; hover: View as), a filter (platform, type, who it is for, edited, status), **history** (Dates, You and Agents on a vertical timeline; every change marked with who made it, and reverted from there: [flows/history.md](history.md)), and one switch between list and graph. The vault groups blocks into **channels**: a block is listed in every channel it is in, its home channel first (`photos › tokyo`) and any channel of your own (`slowness`) as well. **Dragging moves things, as in a file manager:** drag a block's row onto a channel to move it there, or above or below another block to move it to that place (each channel keeps its own order, so a block can be first in one and last in another). Hold ⌥ to add it to the other channel and keep it where it was. Drag a channel's row onto another channel to put it inside, or onto the vault row to bring it to the top; a channel that holds channels cannot go inside another yet. Drag a block onto the main panel to open it. A block's **home channel** is the one its published address comes from (`/posts/<channel>/<slug>`), so moving it out of that one changes its address on the next publish, and the notice says so. **The dot** at the right end of a block's row, on hover: click it for the block's connections card, or press it and pull a line to another block's row, a graph node or the open block to connect the two. Drag the panel's right edge to resize it (220 to 640 px; double-click resets it, arrow keys nudge it). The width is remembered on this device. Hover a block for its **⋯** (right-click opens the same menu): **Open in ›** (this window, a new tab, the graph), **Pin** (P: pinned blocks show on top), **Mark as unread** (U: a bold title until opened), **Rename** (R: in place on the row, the name selected; Enter or leaving keeps it, Escape puts it back), **Move to ›** (moves this row, as dragging does), **Channels ›** (check the channels it is in; its home channel is always checked), **Remove from <channel>** (on a row in a channel that is not its first), **Archive** (A: out of the tree, into Archived at the bottom, with Restore), **Delete** (D, red, asks first). The letters work while the menu is open or the row has focus. A channel has its own **⋯**: **New block here** (N: filed in that home channel), **New channel inside** (C, for a top-level channel), **Rename** (R, in place) and **Delete channel** (D, only when it is empty). The vault row's ⋯ adds **New channel** (C). Channels are records: an empty one stays, and is offered in Move to › and Channels ›. Renaming a channel renames it wherever a block was collected into it, refiles every block whose home channel it is and keeps it open. Posts get the new address when you next publish, and the notice says how many. The cortex and vault rows have a ⋯ too: **Expand all / Collapse all** (E), **Show only cortex / vault** (O), and for the vault, **New block** (N). The folders inside the cortex are fixed categories and have no menu. **Visibility lives here:** the eye in the header shows who each block is for. Every block gets a small round icon at its end (a globe for Everyone, tinted forest; people for Friends; a lock for Only you), labelled on hover, that changes it in place; showing a block to more people asks first, and marking is not publishing. Cortex items always read Only you. **View as** (You, Friends or Public) is in the eye's hover menu, and turning visibility off returns to You |
| **Connections** | Everyone around you, as a list or a graph: friends you let in, people who let you in, and who you asked. **Make friends** asks someone by email. Click a person for what they share with you; it opens to read |
| **Notifications** (bell) | Unchanged. A panel opens beside the rack, after agentic-twitter's notification center. **Agent** shows what an agent is doing now (its status), then what agents did through the block's WebMCP tools. **System** shows the workspace's notices. Each item shows how long ago it happened, can be removed on hover, and opens the block it is about. Clear all empties the list. A dot on the bell means something is unread; it pulses light green while an agent is working. Opening a tab marks it read |
| You (avatar) | Your picture, then your name with your handle under it. Below that, the settings sections: Your profile, Identity, Agents, Vault, Cortex, Appearance, and Sign out |

## The graph

The graph lives in the side panel, in the home. It looks and behaves like Obsidian's graph view, in white, grey and ohm's green only. It names no parts and needs no key.

- **You are the middle:** a forest circle with your initial. It stands for your profile; clicking it opens it.
- **Around you, joined to you by faint green lines:** what your agents observed about you, and their skills and tools, as green diamonds. **Vault blocks** are grey dots and gather further out. These are soft pulls, not fixed rings.
- **Clusters, without areas.** What is filed together (a channel, a cortex category) clusters in one direction, with the folder's name above it in grey. A channel inside a channel clusters beside its siblings. Clicking a name opens the list with that folder revealed. Neither "cortex" nor "vault" is written anywhere.
- **Collecting channels.** A channel that only collects blocks filed elsewhere (`slowness`) is a small dashed point out among the vault blocks, joined by dashed lines to what it collects.
- **Lines are connections**, one per pair: a link written in the text or a connection made between whole blocks, grey (hover it for why); or a connection an agent observed, a dashed green line between blocks an observation is about (hover it to read the observation). Thicker is stronger. An observation about one block shows in that block's connections card.

How it behaves, as Obsidian's graph view does:

- **Motion:** a force layout (d3-force). Each item is pulled softly toward its cluster's direction and its kind's distance from you; lines tug a little. It settles before it is shown, so it opens in place.
- **Hover** rings the item, lights its lines in green and its folders' names, and fades the rest.
- **Drag** pins an item under the pointer; its neighbours follow and ease back on release.
- **Pan and zoom** (d3-zoom). Cluster names always show; names of inner channels and of items fade in as you zoom, and for the hovered item. Names that would overlap are left out.
- **Fit:** the graph stays fitted to the panel as it resizes and settles, until you pan or zoom yourself.
- **Popover:** turns connections on or off, and lays the graph out again.
- **Clicking** an item (or focusing it and pressing Enter) opens it in the main panel.
- **Centred on someone else** (from search or a mention): they are the middle, with only your blocks that mention them and no cortex; "Back to me" returns.
- **What it draws:** what the home's scope (All, Cortex, Vault) includes, that the current audience can see, through the home's filters. The cortex shows only to you, looking as yourself.
- **Code:** built in `src/graph/model.ts` (items, folders, lines and their strength) and `src/workspace/GraphView.tsx` (clusters, forces, interaction, drawing).
- **Private blocks** (see ohmmmm's [`vault/plans/encryption.md`](https://github.com/haeinej/ohmmmm/blob/main/vault/plans/encryption.md)): their channels and connections are inside the encrypted files, so this graph is built on the device from decrypted blocks, never by the server.

## The block editor

Every block opens in the main panel in one block editor, built after the reference recordings (Tiptap underneath, so the block is Markdown).

- **Path.** The toolbar starts with the block's path in a pill, such as `vault / writing / journal / Monday, rain`.
  - **Rename:** click the block's name to rename it in place, with a forest ring around it and the text selected.
  - **Save by dragging:** drag the pill out of the window to save the block as a `.md` file, or onto a channel in the side panel to move it there. A block that shows images is saved as a `.zip`: the `.md` and an `assets/` folder, each embed written as `![alt](assets/<file>)`, so it opens anywhere after the tab has closed.
  - **The ⌄ beside it** opens the block's menu, as a session list has it: Open in › (new tab, graph), Rename (R), Open file…, Save as Markdown, Move to › (from its home channel), Archive (A), Delete (D, asks first).
- **Toolbar.** After the path, a pill of inserts: Text, Image, Table, and + for everything. On the right: the connections button (with its count), History (the block's versions) and you. Toolbar inserts go after the block the caret is in, never inside a table or list.
- **Dropping.**
  - **Images** dropped or pasted onto the block go in where they land. Image in the toolbar or `/` opens a file picker. Each image becomes a private **media block** of its own in the block's channel (`![[wet-street.png]]` is its body), named by its bytes' CID, and the block embeds it with `![[wet-street]]`, on a line of its own. The same image added again is not copied: its media block is shown, and collected into the channel if it was not there. The bytes stay in this browser's media cache (`ohm-media`), with sizes of 320, 960 and 1920 px made here. A block never holds a temporary browser address: saving one is refused ([vault/plans/media.md](../../vault/plans/media.md)).
  - **Blocks and files:** dropping a `.md` or `.txt` file, or a block from the tree, opens it. A veil says what the drop will do.
- **Title.** "Untitled block" until it has one. Type a title with spaces between words, then press Enter to move into the block. Hover the title to add an emoji icon.
- **Writing.** The empty line says "Type / for commands or @ for mentions". `/` opens the insert menu at the caret, grouped (Generate, Create, Media, Basic) and filtered as you type, with arrows and Enter.
- **Block handle.** Each block has a handle on hover. Drag it to move the block. Click it for its menu:
  - **Any block:** Insert below, Duplicate, Copy as Markdown, Delete.
  - **A table:** Insert below, Copy as Markdown, Header row, Header column, Delete table.
  - Each menu ends with "Last edited by … · date".
- **Tables**, as in the recording:
  - **Row handle** on the left of the hovered row: Insert row above or below, Move row up or down (dimmed at the ends), Delete row.
  - **Column handle** on top of the hovered column: Insert column left or right, Move column left or right, Fit column to contents, Distribute columns evenly, Delete column.
  - **"+" bars** below and to the right add a row or a column.
  - Columns resize by dragging their edges.
  - **Cells:** the cell with the caret is outlined in forest, and a selection of cells is tinted. Over a cell selection, the floating bar keeps only Ask for change and the marks.
- **Selected text** brings up the floating bar: **Ask for change** (an inline prompt; it arrives once an agent is connected through WebMCP), **Connect** (shown when the selection is inside one paragraph, heading or item: find a block, and the words become a link to it, `[[slug|the words]]`), Bold, Italic, Underline, Strikethrough, Code, and **Text ▾** to turn the block into another kind (with a check on the current one).
- **Links.** A `[[slug]]` reads as a chunk of green text: the linked block's title, with the brackets hidden. While the caret is inside it, it shows as written, so it can be edited, as in Obsidian's live preview.
  - **Hover:** a card shows the linked block (its path, title and opening lines), and the block is shaded green in the side panel's tree.
  - **Click:** opens the block.
  - **Your own words:** `[[slug|the words]]` reads as your words, linked to the block, with its title on hover. Connect in the floating bar writes it.
- **The connections card.** A block's connections open as a card beside it, like an info panel. Two ways in: the connections button (with a count) in the block's toolbar, and a button that shows next to the **⋯** at the right end of a block's row in the side panel when you hover it. The card holds, top to bottom:
  - **The graph around the block**, still and small, in the main graph's colours: its channels in ink, blocks it connects with in grey, cortex items drawn from it in green. Click a node to open it.
  - **In channels:** the part of the tree the block sits in, each of its channels with it (selected) and up to four neighbours, and "more…" to show the rest in the tree.
  - **Connections:** what it connects to (↗) and what connects to it (↙). Each row says where the connection was read: *in the text*, with the linked words, or a connection on the whole block with its line on why. **+ Connect** finds a block and connects the whole block to it; its *Why?* field and its ✕ are on its row.
  - **Open in the graph.**

  On a private block you change connections; on a block others see they are read-only, as the text is. These are evidence: you made them and they are in the content, so they show in the graph as grey `links`. No agent tool makes one; the cortex can only point at them.
  - **Missing blocks:** a link to a block that doesn't exist reads muted and struck through.
  - **Mentions:** an `@handle` reads as a link; ⌘-click follows it while editing.
  - **Markdown:** both stay plain text, so search and the graph still find them.
- **Saving.** A private block saves as you type, and it stays private. A block other people can see opens read-only, with "changing it asks first". The `workspace.save-draft` tool takes Markdown and writes into the open block.
- **Motion.** Menus, handles and the floating bar fade and scale in on ohm's durations and easing. Reduced motion turns this off.
- **Not in the editor:** templates, the image placeholder with Generate and Attach, comments, Share, and Fork. All were removed on request; who a block is for is set in Visibility.
- **Code:** in `src/editor/`.
  - `PageEditor.tsx`: the block, the path pill and the block menu.
  - `TableControls.tsx`: row and column handles and the add bars.
  - The rest of the parts: `SelectionToolbar.tsx`, `InsertMenu.tsx` (the + and / menus), and `IconPicker.tsx`.
  - `commands.ts`: inserts and turn-into.
  - `extensions.ts`: the slash command, links, and the active cell.
  - `editor.css`: styles the text with ohm tokens.
  - `src/workspace/drop.ts`: opening and saving by drag.
  - `embed.ts`: `![[…]]` as an embed in the editor and in its Markdown.
  - `src/media/`: the media cache (`cache.ts`), embeds and the save guard (`embeds.ts`), exports (`export.ts`) and the `.zip` writer (`zip.ts`).

## Steps and tools

| # | Step | Primary action | Tool | Annotations | Approval |
| --- | --- | --- | --- | --- | --- |
| 1 | Search | Open result | `workspace.search` | `readOnlyHint`, `untrustedContentHint` | none |
| 2 | Open | Open | `workspace.open` | `readOnlyHint` | none |
| 3 | Graph | Show graph | `workspace.graph` (opens it in the side panel) | `readOnlyHint` | none |
| 4 | Create | New block | `workspace.create` | none (only a local draft) | none |
| 5 | Edit | Save draft | `workspace.save-draft` | none (private, local) | none |
| 6 | Add an image | Image | `workspace.add-image` | none (private, local) | none |

Publishing is not part of this flow. It will be its own flow, with `consequentialHint` and an `ApprovalCard` (see AGENTS.md rules 11 and 12).

`workspace.search` and `workspace.open` stay registered for as long as the workspace is on screen, because search is reachable from every view. `workspace.save-draft` and `workspace.add-image` exist only while a private block is open in the editor.

### `workspace.search`

- **title:** Search
- **description:** Searches the person's vault and cortex by text. Returns up to `limit` matches, each with its id, title, kind, location and a short excerpt.
- **inputSchema:** `{ "query": string (1–200), "scope"?: "all" | "vault" | "cortex" | "entities" | "settings", "limit"?: 1–50 }`
- **Handler:** `src/data/search.ts#search`. The overlay calls the same function. Today it searches the synthetic data in memory. Connecting a real service means replacing only this function.

### `workspace.open`

- **title:** Open
- **description:** Opens a block or cortex file by id in the main panel, to read or edit. Returns its id, title and the view.
- **inputSchema:** `{ "id": string, "view"?: "read" | "edit" }`

### `workspace.graph`

- **title:** Show graph
- **description:** Shows the graph centred on a person. With no `center`, it centres on the owner. Returns the counts of nodes and edges.
- **inputSchema:** `{ "center"?: string (a DID or handle) }`

### `workspace.create`

- **title:** New block
- **description:** Opens a new private draft in the editor, optionally in a home channel and with a title.
- **inputSchema:** `{ "homeChannel"?: string (up to 120 characters), "title"?: string (up to 200 characters) }`

### `workspace.save-draft`

- **title:** Save draft
- **description:** Saves the open draft as private. It is never published. Returns its id and slug.
- **inputSchema:** `{ "title"?: string, "body"?: string }`

### `workspace.add-image`

- **title:** Image
- **description:** Adds an image to the open private block. It becomes a private media block in the block's channel, or the one the vault already has for the same image, and the block embeds it at its end. Returns the media block's id and slug.
- **inputSchema:** `{ "name": string (1–200), "type": "image/avif" | "image/gif" | "image/jpeg" | "image/png" | "image/webp", "data": base64 (up to 20 MB of image), "alt"?: string (up to 1000) }`
- **Handler:** `addImage` in `src/workspace/store.ts`, the same one the editor's drop, paste and picker call. Bad base64 or another type is refused with `DataError`. The agent's change is saved once, as its own, like `workspace.save-draft`.

## States

| Situation | What the person sees |
| --- | --- |
| Nothing open | `Empty`: "Open a block from the vault, search, or start one" with New block |
| No search matches | "Nothing matches" in the overlay |
| Agent working | `AgentStatus` in the main panel's header |
| Draft saved | `notify()`: "Saved as private" |
| An image is already in the vault | `notify()`: the same media block is shown |
| A body with a temporary image address | `notify()`: the save is refused, and why |
| An embed names nothing in the vault | The embed reads "Nothing in your vault is called …" |
| An embedded image is not on this device | The embed says so, by the media block's title |

## Where the code is

| Part | File |
| --- | --- |
| State and the shared handlers | `src/workspace/store.ts` |
| Rack | `src/workspace/Rack.tsx`; the bell: `NotificationCenter.tsx`, `notifications.ts` |
| Side panel: repo, visibility, you | `src/workspace/SidePanel.tsx`, `Surface.tsx`; the ⋯ menu: `RowMenu.tsx`; rename in place and delete: `PageActions.tsx` |
| Main panel and settings | `src/workspace/MainPanel.tsx`, `Settings.tsx`, `settings-tabs.ts` |
| The block editor | `src/editor/` |
| Search sheet and the one search path (vault, cortex, entities, settings) | `src/workspace/SearchOverlay.tsx`, `src/data/search.ts` (selected `HomeSource`) |
| Tools | `src/workspace/tools.ts`; `workspace.save-draft` in `src/editor/PageEditor.tsx` |
| Synthetic data | `src/data/sample.ts` |

On a phone the side panel lies over the main panel. It starts closed, and closes when something opens.

## Checked

- [x] By hand, in light and dark, on a phone and a desktop (wireframe level; the graph is small on a phone)
- [x] By tools, through the development stand-in: `getTools()` lists `workspace.*` and adds `workspace.save-draft` while a private block is in the editor. `executeTool` searches, opens, creates and saves, reaching the same states as the hand walk
- [x] No tool here writes anything public. A block that isn't private gets no `workspace.save-draft`, and `saveDraft` refuses it with `NotAllowedError`

## Not yet tools

Ask for change in the editor is only in the UI so far. When it becomes a tool, anything that changes what other people see is `consequentialHint` and asks first (AGENTS.md rule 11). Settings › Agents already turns each tool on or off.
