# Feed

The person (or an agent in the page) reads what changed in their home, newest first, as one feed, and opens anything in it. When it's done, the chosen post is open in the main panel.

This is step 6 of [docs/plans/units.md](../../docs/plans/units.md): the feed of your own units. What you published read back from your PDS, live posts from who you follow, and Discover come in steps 6b to 9 and join this same list and card.

- **Flow id:** `feed`. It prefixes every tool name.
- **Starts from:** the rack's Feed button, or `feed.read` from an agent.
- **Ends in:** the feed on screen; or a post open in the main panel. Nothing is written.

## Steps

| # | Step | Screen (ohm-ui) | Primary action (forest) | Tool | Annotations | Approval |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Read the feed | the whole page: block tiles on a pannable, zoomable plane, `Empty` when there is nothing | none: each card opens what it shows | `feed.read` | `readOnlyHint`, `untrustedContentHint` | none |
| 2 | Open a post | the post's own view (editor, profile, site file) | the card | `workspace.open` | `readOnlyHint` | none |

## What the feed holds

- **Your blocks worth seeing**, newest first: a block with words or a picture, your site's pages, photographs and videos, the websites you kept (the Artifacts channel) and the tools built for you. Agents' files, channels, the profile and the wallet are places, not posts; an empty block has nothing to show. Nothing from the network, and nothing on AT Protocol, for now.
- It comes from `GET /units/feed` on the bridge (without one, the units already loaded), filtered by **View as**: a friend sees public and friends blocks, anyone public ones. Kept websites and tools are yours alone.
- **It is a canvas, not a page:** it takes the whole screen, with no side panel, on an endless plane like the site's canvas (`site/Board.tsx`). Drag or scroll to move around, ⌘-scroll or pinch to zoom; the next page loads as the bottom of the tiles comes near.
- **Each tile is a block's card** from `site/Cards.tsx`: a picture as itself (a page's own picture, from the site's checkout when it is on the site's domain), a writing as its first page in miniature, a tool running, a kept website as its picture or its name. Under it: its title, who made it, when, and who sees it.

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
