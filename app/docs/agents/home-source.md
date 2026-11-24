# App data sources

[HomeSource](../../src/data/source.ts) is the browser data contract for versioned
vault files, ordered channels, evidence, entities, sources, search, history,
visibility, Friends and the publish plan. [The workspace guide](../../README.md)
walks through the sample experience. The [workspace store](../../src/workspace/store.ts)
selects the adapter with `setSource()`. The default is the sample adapter.
The store projects the selected source's account, blocks, channels and evidence
for synchronous React reads. Sample edits call `saveBlock` or `deleteBlock`
with the projected version, then refresh the projection. The sample also
implements `saveChannels` for channel records and `markVisibility` for audience
previews. History restore reads the source's kept version. Search, the graph,
and both views of the connections card use the selected source. Cortex, inbox
and the prototype's journal metadata remain sample features. Sample channel
renames preserve the UI record ID through the synthetic `sampleId` property.
Evidence keys still use the channel path.

There are zero direct fixture imports outside the sample adapter. The file
[`workspace-model.ts`](../../src/data/workspace-model.ts) holds view types and
pure helpers, and [`workspace-data.ts`](../../src/data/workspace-data.ts) holds
the projection. Use `createSampleSource()` for an independent fixture in tests.

Call and await `setSource({ service: { origin, did } })` to construct and select
a service adapter, or pass a constructed adapter to `setSource(source)`. The
workspace exposes a read-only public and Friends projection for service adapter
verification. The app starts on samples and live session integration is a later
step. `localSource` still refuses with `NotSupportedError`: the bridge,
`ohmmmm serve`, now exists ([docs/serve.md](../../../docs/serve.md)), and the
local source over it is the next step. Pairing (`src/data/bridge.ts`) and the
media cache's read through the bridge are built.

Use `listBlocks` and `readBlock` to find a file and its version. Pass that exact
version as `replaces` to update it, or `null` to create it. Refresh and review the
current file after a conflict. `vault()` returns the canonical
[`readVault`](../../../vault/vault/node.mjs) view, including entities and sources.
Use `vault.items(channel)` for resolved order and `connections()` for the vault's
evidence edges. This interface serves the workspace. Cortex continues to read
through its [read-only vault contract](../../../contract/vault-reader.mjs).

`createServiceSource({ origin, did })` uses the member's same-origin
`/vault/xrpc/*` session. The DID selects the signed-in account's vault. The
[service](../../../vault/service/CAPABILITIES.md) validates access. Shared reads
require `sharedServiceToken` for the reader's DID and the exact request method.
Use the account app's browser `packages/keys` exports as `privateSession.keys` and
supply the active DID and unlocked keyring through `privateSession.unlocked`.
The callback returns `null` on lock. Private reads and writes use the package's
`vaultPrivateFiles` with `openFile` and `sealFile`. Sealed files carry a UTF-8 JSON
vault file with `path` and `text` inside. When unlocked, search matches locally
and the query stays on the device. With the private layer locked, search covers
public and Friends content.

Call `visibilityMove` before asking the member to confirm. A Friends-to-private
move writes the sealed copy first, then removes the readable copy using its
original version. `cleanupPending` means the destination write succeeded and
removal requires review. For a private destination, supply a random opaque
storage ID and keep it with the pending move so you can inspect the destination
if a write response is lost. The vault TID stays inside the sealed file.
A private-to-Friends copy discloses its contents to
the vault service and friends. Publication starts with `publishPlan`, which
previews the changes. The member-facing confirmation and publishing flows can
use these operations when connected.

After `npm ci --prefix app`, run `npm --prefix app run build` and
`npm --prefix app test` with only the app installed. Vite and the Node test
resolver both use the app's Markdown packages when loading the shared vault
renderer. CI runs the app tests before installing vault dependencies. For the
whole repository suite, install the vault and vault service dependencies as
listed in the [root README](../../../README.md) and run `npm test`. The app
typecheck includes test files. Adapter tests cover
the selected workspace, compare-and-set, XRPC routing and a synthetic keys
fixture. Live sign-in, the account app's unlock screens, and publishing
await app integration and live verification. Kept versions in the service
adapter currently cover private files. The local source is to be built over
`ohmmmm serve` (decided: hosted, with the bridge when it runs).

