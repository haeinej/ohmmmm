# Content reads for sites: agent reference

Human guide: [content for sites](../content-for-sites.md). Requests, takes and gives: [CAPABILITIES.md › Content](../../service/CAPABILITIES.md#content). Code: [service/src/content.mjs](../../service/src/content.mjs), [service/src/viewers.mjs](../../service/src/viewers.mjs), [service/src/capabilities/content.mjs](../../service/src/capabilities/content.mjs). Tests: [test/content.test.mjs](../../test/content.test.mjs).

## Contract

- **Requests** (`com.ohmmmm.content.*`, asks `viewer`): `listChannels`, `getChannel`, `listBlocks`, `getBlock` and `getMedia`, each with `did` = the owner. The `did` must be admitted (`MEMBERS`); otherwise the answer is `NotFound`, the same as having nothing.
- **Audience** (`audienceOf(db, owner, viewer)`): `layers` is `['public']`, plus `'friends'` when `viewer` is on the owner's friend list. `sees(audience, entry)` is the only visibility check, and `private` is always false. A future named-people audience goes here, as a field on the entry checked in `sees`, with no new request names.
- **Public** = records from `published(get, pds, owner, DOCUMENT)` (the owner's PDS, through `identify.pdsFor`), cached 60 s per `get` and owner. Posts marked `public` in the `posts` table are **not** read. Entry ID = record key; `channel` = `label/sublabel` (`other` when empty); `address` = `postPath`.
- **Friends** = the `blocks` table plus `posts` rows with `visibility = 'friends'`, through `readNode`, which must say `visibility: friends`. An ID already published wins as public.
- **Private**: `private_blocks` and posts with `visibility = 'private'` are never queried.
- **Entry fields**: `id`, `layer`, `kind`, `slug`, `channel`, `channels`, `title`, `subtitle`, `body` (in `getBlock` only), `tags`, `created`, `updated`, `media {name, alt, width, height, type}`, and `address` (public only). Never `origin`, `by`, `from` or `properties`.
- **Channels**: a path is listed if a visible entry is filed in it or in a channel inside it. `order` is the `_channel.md` order filtered to visible slugs, and `count` is the number of visible entries. A channel with nothing visible gives `NotFound`.
- **Paging**: `listBlocks` returns 200 per page, with `cursor` an offset. With `channel`, entries come in the channel's order first.
- **Media**: `getMedia` only for a `media.name` a visible entry carries. `width` gives a rendition.

## Viewer tokens

- `content.view?owner&return` (asks `nobody`, GET) answers an HTML page that form-posts to `return`. `return`'s origin must be in `sites` for the owner (`NotTheirSite` otherwise). The page posts `viewer` (the token) and `expires` (seconds), or `error` = `SignInRequired` or `NotConnected`. Its CSP is `form-action <return origin>`, with `no-referrer`.
- Token: `base64url(JSON {aud: 'com.ohmmmm.content', viewer, owner, exp}).base64url(HMAC-SHA256)`, keyed by `VIEWER_TOKEN_SECRET` (at least 32 characters, otherwise `ViewersUnavailable`). It lasts `LASTS` = 600 s. Sent as `Authorization: Bearer`. A bad signature, a different owner, an expired token or a bad viewer DID gives `ViewerTokenInvalid` (401), and never falls back to public. Friendship is checked on each read.
- Sites: table `sites (did, origin, added_at)`, migration `0006_sites.sql`. `addSite` asks `ohm` (a session from ohm's pages; agents cannot add one), while `listSites` and `removeSite` ask `member`. Origins must be https with no userinfo; the stored value is `URL.origin`.

## Verify

`npm --prefix vault test` (or the root `npm test`). `test/content.test.mjs` covers: public only from the PDS, with unpublished-public, Friends and private hidden; a friend's token adds Friends; a stranger's token gives the same answer as anyone; bad tokens are refused; removing a friend takes effect at once; media is gated; and the site allowlist, sign-in and handback. Not covered: a live PDS, the Astro loader (D1/D4), and a deployed secret.
