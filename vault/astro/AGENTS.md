# Astro loader reference

Read the [human guide](README.md) for setup and the
[content-layer handoff](../../docs/handoff/content-layer-split.md) for ownership.

## Entry points and dependencies

`index.mjs` exports `ohm({ source, channel })` and
`pdsSource({ did, origin, channels, get?, maxPages? })`. `index.d.mts` declares
their public types. `ohm` implements Astro 5's object loader interface. Astro
calls `load({ store, parseData, generateDigest })` during content sync.

The source delegates inventory to `../feed/repository.mjs` with
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
and the loader into `dist/astro`. Their relative imports remain valid inside an
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

The initial PDS source projects a channel onto an exact `label` and optional
`sublabel`. PDS records carry these fields, while channel order and multi-channel
membership need service reads. The source makes a complete fresh inventory on
every load. It has no cross-build or cross-request cache. `get` defaults to
`fetch` and can be injected for tests. `maxPages` defaults to 200. The canonical
reader bounds pages, validates cursor progress, refuses redirects, uses a
10-second request timeout and checks owner/collection/key on each record.

## Store lifecycle and failure

Read the complete snapshot, validate its shape and IDs, await `parseData` for
every entry, and calculate digests before touching the store. Then clear and
replace the collection. This removes withdrawn and moved posts after successful
reads. Network, pagination, normalization and schema failures preserve the old
store and fail sync. A retry starts a fresh inventory. Astro serializes sync
for each collection; each loader instance writes only its assigned store.

PDS origins pass `pdsConfig` validation with HTTPS or loopback HTTP, a bare
origin and a valid DID. Reads are anonymous GET requests. Publishing is owned
by the vault's existing commands and requires the owner. Friends reads belong
in a request-time live loader once the service contract exists.

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
snapshot validation and preserved store state on failures. `test/build.test.mjs`
builds the example using real Astro with a loopback fake PDS. Install its
dependencies to enable this integration test. The repository's recursive Node
test discovery skips it with a setup message when Astro is unavailable.
The example fails its build when two entry IDs would produce one route.
`testing/fake-pds.mjs` owns the synthetic documents and HTTP server.

Update both guides, the types and the example when the contract changes. For
portable-package verification, `npm pack ./vault/astro`, install its tarball in
an isolated Astro project and run the same fake-PDS build. Browser appearance
and live PDS behavior are separate verification steps.
