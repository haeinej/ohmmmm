# Visibility moves: agent reference

Human guide: [who can see a block](../visibility.md). Plan: [standard-site.md](../../plans/standard-site.md), step 2. Requests: [CAPABILITIES.md › Visibility](../../service/CAPABILITIES.md#visibility).

## One set of rules

[vault/visibility.mjs](../../vault/visibility.mjs) is imported by the service, the MCP tools and the cockpit.

- `planMove({from, to, title})` returns `{from, to, action, widens, undoable, warning, finishes, via, needs?}`.
  - `action`: `share` for private→friends, `seal` for friends→private, `publish` for →public, `takedown` for public→.
  - `finishes`: `member`, except `seal`, which is `member-or-granted-agent`.
  - `via`: `device` or `publish`.
  - `needs: ['title']` when publishing an untitled block.
  - Throws `MoveProblem('InvalidMove')`.
- `whyNot(plan, {actor, granted})` returns null when `actor` may finish the move, otherwise a sentence. `me` may always finish one (except `needs`). An agent may finish only `seal`, and only with `granted`.
- `blockAsPost(node, {id, slugOf})`: a block that is not a post, as the post it becomes when public. `label`/`sublabel` are the first two folders of its home channel (`other` when none), the slug is `slugOf(slug || title)`, `date` is `created`, and `tags` go to properties. A missing title throws `InvalidMove`.
- A future audience (named people) is added here as another layer or rule.

## Service ([service/src/visibility.mjs](../../service/src/visibility.mjs))

The service makes no move inside the private layer.

- `previewMove?id&to[&from=private]` (member): the plan, plus `store`, `version`, `leaving`, and `waiting` requests.
- `hideBlock {id, replaces, by, reason?}` (member): only for `friends` (`NotFriendsOnly` otherwise). Sets `leaving_at` on the `blocks` or `posts` row, then journals `seal/hidden`.
  - Every friends read (`listShared`, `getShared`, `content.*`) filters `leaving_at IS NULL`.
  - The member's `listBlocks` and `getTree` show `leaving`.
  - Saving the row again keeps `leaving_at`, unless the row was removed or a post's visibility changed.
- `requestMove {block, store, from, to, version?, by: agent:*, reason?}` (member): one `waiting` request per block and target layer (`unchanged` when one is waiting already). Journals `requested`.
- `listMoveRequests?state` (member). `declineMoveRequest {id, reason?}` and `recordMove {block, from, to, request?, sealedAs?, cleanupPending?, reason?}` ask `ohm`: the member's session from ohm's pages, never a PDS token. So an agent cannot answer its own request.
  - `recordMove` with `request` requires a match (`NotThisMove`) and `waiting` (`Answered`).
  - Its state is `cleanup-pending`, `previewed` (via publish) or `done`.
- `listMoves?since&limit` (member): `moves` newest first: `seq, at, block, from, to, action, state, askedBy, approvedBy, reason, request`. It holds no titles or text, and `block` is opaque for private (`sealedAs`).
- `getPublishPlan?only=<post id>` (Publish) filters the plan and its writes to that post. The vault page opens it for `?publish=<id>`.
- Migration [0007_visibility.sql](../../service/migrations/0007_visibility.sql).

## Agent tool

`vault_set_visibility {key, to, reason?, confirm?}` ([mcp/tools.mjs](../../mcp/tools.mjs)) never writes a layer.

- The first call returns `willHappen`: the plan, `outcome`, and `alreadyAsked`.
- The second call runs `hideBlock` when `whyNot` is null, and `requestMove` otherwise.
- The key is a post's slug or ID, or a friends block's ID.
- Grants come from `<home>/.vault/grants.json`, read for each call by [mcp/server.mjs](../../mcp/server.mjs) `--home` (or `OHM_VAULT_FOLDER`). `--agent` names `by`. Without `--home`, no grant is held.

## Cockpit

A move to public from a friends-only or sealed block saves `postFile(blockAsPost(...))` under the block's vault ID (store `post`, layer `public`), then deletes the old copy (`cleanupPending` if that fails). `vault_friends_save` requires `replaces`: agents never create friends-only blocks. `vault_publish` (agent, two calls) publishes what is already marked public.

One handler, `setVisibility` in [app/src/workspace/store.ts](../../../app/src/workspace/store.ts), is used by the control, `approveMoveRequest` and the `visibility.move` WebMCP tool. `previewMove` is the dialog's text and `visibility.preview`. `sealHidden()` runs when the home opens. The flow is in [app/flows/paths.md](../../../app/flows/paths.md) C2, C3 and F3.

## Verify

`npm test` at the root. Relevant tests: `vault/test/visibility.test.mjs` (rules, hide, requests, ohm-only answers, journal, sites hidden), `vault/test/mcp.test.mjs` (the tool asks and never moves), and `app/test/visibility.test.ts` (approve, decline, version pin, seal on open, the Publish handoff). Not covered: a live Publish run of `?publish=` in a browser, and the real dialog in light and dark.
