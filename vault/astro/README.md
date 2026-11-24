# Read ohm posts in Astro

Your Astro site can build pages from the public posts in your PDS. Its layouts,
styles and routes stay under your site's control. The `ohm` loader supplies the
entries queried with Astro's `getCollection()` and rendered with `render()`.

## Start with a copy

Use a branch or a separate checkout of your site. You need Node 22.19 or newer,
Astro 5 and a checkout of this repository. The package is named `@ohmmmm/astro`
for local installation and can be packed from this folder. Registry publication
is a separate owner decision.

You need your DID and PDS origin because they identify the repository to read.
That repository must already contain ohm posts published as
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
import { ohm, pdsSource } from '@ohmmmm/astro';

const source = pdsSource({
  did: 'did:web:alice.example.com',
  origin: 'https://pds.alice.example.com',
  channels: { essays: { label: 'essays' } },
});

export const collections = {
  essays: defineCollection({ loader: ohm({ source, channel: 'essays' }) }),
};
```

The PDS holds public posts and their labels. A mapping here selects all posts
with that label. Add `sublabel` to narrow it. Channel membership and ordering
will come from the service's content reads when they are available. For now,
choose the display order in your page, for example by `publishedAt`.

Entries have a stable repository key as `id`, Markdown as `body`, rendered HTML,
and `data` containing the title, subtitle, dates, slug, label, canonical URL,
permalink, document URI and media references. `data.media` contains each
attachment's ID, kind, URL, alt text, caption and poster. Images and attachments
are read from the public PDS blob endpoint. The supplied HTML resolves
`media:` references and links to the member's own posts. Links within the
collection use local permalinks. Links to other public posts use their canonical URL.

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

## Try the example and recover from errors

From the ohmmmm checkout, install its example dependencies and build.

```sh
npm ci --prefix vault/astro/example
OHM_DID=did:web:alice.example.com OHM_PDS=https://pds.alice.example.com npm --prefix vault/astro/example run build
```

Use your own public DID and PDS origin for a real preview. Run `npm --prefix
vault/astro/example run dev` with the same environment to serve it locally.
The generated files live in the example's ignored `dist/` folder. Each build
reads the current public records. Rebuild after publishing or withdrawing a post.

A failed request, incomplete inventory, malformed owned post or schema error
fails the build and preserves the previous collection in Astro's store. Correct
the record or configuration, restore PDS availability, and build again. A
successful empty result clears the collection, including withdrawn posts.
The example rejects duplicate permalinks. Give colliding posts unique slugs
before rebuilding, or adapt your own site's routing to their stable entry IDs.

Public entries are included in static output. Friends content requires a
request-time source and Astro live collections in a later step. Review the copy
against your site's baseline and obtain the owner's approval before replacing
the live site. The [migration skill](../skills/migrate-site/SKILL.md) describes
the baseline and content map.

## Verify locally

```sh
npm ci --prefix vault/astro/example
npm --prefix vault/astro test
npm test
```

The loader tests use synthetic documents served by a loopback fake PDS. The
example build test exercises Astro's actual collection and rendering APIs.
Live PDS compatibility and visual parity with a particular site need their own
checks. See the [agent reference](AGENTS.md) for the source contract.
