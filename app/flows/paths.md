# Every interaction path in the workspace

What a person (or an agent) can do in the ohm workspace, where each path starts, how it goes, where it ends, and what it is for. This is the end-state record of the workspace as built. The layout and design are in [workspace.md](workspace.md); the rules are in [../AGENTS.md](../AGENTS.md).

**The workspace in one sentence:** one person's home for what they write (the **vault**) and what their agents know about them (the **cortex**). Here they find things, write blocks, see how everything connects around them, decide who sees what, and let an agent help through the same steps.

How to read each path:
- **Entry:** where it starts.
- **Steps:** what the person does.
- **End state:** what is true when it is done.
- **For:** why someone would take it.
- **Agent:** the WebMCP tool that runs the same step, or *UI only*.
- **Asks first:** for anything other people would see, or anything that can't be undone, the block confirms before acting.

**Your home, on this computer.** The workspace shows the home folder `ohm.<handle>` through its bridge (`ohm serve`), once this browser is paired from the link the bridge prints, and nothing else: no sample data, no online home. Unpaired, or with the bridge not answering, it shows **Open your home**, which says how. Every change is written to the home folder first and shows once the bridge has answered. Places with nothing in them show ohm-ui's `Empty`.

---

## A. Finding and opening

| # | Path | Entry → steps | End state | For | Agent |
| --- | --- | --- | --- | --- | --- |
| A1 | **Search** | Rack Search or ⌘K → type → arrows or hover → Enter or click | The chosen block, agent's file, profile, wallet, site file, setting or person is open. The profile, the wallet and the site's files are found by title and path ([docs/plans/units.md](../../docs/plans/units.md)) | Get to anything without knowing where it lives | `workspace.search`, then `workspace.open` |
| A2 | Narrow a search | In search, choose All, Collections, Agents, Profile, Site, Entities or Settings | Only that kind of match shows | Cut noise when you know what you want | `workspace.search` with `scope` |
| A3 | Search finds a setting | Type a setting's word (e.g. "dark") → choose it | That settings screen is open | Reach a setting without browsing | `workspace.search` (`scope: settings`) |
| A4 | Search finds a person | Type a name or handle → choose them | The graph is centred on that person | See everything that touches someone | `workspace.search`, then `workspace.graph` |
| A5 | Ask an agent from search | Type a question → Send with no match chosen | A notice: asking arrives once an agent is connected | Reserved: ask instead of look up | *Not yet* |
| A6 | Open from the tree | Home → expand → click a block | The block is open in the editor; its row is selected; its unread dot clears | Browse by where things live | `workspace.open` |
| A6a | **Open any unit from the tree** | Home → expand a folder (Profile, Agents, Collections, Site) → click a row | The tree reads that folder when it opens, not before ([docs/plans/units.md](../../docs/plans/units.md)). A block or an agent's file opens in the editor; the profile and the wallet open the profile; a site file opens in the site's file view | One view of everything in your home, however large | `workspace.open` for blocks and agents' files; *UI only* for the rest |
| A7 | Open from the graph | Graph → click a block or cortex node (or focus it and press Enter) | That block is open in the editor | Browse by how things connect | `workspace.open` |
| A8 | Follow a link | In a block, click a green `[[link]]` | The linked block is open | Move along the links you wrote | `workspace.open` |
| A9 | Preview a link | Hover a green `[[link]]` | A card shows the block's path, title and opening lines; the block is shaded green in the tree | Check where a link goes without leaving | *UI only* |
| A10 | Open by dragging | Drag a block from the tree onto the main panel | That block is open | Open by direct manipulation | *UI only* |
| A11 | Open a file | Drop a `.md` or `.txt` on the main panel, or Path ⌄ → Open file… | A new **private** block with the file's name and text is open | Bring writing in from your disk | *UI only* |
| A13 | **Back and forward** | Toolbar ← →, or ⌘[ and ⌘] | The previous or next block you opened is open again, revealed in the tree | Retrace your steps | *UI only* |
| A12 | Open in a new tab | Row ⋯ or Path ⌄ → Open in › New tab | The block opens in a new tab (`?open=<id>`) | Keep two blocks side by side | *UI only* |

## B. The home (side panel)

