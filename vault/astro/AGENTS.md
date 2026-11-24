# Astro loader reference

Read the [human guide](README.md) for setup and the
[content-layer handoff](../../docs/handoff/content-layer-split.md) for ownership.

## Entry points and dependencies

`index.mjs` exports `ohm({ source, channel })`, `pdsSource(...)`,
`serviceSource(...)` and `ohmLive({ source, channel })`. `index.d.mts` declares
their public types. `ohm` implements Astro 5's object loader interface. Astro
calls `load({ store, parseData, generateDigest })` during content sync.

The PDS source delegates inventory to `../feed/repository.mjs` with
`collection: CONTENT`. That reader queries `site.standard.document` and invokes
`fromDocument` from `../feed/standard.mjs`, skipping documents whose content
belongs to another app. Preserve that codec and its URI rewrite. The loader
returns the wire document URI in `data.uri`.

`normalizeArchivePost` in `../feed/pds.mjs` validates and normalizes the decoded
post, and resolves blob URLs. `renderArchivePost` in `../feed/render.mjs`
supplies the canonical Markdown, footnote and media rendering. Owned short
post links are expanded to the referenced post's normalized permalink using the
complete inventory. Posts outside this collection keep their canonical URL.
Keep the site's routes compatible with these permalinks.

`build.mjs` copies these canonical feed modules and `forms.mjs` into `dist/feed`
and the loader and service source into `dist/astro`. Their relative imports remain valid inside an
installed tarball. `npm pack` runs this build through `prepare`. Edit the authored
files and rebuild. The output is ignored. Package dependencies provide
`markdown-it` and `markdown-it-footnote`; the consuming site supplies Astro.
Keep the copy allowlist complete if canonical modules gain imports.

## Source contract

A public source implements `read({ channel })`, returning a Promise of a
complete `OhmEntry[]` snapshot for that channel. Each entry has a nonempty,
unique, stable string `id`, a serializable `data` object, Markdown `body` and
`rendered: { html }`. `data` follows `OhmData` in `index.d.mts`. The source owns
authorization, channel membership and rendering. HTML must be safe for Astro's
`render()` because it is embedded directly. Only public data may reach this
build-time interface.

The PDS source projects a channel onto an exact `label` and optional
`sublabel`. PDS records carry these fields. The source makes a complete fresh inventory on
every load. It has no cross-build or cross-request cache. `get` defaults to
`fetch` and can be injected for tests. `maxPages` defaults to 200. The canonical
reader bounds pages, validates cursor progress, refuses redirects, uses a
10-second request timeout and checks owner/collection/key on each record.

## Service source

`serviceSource({ did, origin, site, fallback?, mediaPath?, get?, maxPages? })`
uses C2's [Content requests](../docs/agents/content-for-sites.md). `origin` is
the service origin, and `site` is the origin used for public canonical links.
Requests use bounded timeouts, refuse redirects, and ask for no caching. They
require the expected owner on JSON responses and bound and validate pagination.
The source follows service order, fetches bodies with `getBlock`, and
rechecks channel and layer on every detail read.

`read({ channel })` uses anonymous requests and accepts only the public layer.
It accepts a service snapshot marked `publicStale`. With a configured
fallback, a service transport error, 5xx, `publicUnavailable`, or a 404
during listing triggers a fresh read of the entire public channel from the
fallback. A missing detail after successful listing fails the snapshot.
Malformed replies fail before the Astro store is touched.

Public projection uses the service's `address` as `permalink`, resolves it
against `site` for `canonicalUrl` and constructs the document URI from the DID
and record key. Public PDS attachments, original canonical URLs and
additional PDS fields are absent from the C2 response. Use the direct PDS
source when those fields are required. The service source rewrites own
post links within the selected collection and retains other AT links.

## Friends requests

Enable Astro 5's `experimental.liveContentCollections`. Register
`defineLiveCollection({ loader: ohmLive({ source, channel }) })` in
`src/live.config.ts`. The site owns the server callback for `content.view`,
the session and token expiry. Bind the form handback to the viewer's
sign-in attempt, for example with a single-use state value in the allowed
return URL and the associated server session. Treat a posted `error` as a
failed sign-in, and restrict the handback to the configured site and service
origins. Keep tokens in server-side session state or a secure, HTTP-only
cookie with a lifetime no longer than the service's. Pass the token from
each request to `getLiveCollection` or `getLiveEntry` via `{ viewerToken }`.

`ohmLive` calls `listFriends` and `getFriend`. Without a token the collection
is empty and a single lookup returns a generic 404. With a token only the
Friends layer is returned. A service 401 remains a 401. A hidden, missing,
public or out-of-channel entry returns the same 404. Use generic errors
that omit filter contents. Astro's own missing-entry error can include
its lookup argument. No live results enter a build store or shared cache.
Render on request and set `Cache-Control: private, no-store` on every response
that depends on the viewer session.

Friends `data.media` is metadata for the content address the block names.
`mediaPath(name)` optionally supplies its same-origin route for the renderer
and templates. Forward the current viewer token only from that server route
to `readMedia({ name, viewerToken, width? })`. This calls C2's `getMedia` for
each request and overrides its response's cache lifetime with
`private, no-store` while preserving its content type and download headers.
The service authorizes the file against current visibility.

## Store lifecycle and failure

Read the complete snapshot, validate its shape and IDs, await `parseData` for
every entry, and calculate digests before touching the store. Then clear and
replace the collection. This removes withdrawn and moved posts after successful
reads. Network, pagination, normalization and schema failures preserve the old
store and fail sync. A retry starts a fresh inventory. Astro serializes sync
for each collection; each loader instance writes only its assigned store.

PDS origins pass `pdsConfig` validation with HTTPS or loopback HTTP, a bare
origin and a valid DID. Reads are anonymous GET requests. Publishing is owned
by the vault's existing commands and requires the owner.

## Checks and maintenance

Run from the repository root with Node 22.19 or newer.

```sh
npm ci --prefix vault
npm ci --prefix vault/astro/example
npm --prefix vault/astro test
npm test
```

`test/loader.test.mjs` covers paginated reads, foreign documents, channel
selection, media and own links, stable keys, changed digests, withdrawals,
snapshot validation and preserved store state on failures. `test/service.test.mjs`
exercises C2 projection, pagination, fallback, audience isolation, errors,
revocation, and protected media. `test/build.test.mjs` builds the public example
and serves the Friends example using real Astro and loopback test doubles. Install its
dependencies to enable this integration test. The repository's recursive Node
test discovery skips it with a setup message when Astro is unavailable.
The example fails its build when two entry IDs would produce one route.
`testing/fake-pds.mjs` owns the synthetic documents and HTTP server.

Update both guides, the types and the example when the contract changes. For
portable-package verification, `npm pack ./vault/astro`, install its tarball in
an isolated Astro project and run the same fake-PDS build. Browser appearance
and deployed PDS and service behavior are separate checks.
