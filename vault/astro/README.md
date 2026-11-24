# Read ohm posts in Astro

Your Astro site can build pages from your published posts and show Friends
content to people you have approved. Your layouts, styles and routes stay
under your site's control. The ohm service supplies both sources from your DID.

## Start with a copy

Use a branch or a separate checkout of your site. You need Node 22.19 or newer,
Astro 5 and a checkout of this repository. The package is named `@ohmmmm/astro`
for local installation and can be packed from this folder. Registry publication
is a separate owner decision.

You need your DID, the ohm service origin, and your public site's origin.
If you also configure the PDS source, its origin tells the loader where it can
read public posts directly. Your repository must contain ohm posts published as
`site.standard.document` records with `com.ohmmmm.post` content. The loader reads
them anonymously. A repository with no matching documents gives an empty
collection. Documents from other applications are passed over.

From your ohmmmm checkout, build a portable package.

```sh
npm ci --prefix vault
npm pack ./vault/astro --pack-destination /path/to/packages
```

From your Astro site's copy, install that tarball.

```sh
npm install /path/to/packages/ohmmmm-astro-0.1.0.tgz
```

The package includes the vault's existing record reader and renderer, plus their
Markdown dependencies. Astro remains a dependency of your site.

## Map a collection

In `src/content.config.ts`, choose the public label that feeds the collection.
Use the labels and channel names already agreed with the owner.

```ts
import { defineCollection } from 'astro:content';
import { ohm, pdsSource, serviceSource } from '@ohmmmm/astro';

const did = 'did:web:alice.example.com';
const fallback = pdsSource({
  did,
  origin: 'https://pds.alice.example.com',
  channels: { essays: { label: 'essays' } },
});
const source = serviceSource({
  did,
  origin: 'https://ohm.example.com',
  site: 'https://alice.example.com',
  fallback,
});

export const collections = {
  essays: defineCollection({ loader: ohm({ source, channel: 'essays' }) }),
};
```

The service reads an exact channel path, such as `essays` or `essays/field-notes`,
and returns its entries in channel order. The optional PDS fallback selects all
posts with its configured label. Add `sublabel` to narrow that mapping. If you
have a PDS and no ohm service account, set `source` directly to `pdsSource(...)`.

Entries have a stable repository key as `id`, Markdown as `body`, rendered HTML,
and `data` containing the title, subtitle, dates, slug, label, canonical URL,
permalink and document URI. The service source constructs the canonical URL from
`site` and the service's public address. It can resolve links to other posts in
the same collection. Links to entries outside the collection retain their
AT Protocol addresses.

The current service response omits public PDS attachments and the original
canonical URL field. Use the direct PDS source if your templates need those
fields. With that source, `data.media` contains attachment IDs, kinds, blob
URLs, alt text, captions and posters. The PDS renderer resolves `media:`
references and links to other public posts using their stored canonical URLs.

Query and render an entry in an Astro page.

```astro
---
import { getCollection, render } from 'astro:content';
const [entry] = await getCollection('essays');
const { Content } = await render(entry);
---
<h1>{entry.data.title}</h1>
<Content />
```

Your route generator must serve each entry's `data.permalink`, or provide
redirects when preserving existing URLs. The [example](example/src/pages/)
shows a list, post routes and the standard.site discovery link. A site's
collection can supply an Astro schema to validate `data` and give it static types.

## Show Friends content

Friends pages need a server adapter for your Astro host and must render on
request. Enable `experimental.liveContentCollections` in Astro 5 and add a
live collection in `src/live.config.ts`.

```ts
import { defineLiveCollection } from 'astro:content';
import { ohmLive } from '@ohmmmm/astro';
import { source } from './service';

export const collections = {
  friends: defineLiveCollection({ loader: ohmLive({ source, channel: 'essays' }) }),
};
```

The owner adds the site's HTTPS origin in ohm. The site sends the viewer to the
service's `content.view` endpoint and receives a short-lived viewer token at
its server callback. Keep the token in the viewer's server session or an
HTTP-only secure cookie and pass it to
`getLiveCollection('friends', { viewerToken })` or
`getLiveEntry('friends', { id, viewerToken })`. A signed-out viewer gets an
empty Friends collection. The service checks the owner's friend list and
channel permissions each time. The site controls viewer sign-in, the callback,
and the experience when an entry is unavailable. [Content for sites](../docs/content-for-sites.md)

Use `Cache-Control: private, no-store` for Friends HTML, data and media.
If a page shows media, configure `mediaPath` with a local route. That route
uses the same viewer session to call `source.readMedia()` for each request
and forwards the response. The loader renders a media block's own
`![[file.png]]` embed through it. Keep viewer tokens out of URLs and rendered
pages. See the [Friends example](example/friends/) for the Astro pages and
media route. It uses an existing viewer cookie. Connect your site's callback
and server session before using it with real viewers.

## Try the example and recover from errors

From the ohmmmm checkout, install its example dependencies and build.

```sh
npm ci --prefix vault/astro/example
OHM_DID=did:web:alice.example.com OHM_SERVICE=https://ohm.example.com OHM_SITE=https://alice.example.com OHM_PDS=https://pds.alice.example.com npm --prefix vault/astro/example run build
```

Use your own DID and origins for a real preview. When `OHM_SERVICE` is set,
`OHM_SITE` is required so canonical links point to your site. Run `npm --prefix
vault/astro/example run dev` with the same environment to serve it locally.
The generated files live in the example's ignored `dist/` folder. Each build
reads the current public records. Rebuild after publishing or withdrawing a post.

The service can return its last public copy when it cannot reach the PDS.
When the service has no public copy, is unavailable or cannot find the member,
the configured fallback reads the PDS. If the read still fails, or the inventory
or schema is invalid, the build fails and preserves the previous collection in
Astro's store. A successful empty result clears the collection, including
withdrawn posts.
The example rejects duplicate permalinks. Give colliding posts unique slugs
before rebuilding, or adapt your own site's routing to their stable entry IDs.

Review the copy against your site's baseline and obtain the owner's approval
before replacing the live site. The [move-to-Astro skill](../skills/move-to-astro/SKILL.md)
describes the baseline and content map.

## Verify locally

```sh
npm ci --prefix vault/astro/example
npm --prefix vault/astro test
npm test
```

The tests use a fake PDS and service. They exercise Astro's static builds and
request-time Friends collections and media. Live PDS and service compatibility
and visual parity with a particular site need their own checks.
[Agent reference](AGENTS.md)