| # | Path | Entry → steps | End state | For | Agent |
| --- | --- | --- | --- | --- | --- |
| B1 | Show or hide the panel | Rack Home, or ⌘\ (brings back the panel you last had). From the feed or another screen, Home goes back to the home screen (the canvas, with a site) with its panel open | The panel shows or hides; the open block never changes | Make room, or come back to your files | *UI only* |
| B1a | **Reveal the open block** | Automatic: open a block from anywhere | The rows above it open in the tree; it scrolls into view, is selected and flashes once | Always know where you are | Any tool that opens a block |
| B1b | Reveal a channel or category from the path | Click a channel or category in the path pill | The panel shows the home with that row open, scrolled to, flashing | Jump from where a block lives to its neighbours | *UI only* |
| B2 | Choose what shows | Your pill (picture and name) → All, or Cortex and/or Vault | The tree and graph show only those | Focus on what agents know, or on writing | *UI only* |
| B3 | Open and close rows | Click a channel or category or the cortex/vault row (each side's ⋯ also has Expand all) | Rows open or close (cortex, vault, channel paths) | Walk the hierarchy | *UI only* |
| B4 | Expand one side | Cortex or vault ⋯ → Expand all / Collapse all (E) | Everything inside that one opens or closes | Survey one side at once | *UI only* |
| B5 | Show only one side | Cortex or vault ⋯ → Show only… (O) | The scope becomes that one | Same as B2, from the row | *UI only* |
| B6 | List or graph | Header: one switch, showing the view it goes to (graph icon in the list, list icon in the graph) | The panel shows the list or the graph of the same scope and filters | Switch between where and how things connect | `workspace.graph` opens the graph |
| B6a | **Filter** | Header funnel → Platform (your site, Bluesky, Instagram, X), Type (text, photo, table, checklist; profile, observation, skill, tool), Who it is for, Edited (any time, past week, month, year), Status (unread, pinned); Clear | The list and the graph show only matching blocks; folders open so matches are in view; a dot on the funnel while any filter is on; "Nothing matches" with Clear when empty | Find a kind of block across folders | *UI only* |
| B7 | Resize the panel | Drag its right edge (or arrows on the handle; double-click resets) | Width 220–640 px, remembered on this device | More room for names or the graph | *UI only* |
| B8 | **New block** | Rack New block, ⌘N, vault ⋯ → New block (N), or channel ⋯ → New block here (N) | A new **private** block open in the editor, title focused, in that channel if chosen | Start writing | `workspace.create` |
| B9 | Pin | Row ⋯ → Pin (P) | The block shows under Pinned at the top; press again to unpin | Keep what you return to close | *UI only* |
| B10 | Mark as unread | Row ⋯ → Mark as unread (U) | A bold title until opened | Remind yourself to come back | *UI only* |
| B11 | **Rename a block** | Row ⋯ → Rename (R), or click the block's name in the path pill | The name, in place, ringed in forest; Enter or leaving keeps it, Escape puts it back | Fix or improve a title | *UI only* (or `workspace.save-draft` with `title`, private blocks) |
| B12 | **Rename a channel** | Channel ⋯ → Rename (R) | The channel is renamed everywhere a block was collected into it, and every block whose home channel it is is refiled; it stays open. The notice counts posts whose address follows on the next publish | Keep your sections in your own words | *UI only* |
| B13 | **Move a block** | Drag its row onto a channel, or above or below another block; or Row ⋯ → Move to › (Path ⌄ → Move to › moves it from its home channel) | It leaves the channel that row was in and sits in the other, at that place. Moved out of its home channel, its address changes on the next publish, and the notice says so | Reorganise, as in a file manager | *UI only* |
| B13a | **Add to another channel** | Hold ⌥ while dragging the row onto a channel, or Row ⋯ → Channels › and check it | The block is listed there as well as everywhere it already was | Gather a block into many channels, as on Are.na | *UI only* |
| B13b | Take out of a channel | Row ⋯ → Remove from <channel> (on its row in that channel), or Channels › and uncheck it | It leaves that channel only; its home channel stays the same this way | Undo a collection | *UI only* |
| B13c | **Move a channel** | Drag a channel's row onto another channel, or onto the vault row for the top | It goes inside the other channel, or to the top, with every block in it and its order; a channel that holds channels cannot go inside another yet, and is refused with a notice | Reorganise channels | *UI only* |
| B13d | **New channel** | Vault ⋯ → New channel (C), or a channel's ⋯ → New channel inside (C) | An empty channel, shown in the tree and named in place; it stays when empty | Make a place before there is anything in it | *UI only* |
| B13e | Delete a channel | A channel's ⋯ → Delete channel (D), offered only when it is empty | The channel is gone; a channel with blocks or channels in it is refused, with the reason | Tidy up | *UI only* |
| B14 | Archive | Row ⋯ or Path ⌄ → Archive (A) | The block leaves the tree for Archived · n at the bottom; Restore brings it back. If it is open, it stays open with an "archived" bar and Restore | Clear clutter without deleting | *UI only* |
| B15 | Delete | Row ⋯ or Path ⌄ → Delete (D) → **confirm** | The block is removed from the vault. If it was open, the block you had before it opens (never a blank editor). For a post, the dialog says taking it down is its own step | Remove what you don't want | *UI only* · **asks first** |
| B16 | Shortcuts on a row | Focus a row → P, U, R, A, D (blocks) or N, C, R, D (channels) | As B9–B15, without opening the menu | Work fast from the keyboard | *UI only* |

## C. Visibility (inside the home)

| # | Path | Entry → steps | End state | For | Agent |
| --- | --- | --- | --- | --- | --- |
| C1 | Show who each block is for | Click the eye in the home header | Each block shows an icon at its end: globe (Everyone), people (Friends), lock (Only you); the label is on hover | See at a glance what is shared | *UI only* |
| C2 | **Show a block to more people** | Click a block's icon → Friends or Everyone → the preview's warning → **Change visibility** | Only you → Friends: moved into the friends layer at the service. → Everyone: a block that is not a post becomes one at its channel's address, is marked public, and the Publish page opens with that one post's preview; it is public only once it is published | Decide who a block is for | `visibility.move` (consequential: the same dialog) |
| C3 | Make a block more private | Click its icon → Only you | Friends → Only you: sealed on this device at once (no confirmation). Everyone → Friends asks first and opens the Publish page, which takes the record down | Pull something back | `visibility.move` |
| C3a | Preview a move | (the dialog in C2) | What the move does, its warning, and what it still needs, by the shared rules | Know before deciding | `visibility.preview` (read-only) |
| C3b | **An agent on this computer asks** | It calls `vault_request_visibility`; the request waits in the bell with its reason | Approve: the block moves, journaled with who asked and why. Decline: nothing changes. The agent sees which (`vault_requests`) | Agents never change who sees a block themselves | *UI only* (the request is the agent's tool) · **asks first** |
| C4 | **View as someone else** | Hover the eye → View as You / Friends / Public | The tree, graph and block show only what that audience can see; the cortex is locked; a bar says "Viewing as…" with Back to you. If the open block is one they can't see, the editor says so instead of showing it | Check what others actually see before you publish | *UI only* |
| C5 | Back to yourself | Back to you, choose You, or hide visibility | Everything is visible again | Return to editing | *UI only* |
| C6 | **Publish a block** (your home through `ohmmmm serve`) | Click its icon → Everyone · Publish… → the plan: address, label and sublabel (the channel's, editable), its images, links that become words, and what this computer still needs → **Publish** | Its post is on your PDS and the notice gives its address (Open); the file is marked public and the icon is the globe; a new label is kept on its channel. On a public block, Everyone · Update… rewrites the post, keeping its address and date. Cancel writes nothing | Put a block on your site, in your own words for where it goes | *UI only*: no agent publishes · **asks first** |
| C7 | **Take a post down** (your home) | Click a public block's icon → Only you or Friends · Take down… → **Take down** (red) | The post is removed from your PDS first, then the block is kept for that audience; copies others made are not recalled | Pull something off your site | *UI only*: no agent takes down · **asks first** |

## D. The graph

| # | Path | Entry → steps | End state | For | Agent |
| --- | --- | --- | --- | --- | --- |
| D1 | **See your graph** | Home → graph icon, or ⌘G | Obsidian-style. You in the middle. Each node is a block ([words](../../docs/words.md#in-the-graph)), coloured by its label (its home's top channel) and sized by its backlinks; blocks with one label gather in one direction with the label's name above. Each line is a connect: a link, embed or mention of another block in the text, or a whole-block connection. A connection an agent only observed is its own dashed line, bowed apart from any you made. Channels, `contains` and people a block mentions are not drawn | See how your blocks connect around you | `workspace.graph` |
| D1a | Show the cortex | Graph settings → Cortex (off by default; only once this device has unlocked your keys) | What agents know about you, their skills and tools gather close around you as diamonds | See your memory beside your writing | *UI only* |
| D2 | Explore | Hover a block | It and its lines light up; the rest fades | Read one node's neighbourhood | *UI only* |
| D2a | Find a label in the list | Click a label's name in the graph | The list opens with that channel revealed | Go from the map to the files | *UI only* |
| D3 | Rearrange | Drag a node | Its neighbours follow on soft springs and settle back | Untangle a part to look at | *UI only* |
| D4 | Zoom and pan | Wheel or pinch, drag the background, or + / − / fit | The view moves; item names and folders inside folders fade in as you zoom; names that would overlap are left out; fit returns to all | Read detail or the whole | *UI only* |
| D5 | **Centre on a person** | A person in search results, or a mention | The graph shows only your blocks that mention them | See everything around someone | `workspace.graph` with `center` |
| D6 | Back to you | Back to me | All your blocks again | Return | `workspace.graph` |
| D7 | Filter the graph | Graph settings → Connections; Lay out again | The lines show or hide; the layout restarts | Simplify or refresh | *UI only* |

## E. The block editor (main panel)

| # | Path | Entry → steps | End state | For | Agent |
| --- | --- | --- | --- | --- | --- |
| E1 | **Write** | Open a private block → type | Saved as you type, still private | The main thing | `workspace.save-draft` |
| E2 | Title | Type in "Untitled block" → Enter moves into the block | Titled | Name what you're writing | `workspace.save-draft` (`title`) |
| E3 | Block icon | Hover the title → face icon → search or pick (Clear removes) | An emoji above the title | Recognise a block at a glance | *UI only* |
| E4 | Insert with "/" | Type `/` → filter → Enter | The block is inserted (headings, lists, checklist, quote, code, divider, table, image, assistant instructions) | Add structure without the mouse | *UI only* |
| E5 | Insert from the toolbar | Text, Image, Table, or + (everything) | Added after the current block | Add structure with the mouse | *UI only* |
| E6 | Format selected text | Select text → B, I, U, S, code | The marks are applied | Emphasis | *UI only* |
| E7 | Turn a block into another | Select → Text ▾ → Heading, list, checklist, quote or code | The block changes kind | Restructure | *UI only* |
| E8 | Ask for a change | Select → Ask for change → type → send | A notice: it arrives once an agent is connected | Reserved: have an agent rewrite a passage | *Not yet* |
| E9 | Move a block | Drag the block handle (⋮⋮) | The block moves | Reorder | *UI only* |
| E10 | Block menu | Click the handle → Insert below, Duplicate, Copy as Markdown, Delete | As chosen | Quick block actions | *UI only* |
| E11 | **Tables** | Hover a table: row handle (insert above or below, move up or down, delete), column handle (insert left or right, move, fit, distribute, delete), + bars (add row, column), drag column edges; table handle → Header row/column, Copy as Markdown, Delete table | The table changes | Shape data in a block | *UI only* |
| E12 | **Images** | Drop or paste an image on the block, or Image → pick a file | The image is a private media block of its own in the block's channel, embedded where it landed (`![[slug]]`); the same image again shows its existing media block | Illustrate, and keep each image once, as on Are.na | `workspace.add-image` (embeds at the end) |
| E12a | Open an image | Click its media block in the tree, or open it from the connections of a block that embeds it | The media block is open, showing its image; its connections list every block that embeds it | See where an image is used | `workspace.open` |
| E13 | **Links** | Type `[[slug]]`, or `[[slug\|your words]]` | It reads as a green chunk with the linked block's title, or your words (raw while the caret is in it); it joins the graph's links | Connect blocks | `workspace.save-draft` (Markdown body) |
| E13a | **Connect words** | Select words in one paragraph → Connect → find a block → Enter | The words become a link to it, `[[slug\|the words]]`; it is listed in the connections card, *in the text* | Tie a connection to the passage that justifies it | *UI only*: connections are yours |
| E13b | **Connect the block** | Connections card → + Connect → find a block → Enter; then Why? (optional) | A connection on the whole block, with its line on why, listed in this card and as ↙ in the other block's card | Connect whole blocks, and say why | *UI only*: connections are yours |
| E13d | **See a block's connections** | Block toolbar → connections button (its count), or hover a block's row in the side panel → click the dot at its right end | A card beside it: the graph around the block, the part of the tree it sits in, and its connections | Read how one block sits among the rest without leaving it | *UI only* |
| E13e | **Connect by pulling a line** | Hover a block's row → press its dot and pull: a line follows the pointer → let go over another block's row, a graph node, or the open block | The two blocks are connected as whole blocks; a notice names both. Escape, or letting go anywhere else, connects nothing. From a block others see, it is refused with a notice | The quickest way to connect two blocks | *UI only*: connections are yours |
| E13c | Disconnect | Connections card → hover a whole-block connection → ✕ | It is gone from both blocks and the graph; a link in the text is removed by editing the text | Undo a connection | *UI only* |
| E14 | Mention | Type `@handle` | A link; ⌘-click centres the graph on them; they join the graph | Connect people | `workspace.save-draft` |
| E15 | **Save as Markdown** | Drag the path pill out of the window, or Path ⌄ → Save as Markdown | A `.md` file of the block, or a `.zip` of the `.md` and its images in `assets/` when it shows any; an image this device lacks keeps its `![[…]]` and the notice says so | Take your writing anywhere, images included | *UI only* |
| E16 | **History** | Block toolbar → clock | The block's versions, as in H9 | Go back in time | `history.versions` |
| E17 | Read a shared block | Open a block for friends or everyone | Read-only, with "changing it asks first" | Protect what others already see | *UI only* |

## F. Notifications

| # | Path | Entry → steps | End state | For | Agent |
| --- | --- | --- | --- | --- | --- |
| F1 | **Notifications** | Rack bell (a dot when unread; it pulses while an agent works) | A panel: **Agent** (what an agent is doing now, and what agents did through WebMCP) and **System** (the workspace's notices) | Know what happened, especially what an agent did | *UI only* (every tool run is recorded here) |
| F2 | Act on a notification | Click one about a block; × removes one; Clear all | Opens the block / removes / empties | Follow up or tidy | *UI only* |
| F3 | **Answer an agent's request** | Bell → Agent → *Waiting for you* → **Review** → **Approve**, or **Decline** | Approve: the same move as C2/C3, by the same handler, journalled as asked by the agent and approved by you. Decline: nothing moves. A block changed since the agent asked is refused, to be reviewed again | Only you show a block to more people | *UI only*: an agent asks with `vault_set_visibility` |
| F3a | **Let someone in as a friend** | Bell → Agent → *Asking to be friends* → **Review** → Every channel, or choose channels → **Approve**, or **Decline** | They (and their agents) read your friends-only blocks in those channels, until you remove them. Declined: they see nothing, and aren't told | Choose who sees what | *UI only*: only you, signed in to ohm |
| F4 | What an agent hid | Opening the home with the private layer unlocked | Blocks an agent with a grant hid on their way to private are sealed into the private layer and journalled | Finish narrowing an agent started | *automatic* |

## F″. Agents (rack)

The coding agents that use ohm's tools (the `ohm-vault` MCP server), and every action they wait on. A two-step tool waits here: a yes in the agent's own chat approves nothing. Talking to an agent stays in its own chat. Flow: [agents.md](agents.md).

| # | Path | Entry → steps | End state | For | Agent |
| --- | --- | --- | --- | --- | --- |
| A1 | **Agents** | Rack → Agents (a dot while anything waits) | Each agent with its state and last tool, its waiting actions as cards, and its recent calls | See what your coding agents are doing | *UI only* |
| A2 | **Approve** | Agents → click a card to open it → **Approve** | The agent's next call carries out exactly that action, once (an email is sent by the agent, from your own address) | Let an agent go ahead | `agents.answer` (consequential: a dialog first) |
| A3 | Decline | Agents → open a card → Decline | The agent is told you declined; nothing is done | Stop an action | `agents.answer` (consequential: a dialog first) |
| A4 | Pause, resume | Agents → an agent → pause button, or **Resume** | While paused, ohm's tools refuse every call from it | Hold an agent | *UI only* |
| A5 | Disconnect | Agents → an agent → disconnect → confirm; later **Allow again** | ohm's tools refuse it, and what it waited for is declined | Cut an agent off | *UI only* · asks first |

## G. Profile and settings

| # | Path | Entry → steps | End state | For | Agent |
| --- | --- | --- | --- | --- | --- |
| G1 | Open settings | Rack avatar | The side panel shows you (picture, name, handle) and the settings sections; the main panel shows one | Manage your account and workspace | *UI only* |
| G1a | Leave settings | Done, or the avatar again | The block and panel you came from are back | Return to work where you left it | *UI only* |
| G2 | Your profile | Settings → Your profile | Name, description and picture fields; Review changes notes that publishing your profile asks first | Shape how other apps show you | *UI only* · publishing **asks first** |
| G3 | Identity | Settings → Identity | Your DID (copy), handle, server | Know and share your root identity | *UI only* |
| G4 | **Agents** | Settings → Agents → Offer tools to browser agents; one switch per tool | Tools are offered to an agent, or withdrawn, at once | Control what an agent can do here | Governs every tool |
| G5 | Vault | Settings → Vault | Where this is (your home through `ohmmmm serve`, or the sample); new blocks start private (always); your channels | Review how your vault is organised | *UI only* |
| G5a | **Forget a paired browser** (your home) | Settings → Vault → Browsers paired with your home → Forget → **Forget** (red) | That browser can no longer open your home; the others stay paired. Forgetting this browser goes back to the sample, with a notice saying how to pair again | Shut out a browser you no longer use, or have lost | *UI only* · **asks first** |
| G6 | **Cortex** | Settings → Cortex | What agents proposed, waiting for you (profile lines, skills, tools asked for), then how many observations, skills and tools on | Review what your agents know about you, and answer what they proposed | *UI only* |
| G6a | Accept a profile line | Settings → Cortex → Accept (or Decline) | The line is under its heading in your profile, as your change; declined, it is never proposed again | Decide what agents may take as true about you | *UI only* |
| G6b | Approve a skill | Settings → Cortex → Approve (or Decline) | The skill is in force, as your change naming the agent; declined, it is moved aside, kept | Decide how agents do things for you | *UI only* |
| G7 | Appearance | Settings → Appearance → System / Light / Dark; Density Compact / Comfortable / Rounded | Theme and how round and tight things are, on this device | Comfort | *UI only* |
| G8 | Unpair this browser | You → Unpair this browser | This browser forgets the bridge it was paired with; the workspace shows Open your home until it is paired again | Leave this computer's home | *UI only* |

## H. History ([flows/history.md](history.md))

You and agents both edit directly; every change is marked with who made it, and you revert what you don't want.

| # | Path | Entry → steps | End state | For | Agent |
| --- | --- | --- | --- | --- | --- |
| H1 | **See history** | Home header → history button → Dates, You or Agents | One line per entry, a verb and the block ("Edited Monday, rain"), with an icon for you, an agent, a save or a day | Know what happened, and who did it | `history.list` |
| H2 | **A day** | Dates → a day | That day's changes, as the same lines | See a day at a glance | `history.list` with `since` |
| H3 | **An agent's session** | Agents → a session | What it did, the changes it made, and its dead ends | See what an agent did as one task, and what not to retry | `history.list` |
| H4 | Finish a task (agents) | An agent, when it is done | A session: what it did, its changes grouped, its dead ends | Leave the next agent what was learned | `history.session` |
| H5 | **Open a change** | Any line that is a change | Who, when, why, what it touched as a tree, the words it changed | Read a change without opening the block | `history.list` |
| H6 | **Revert this change** | An opened change → Revert this change | Only what it touched goes back; refused if a later change touched the same part | Undo one change, yours or an agent's | `history.revert` |
| H7 | **Restore this version** | An opened change (here or in a block's card) → Restore this version | The block as it was right after that change | Go back to a version | `history.restore` |
| H8 | **Save** | History → Save → a name | A named point on the line; nothing changes | Mark a moment to come back to | `history.save` |
| H9 | **A block's versions** | Block toolbar → clock | The block's own changes and saves | See how a block came to be | `history.versions` |

## I. An agent, through WebMCP

An agent in the browser sees only the tools the workspace offers right now (Settings › Agents decides which). Each tool calls the same code as the click it stands for. While a tool runs, the workspace shows the agent at work, and the bell records it.

| Tool | Does | Same as | Annotations | End state |
| --- | --- | --- | --- | --- |
| `workspace.search` | Searches vault, cortex, people and settings | A1–A4 | read-only, untrusted content | Matches returned (nothing changes on screen) |
| `workspace.open` | Opens a block by id | A6 | read-only | The block is open in the editor |
| `workspace.graph` | Shows the graph, centred on someone | D1, D5 | read-only | The graph is in the side panel |
| `workspace.create` | Starts a private block | B8 | — | A new private block is open |
| `workspace.save-draft` | Saves the open private block (title, Markdown body) | E1, E2, E13 | — (private only) | Saved, still private. It refuses a block others can see |
| `history.list` | Reads the home's history and open dead ends | H1–H6 | read-only, untrusted content | — |
| `history.versions` | Reads the open block's versions | H9, E16 | read-only, untrusted content | — |
| `history.revert` | Undoes one change to a private block; marked as the agent's | H6 | — (private only) | A new change, by the agent |
| `history.restore` | Brings a private block back to a version; marked as the agent's | H7 | — (private only) | A new change, by the agent |
| `history.save` | Names this point in history | H8 | — | A save; nothing changes |
| `history.session` | Records a finished task, its changes and dead ends | H4 | — | A session |
| `visibility.preview` | What moving one block would do, by the shared rules | C3a | read-only | Nothing changes |
| `visibility.move` | Moves one block after the person approves the same dialog as C2 | C2, C3 | consequential | Moved and journalled, or, to or from public, marked and the Publish page opened; declining leaves it as it was (`NotAllowedError`) |
| `cortex.observe` | Asks to keep an observation about the open block | J5 | consequential: waits for your Approve | An observation, written as the agent's, once you approved |

Nothing an agent can do here is public without the person. `visibility.move` stops at the person's approval; publishing happens on the Publish page, signed in at the PDS. Deleting and publishing are not tools yet. On the home on this computer (`ohmmmm serve`), Everyone opens Publish's dialog instead, and the bridge writes the post to your PDS.

## J. Your cortex ([flows/cortex.md](cortex.md))

Everything in the cortex is yours to change. On the home on this computer each change is written through the cortex's own operations, its version before kept, and journaled as yours.

| # | Path | Entry → steps | End state | For | Agent |
| --- | --- | --- | --- | --- | --- |
| J1 | Edit a part | Open the profile, an observation, a skill or a tool → type | Saved as you type, as your change | Say it in your own words | *UI only* |
| J2 | Pin an observation | An observation → Pin (or Unpin) | Every agent session is handed it | Keep what matters in front of your agents | *UI only* |
| J3 | Forget an observation, remove a skill | Its toolbar (or the tree's ⋯) → Forget / Remove → confirm | Gone from the cortex, kept in its history | Take back what an agent should not use | *UI only* |
| J4 | Switch a tool | A tool → its switch | On: agents may use it; off: they don't | Decide what agents may act with | *UI only* |
| J5 | **Write observation** | A block's toolbar → eye → write → Write observation | An observation about that block, yours, in its connections card | Tell your agents what you know about a block | `cortex.observe` (asks you first) |

## End states, in short

| After… | It is true that… |
| --- | --- |
| Opening anything | One block is open in the editor; the tree has revealed it and shows it selected; the graph rings it; it is in your back/forward history; its unread dot is gone |
| Writing | The block is saved and still private |
| Renaming or moving | The tree, path pill, editor title, search and graph all agree. For a post, its address follows when you next publish |
| Marking who a block is for | Friends ↔ only you moves it between the friends layer and the sealed private layer, after your yes for wider. Public is reached only through Publish, for that one post. Every move is journalled |
| Publishing (your home on this computer) | Its post is on your PDS at the address the plan showed, the file says public, and nothing else of your vault left your computer |
| Taking a post down (your home on this computer) | The record is gone from your PDS before the block moved; the block is kept |
| Viewing as Friends or Public | You see exactly what they would; your cortex is hidden; you are one click from Back to you |
| Archiving | Out of the tree, kept, restorable |
| Deleting | Gone from the vault, after your yes; you are on the block you had before. Published copies are handled by a separate take-down step |
| Hiding the panel | The block you were on is still open; ⌘\\ brings the panel back as it was |
| Leaving settings | You are back on the block and panel you came from |
| An agent acting | You saw it working, the bell recorded what it did, and nothing became public |

## Not yet (reserved paths)

These show a notice saying what they will do. Each will become a path above once its service exists:
- **Agent features:** ask an agent (from search and from selected text), and generate or visualise.
- **Version history.**
- **Publishing from the sample, and through the vault service.** On your home through `ohmmmm serve` it is built (C6, C7).
- **Media:** video, audio and file blocks.
- **Unlocking on this device:** the private layer and the cortex open once the account app's keys are wired into the workspace (`privateSession`). The cortex also needs the keys package to seal under `ohm-vault/cortex/v1`.
- **Media upload from the editor:** the media cache requests are in the source (`HomeSource.media`); dropping a picture does not send its bytes yet.