## Workspace vocabulary

[Words](../../../docs/words.md) defines the terms. The sample projection uses these contracts.

- Blocks use the vault's seven kinds. `post` is reserved for published blocks. The shared `createDraft` handler takes `homeChannel`, and body edits use the vault's `inferKind` for ordinary drafts. The legacy post XRPC payload still has its `label` and `sublabel` fields.
- [PageEditor](../../src/editor/PageEditor.tsx) keeps the title input's whitespace while the draft matches the saved title after trimming. This lets the next word follow a typed space while autosave round-trips through the vault's normalized title. Blurring the field shows the saved title.
- Use a 13-character TID for a block ID and `block:<id>` for a vault graph key. Secondary tree rows use `<id>/<channel path>`. The same TID identifies every placement. Slugs remain in Markdown wikilinks and published addresses.
- Channels are navigated by path. The sample's original channel record ID stays a fixture field until channels carry the `id` in `_channel.md` ([vault/plans/renames.md](../../../vault/plans/renames.md)). The vault's evidence kinds are `contains`, `links`, `embeds`, `mentions`, `from` and `quotes`. Whole-block links use `links`; their sample-only reason is presentation metadata.
- **Media blocks** ([vault/plans/media.md](../../../vault/plans/media.md)). An image is a block of kind `media` whose body embeds its file (`![[wet-street.png]]`) and whose properties are `hash` (the bytes' CID: CIDv1, raw, SHA-256, the vault's `blobCid`), `mime`, `width`, `height` and `alt`; `Doc.media` holds them. `addImage` in `store.ts` makes one (private, in the given channel), or collects the existing one with the same `hash`. A text embeds it with `![[slug]]` on a line of its own: the editor's `embed` node (`src/editor/embed.ts`) keeps that Markdown exactly, and `resolveEmbed` (`src/media/embeds.ts`) finds a block by slug, then a media block by file name (the embedding channel first), then by title. Embeds are evidence of kind `embeds`; `outgoing` and `incoming` list them with links.
  - **Bytes** live in the media cache, `src/media/cache.ts`: IndexedDB `ohm-media`, store `bytes`, keys `<cid>` and `<cid>@<width>` (320, 960, 1920; WebP where the browser writes it; only below the original's width). `setMediaBackend` swaps it; tests give `memoryBackend(map)`, and calling it again is a closed tab.
  - **The guard:** `updateBody` calls `assertDurable`, so `saveDraft`, `autosave` (the editor's debounce and its flush on leaving) and `openFile` refuse a body with a `blob:` or `data:` address as an image or link target outside code, with `DataError`. The editor's image extension takes only `http(s)` images from pasted HTML.
  - **Export:** `exportBlock` (async, reads the cache) and `exportNow` (sync, for a drag; null until `preload` has loaded the originals) give `{ name, type, bytes, images, missing }`: the `.md` alone, or a stored `.zip` with the `.md` and `assets/<file>`, each media embed rewritten to `![alt](assets/<file>)`. `drop.ts` writes it into the drag's `DownloadURL` as a `data:` URL, so the file needs no open tab.
- Search uses the `entities` scope and `entity` hits. The sample keeps vault block changes and cortex file changes in separate histories; the home timeline reads both. Cortex observations name the blocks they are about in `about`, keep the versions they were written against as `{ node, version }`, and never become vault edges: the graph draws an observation about two or more blocks as an observed connection.

Run `npm --prefix app test` from the repository root to verify the sample paths and service fixtures. See the [human guide](../../README.md#blocks-channels-and-history) to walk through the workspace.
