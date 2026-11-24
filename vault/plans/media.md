# Images as blocks

**Status:** decided by the owner, 24 November 2026. Step 1 (the app) is built. Fixes [#30](https://github.com/haeinej/ohmmmm/issues/30). Builds on [standard-site.md](standard-site.md) (media is its own document, its bytes in the media cache) and [content-layer.md](content-layer.md) (sites read media from ohm's media cache).

## Why

When an image is inserted, the editor puts a temporary browser address (`blob:`) into the block's text (`insertImageFiles` in `app/src/editor/commands.ts`). The address dies with the tab. A downloaded or dragged-out `.md` (`app/src/workspace/drop.ts`) leaves the image behind, and autosave can keep the dead address in the block.

The vault already treats a file the way Are.na treats an image: `ohm vault add photo.jpg` copies the file in and writes a block beside it that embeds it (`vault/vault/add.mjs`). The editor should make the same thing.

## Decided

- **An image is one block:** a `media` block with its own title, alt text, origin, channels and visibility.
- **It sits beside other blocks, and it can be embedded.** In a channel it is an item like any other. Any text can show it inline with `![[street]]`. Both work, always.
- **The original lives in the home folder,** as the file it came as.
- **Sizes are made on the device.** A private image's sizes are sealed with it, so a newly linked device can show a small one first.
- **Renaming never breaks an embed** ([renames.md](renames.md)).

## The model

A media block in the home folder is two files, as `ohm vault add` writes them now:

```
reading/
  street.jpg     the original, untouched
  street.md      the media block: title, alt, origin; its body is ![[street.jpg]]
```

- **The block is the thing; the file is its bytes.** Channels, links, embeds and visibility belong to the block. A text embeds the block (`![[street]]`), so the alt text lives in one place. Embedding the file (`![[street.jpg]]`) still works, as today.
- **Bytes are named by their hash:** a CID (v1, raw, SHA-256). It is the `blobCid` the index already computes, and the same name AT Protocol gives a blob. The media block records it as `hash`, so a store without the file (the browser, the service) can still find its bytes; in the home folder the index checks it against the file and reports a mismatch. A record that leaves the home folder (for the service or the PDS) carries it as the `hash` of `com.ohmmmm.content.media`.
- **The same image twice is one block.** Adding a file whose hash a media block already has puts that block in the new channel, as Are.na's "connect" does, instead of making a copy.
- **A media block's properties** are `hash`, `mime`, `width`, `height` and `alt`. The app writes them today, and the vault reads them as a block's other properties; step 2 makes them known fields (`BLOCK_FIELDS` in `vault/vault/node.mjs`, lexicon `com.ohmmmm.vault.block`).

Where the bytes are kept:

| Place | Holds | Named by |
| --- | --- | --- |
| Home folder | The original, beside its block | Its path |
| `.vault/cache/sizes/<cid>/` | Sizes: derived, and rebuilt when missing | CID and width |
| The browser (IndexedDB `ohm-media`) | Originals not yet in the home folder, and their sizes | CID, and `<cid>@<width>` for a size |
| Vault service | Friends: readable copies. Private: the original and its sizes, sealed | CID; a sealed one under an opaque ID |
| PDS | Public: the blob, written when the block is published | CID |

## From the app

1. **Drop, paste or pick an image,** or an agent gives one through `workspace.add-image`. The app hashes it with Web Crypto, keeps it in the browser's storage under its CID, and asks for persistent storage (`navigator.storage.persist()`).
2. **A media block is made** in the channel being worked in. An image dropped into a text also puts `![[<slug>]]` where it landed. An image dropped on a channel is only an item there.
3. **It is written to the home folder** through `ohmmmm serve` (journaled `via: add`, `by: me`). With no bridge running, the block and its file wait in the browser, marked "not in your home folder yet", and are written there the next time the bridge is on.
4. **One resolver shows images:** CID → browser storage → `ohmmmm serve` (`/media/<cid>`) → vault service → PDS. A temporary `blob:` address may *show* an image, but a saved body only ever holds `![[…]]`. Saving refuses a body with a `blob:` or `data:` image address on every path, including the navigation flush.

## Sizes

- **Made where the original is:** in the browser, or by `ohmmmm serve`. The service never processes images, so one path serves every layer.
- **Widths** 320, 960 and 1920 px, as WebP, and never larger than the original.
- **Private:** each size is sealed with the original's file key and kept beside it in the private store.
- **Public sites:** Astro makes the site's own sizes from the public original at build time (`astro:assets`, through the loader).

## Export

- **A block that embeds nothing** stays a plain `.md`.
- **A block with images** downloads and drags out as a `.zip`: the `.md` plus `assets/`. Inside the zip each embed is standard Markdown, `![alt](assets/street.jpg)`, so any app can read it. The zip is prepared when the block changes, because a drag has to hand over its file at once.

## Who sees an embed

- **An embed shows only to someone who can read the embedded block.** A Friends text that embeds a private image shows friends an empty place, never the image.
- **Publishing a text lists the images it embeds.** When one is not public, Publish asks to publish it with the text. It is never published silently.
- **A media block's page shows where it is used:** every channel it is in, and every block that embeds it (the `embeds` evidence).

## Done when (#30)

- A downloaded or dragged-out block with an inserted image opens with its image after the original tab is closed.
- Autosave, its debounce and the navigation flush never write `blob:` or `data:` into a body.
- A test inserts a synthetic image, closes the tab, reopens the export, and checks the saved body.

## Order

1. **App, on the sample adapter.** Built: media blocks (`addImage` in `app/src/workspace/store.ts`); an embed node in the editor that reads and writes `![[…]]` (`app/src/editor/embed.ts`); the media cache by CID, with sizes (`app/src/media/cache.ts`); export as a zip (`app/src/media/export.ts`); the save guard; the `workspace.add-image` tool; and the regression test (`app/test/media.test.ts`). This closes #30 without the bridge. Still to come in the app: editing a media block's alt text.
2. **Vault.** `alt` on media blocks; an add with a known hash connects the existing block; `.vault/cache/sizes/`; the docs, and `docs/words.md` (media cache, size).
3. **`ohmmmm serve`** ([app handoff](../../docs/handoff/devin-ohmmmm-app.md), WP4e) writes media blocks into the home folder and serves `/media/<cid>`.
4. **Service.** Sealed media for the private layer and readable media for Friends. This needs storage for large bytes, which the service does not have yet (it has D1 only).
5. **The loader** ([content-layer split](../../docs/handoff/content-layer-split.md), D1 and D4) reads media from the media cache.

## Open

- Video and audio follow the same model, with a poster frame as their only size. Not in the first cut.
- Whether an image dropped on the graph or the tree goes into the selected channel, or asks which one.
