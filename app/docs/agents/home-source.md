# App data sources

The app is **production first**. [HomeSource](../../src/data/source.ts) is the browser data contract for the member's home, and the one the app runs on is the vault service's: [`createServiceSource`](../../src/data/service-source.ts) over the same-origin `/vault/xrpc/com.ohmmmm.*` requests ([CAPABILITIES.md](../../../vault/service/CAPABILITIES.md) is the reference). There is no sample data in `src/`. Synthetic fixtures live in [`test/fixtures/`](../../test/fixtures/) behind `createFixtureSource()`, for tests only.

## Choosing the source

On load, [`connectHome()`](../../src/workspace/store.ts) asks `com.ohmmmm.account.get` who is signed in on this origin. With a connected DID it selects `createServiceSource({ origin, did, privateSession })`; otherwise it selects nothing, and the workspace shows sign-in. `setSource(source)` selects a source directly (tests pass the fixture) and `setSource(null)` signs out. `signOut()` ends the ohm session and does the same.

[`workspace-data.ts`](../../src/data/workspace-data.ts) holds the projection for synchronous React reads: blocks, the cortex, channel records, entities, evidence, the agenda and the journal. `selectSource` reads every block once (all three layers when the private layer opens, the shared two when it is locked), every channel file, the cortex and its journal, and the agenda. A file that can't be read (it changed layer since the list, or its key isn't on this device) is left out and counted in `unreadable`; a failed load leaves the home as it was shown. `homeStatus()` is `signed-out`, `loading` or `ready`; `privateLayer` and `cortexState` are `open`, `locked` or `unavailable`.

## Writes

Every handler in the [store](../../src/workspace/store.ts) is async and writes to the source first, one at a time (`serial`), naming the version the source last gave as `replaces`. The projection changes only after the source answers (`landBlock`, `landChannel`, `landCortex`, `dropBlock`, …), and evidence is recomputed locally from the files held. A UI call that doesn't wait goes through `report()`, so a refused write (a conflict, `AccountChanged`, `PrivateLocked`) becomes a notice instead of disappearing. After a conflict, `reload()` reads the home again.

- **Blocks:** `saveBlock` / `deleteBlock` with compare-and-set. A save starts from the file the source gave (`fileOf(doc, held)`) and changes only what the workspace edits, so a media record's origin, hash and alt text, an excerpt's source, tags and `created` are kept; cortex files likewise (`cortexFileOf(doc, held)`). A new block is private: an opaque storage ID (`newOpaqueId`), with its vault TID inside the sealed file (`Doc.vaultId`). Writing one needs an unlocked device.
- **Channels:** `channels.list/read/save/move/remove`, each a `_channel.md` with its own version. The path in this API is the channel's path, not the file's. Order and identity (`id`, a TID) are properties of the file, so a moved channel keeps its identity and its evidence key (`channel:<id>`). `move` moves every channel inside and every readable block at the service in one batch; the store then refiles sealed blocks on the device and reads the home again, even if that fails partway. Moving, renaming or removing a channel is refused while the private layer is locked, since sealed blocks filed in it could not follow. A channel holding published posts is refused (`HasPosts`). A channel's `order` lists readable blocks only: a private block's slug never goes into the readable `_channel.md`, and its place waits for the sealed private overlay.
- **Visibility:** `setVisibility` uses `visibilityMove`/`moveVisibility` between the friends and private layers; public is reached only through Publish.
- **No inbox.** `HomeSource` has no `inbox`, and the projection no `inbox` list. An agent's block is an ordinary block in `blocks`, with `by: agent:<name>`, private until the member moves it. A legacy `status: proposed` reads as no status.
- **Cortex:** `cortex.list/read/save/saveMany/remove/history/readVersion/journal`, the same rules as the private layer: `{ id, ciphertext, version }`, sealed and opened on the device under the context `ohm-vault/cortex/v1`, with sealed journal entries (file ID `journal`). A cortex file is `profile.md`, `observations/<slug>.md`, `skills/<slug>.md` or `tools/<slug>.md` ([cortex-document.ts](../../src/data/cortex-document.ts)).
- **Media:** `media.has/put/get/rendition`. A media record is a block of kind `media` with `origin`, hash and metadata; only the bytes go to the cache, raw, under their content address (`mediaName`, `sha256-<hex>`).
- **Agenda:** `agenda()` is the service's counts of what waits (`unlabelled` posts and `mediaWithoutAlt`), from the readable layers.

## Keys

Pass the account app's browser `packages/keys` exports as `privateSession.keys`, and the active DID and unlocked keyring through `privateSession.unlocked` (it returns `null` when locked). Private files use the package's `vaultPrivateFiles` with `openFile` and `sealFile`; sealed files carry UTF-8 JSON `{ path, text }`. With the private layer unlocked, search matches on the device and the query stays there; locked, it covers public and Friends content.

**The cortex needs one change in that package.** `packages/keys` binds every sealed file to `ohm-vault/file/v1` and cannot seal under another context. The service source asks the keys module for `CORTEX_CONTEXT === "ohm-vault/cortex/v1"` and passes `{ context: CORTEX_CONTEXT }` to `sealFile` and `openFile`; without that export every cortex request refuses with `CortexKeysMissing`, rather than sealing cortex files as private blocks. What the package needs: an optional `{ context }` on `sealFile`, `openFile` and `rewrapFile` (default unchanged), the exported constant, a `vaultCortexFiles` store for rotation, and rotation re-wrapping the cortex under its context.

`connectHome()` does not yet receive a `privateSession`: the workspace runs with the private layer and the cortex locked until the account app's unlock is wired in.

## The journal

[`journal.ts`](../../src/data/journal.ts) is the home's timeline: the entries the sealed cortex journal holds (each `{ line, snapshots }`), then the changes made on this device. Reading the same home again (a reload, a channel move) carries this device's lines over. A line brought in from the cortex journal is history: the journal takes each node as it is now when it opens, so an edit made on another device is not logged as a change by whoever acts here next, and a node that never loaded here is never logged as removed. Each cortex write sends a sealed journal entry in that same shape, with who made the change and why, so another device reads it back. Block changes are recorded on this device; kept versions of private blocks come from the service (`history`, `readVersion`).

## Tests

Run `npm --prefix app test` (or the root `npm test`). The service source is tested over mocked `/vault/xrpc` responses: compare-and-set, routing, that the source has no inbox, the cortex refusing without its context and sealing under it, raw media. The workspace is tested over `createFixtureSource()`, which keeps the service's rules (versions, channels as files, the sealed cortex as files, kept versions) in memory. Not covered: live sign-in, the account app's unlock, and publishing.

## Workspace vocabulary

[Words](../../../docs/words.md) defines the terms.

- Blocks use the vault's seven kinds. `post` is reserved for published blocks. Body edits use the vault's `inferKind` for ordinary drafts.
- A block's ID is a 13-character TID and its graph key `block:<id>`; a sealed block's storage ID is opaque and its TID lives in the file. Secondary tree rows use `<id>/<channel path>`. Slugs remain in Markdown wikilinks and published addresses.
- A block's `by` is `me` or `agent:<name>`.
- In the graph a node is a block and an edge is a connect (`links`, `embeds`, `mentions`, whole-block `connect`); `contains` and `from` stay evidence and are not drawn. Cortex observations name the blocks they are about in `about`, and the graph draws an observation about two or more blocks as an observed edge, apart from the person's.
