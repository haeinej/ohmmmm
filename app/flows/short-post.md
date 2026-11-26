# Short post

The person (or an agent in the page) writes a short post, as on Bluesky: at most 300 characters. When it's done, it is a private block of kind `short` in Collections › posts, shown in the feed as a post card. Publishing it is the person's alone (step 3, next): an `app.bsky.feed.post` in their own repository, so it shows on Bluesky, and on their site.

This is step 7 of [docs/plans/units.md](../../docs/plans/units.md).

- **Flow id:** `short`. It prefixes every tool name.
- **Starts from:** the rack's New › Post, or `short.write` from an agent.
- **Ends in:** a private short post, in the feed; or nothing, when the person closes the composer.

## Steps

| # | Step | Screen (ohm-ui) | Primary action (forest) | Tool | Annotations | Approval |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Write | `Dialog` with a text area and a count of what is left | Save | `short.write` | none: it saves a private block, nothing others see | none |
| 2 | See it | the feed: the post card | the card opens it | `feed.read` | `readOnlyHint` | none |
| 3 | Publish *(next)* | preview of the post as Bluesky will show it, then `ApprovalCard` | Publish | `short.preview`, `short.publish` | `readOnlyHint`; `consequentialHint` | `ApprovalCard`; the bridge writes with the app password, which never reaches the page. An agent never publishes. |

## The post card

A tile like every other in the feed, so the masonry reads as one: the card is the post's words, all of them, with its links, @mentions and #tags marked; under it, your picture, your name (and @handle when it differs), how long ago, and who sees it. It opens the block.

## Tools

### `short.write`

- **title:** Save
- **description:** Saves a short post (at most 300 characters) as a private block in Collections › posts. Nothing is published. Returns its id.
- **inputSchema:**

```json
{ "type": "object", "properties": { "text": { "type": "string", "minLength": 1, "maxLength": 3000 } }, "required": ["text"], "additionalProperties": false }
```

The limit is 300 graphemes, as Bluesky counts; longer is refused with `DataError`.

- **outputSchema:** `{ "id": "...", "next": "feed.read" }`
- **Handler:** `workspace/store.ts#writeShort`, the same the composer's Save calls
- **Errors:** `DataError` when the text is empty or longer than 300 characters

## States

| Situation | What the person sees |
| --- | --- |
| Writing | the count goes red past 300, and Save is off |
| Agent working | `AgentStatus` |
| Saved | `notify()`: "Saved. Only you see it until you publish." The feed opens |
| Closed | nothing saved |
