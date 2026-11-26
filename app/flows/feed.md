# Feed

The person (or an agent in the page) reads what changed in their home, newest first, as one feed, and opens anything in it. When it's done, the chosen post is open in the main panel.

This is step 6 of [docs/plans/units.md](../../docs/plans/units.md): the feed of your own units. What you published read back from your PDS, live posts from who you follow, and Discover come in steps 6b to 9 and join this same list and card.

- **Flow id:** `feed`. It prefixes every tool name.
- **Starts from:** the rack's Feed button, or `feed.read` from an agent.
- **Ends in:** the feed on screen; or a post open in the main panel. Nothing is written.

## Steps

| # | Step | Screen (ohm-ui) | Primary action (forest) | Tool | Annotations | Approval |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Read the feed | one page of block tiles, scrolled like a website, its zoom the number of columns; `Empty` when there is nothing | none: each card opens what it shows | `feed.read` | `readOnlyHint`, `untrustedContentHint` | none |
| 2 | Open a tile | a popup over the feed: the editor, the reader, the picture, the tool or the page | the tile | `workspace.open` | `readOnlyHint` | none |

## What the feed holds

Two tabs.

- **Following:** what you share (public and friends-only, never what only you see) with the posts of the accounts you follow on Bluesky. First you, as your identity card; then your channels as blocks, as your home panel shows them: Tools and Artifacts (your website and the pages you kept, live; yours alone, so only as yourself), the site's collections (Writings, Photographs, Projects…) and your shared channels; then your blocks and their posts together, newest first. A web page, a kept website or a tool is never a tile of its own: it lives in its channel. Whatever your coding agent made for you is yours, so it shows as yours. People are shown by their names, never their handles.
- **Discover:** AI, for now: threads from public feed generators (AI/ML Feed: Blend, MLSky, Artificial Intelligence, LLM, AI Agents), each post once, only posts about AI, never a reply on its own, trading bots and hashtag-only posts left out, ranked by how much each was talked about and how new it is.
- **Refresh:** the button in the header reads the tab you are on again now, past every cache, and takes you to the top. Following is read again every half minute and Discover every two minutes by themselves; Discover is read as soon as the feed opens, so switching to it is instant.
- Your units come from `GET /units/feed?audience=friends` (anyone viewing: `public`); posts from `GET /feed/live` (Jetstream, for the account `ohm serve --following` names, the home's handle by default) and `GET /feed/discover`. Posts from the network are other people's words: shown as theirs, opened to read with a way to Bluesky, and never handed to an agent (`feed.read` returns only your own).

- **It is a page, like your website:** it fills the window and scrolls down; the next page and its pictures load well before you reach the bottom, and pictures keep their space while they load. **Zoom is how many columns**, as on haeinjung.com: ⌘-scroll or a pinch, one to eight; it starts at what the window holds. A pinch moves one step at a time, and you keep your place on the page. Every tile is drawn at one size and the whole grid is scaled to the window, so zooming only shrinks or grows the tiles in proportion: nothing inside one moves. Your side panel stays open beside it (your home as the Site view shows it, or the tree without a site); the header (Following, Discover, Refresh) is its own bar above the page. No hover on the tiles.
- **Each tile is a block's card** from `site/Cards.tsx`: a picture as itself, a writing (a site page) as its text in miniature, a short post as its words, a tool running, a kept website as its picture or its name, a channel as its name and titles. Under it: its title, who made it, when, and who sees it.
- **A tile opens in a popup over the feed,** as the site's canvas opens a block: a block in the editor, a site page in the reader, a photograph as itself, a tool running, a kept website in a frame, a channel block as everything it holds (each of which opens in turn), your profile as your profile. The feed stays beneath.

## Tools

### `feed.read`

- **title:** Feed
- **description:** Shows the feed in the main panel and returns its newest items, each with its id (which `workspace.open` opens), title, type, where it is, who sees it, when it changed and its opening words. The words are the person's own and may quote others.
- **inputSchema:**

```json
{ "type": "object", "properties": { "limit": { "type": "integer", "minimum": 1, "maximum": 50, "default": 20 } }, "additionalProperties": false }
```

- **outputSchema:** `{ "items": [...], "next": "workspace.open" }`
- **Handler:** `workspace/store.ts#showFeed` with `data/units.ts#readFeed`, the same the Feed button calls
- **Errors:** `OperationError` when the home does not answer

## States

| Situation | What the person sees |
| --- | --- |
| Loading | blank |
| Agent working | `AgentStatus` |
| Nothing yet | `Empty`: "Nothing here yet" |
| Viewing as someone else | the bar "Viewing as …" above, and only what they see |
| Failed | `notify()` (error), the feed as it was |
