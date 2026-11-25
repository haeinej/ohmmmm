---
name: migrate-site
description: Capture a site baseline and map existing public content to ohm records before moving it. Use with move-to-astro for the site rebuild.
---

# Baseline a site and map its content

The site and its source show what readers should continue to get. Take a baseline
before editing, then use it as the specification for the copy. For moving the
pages onto Astro and the ohm loader, follow [move-to-astro](../move-to-astro/SKILL.md).

## Start with the command

`ohm site scan --folder <site>` does the mechanical part of this skill for a site
folder: it inventories pages, finds what the site holds many of, maps each item's
fields and checks every repeated item can be read back exactly. Read its plan with
the owner, who names each channel. `ohm site import` brings the content into the
vault, private, and `ohm site check` compares the vault with the site.
[The contract](../../docs/agents/bring-in-a-site.md) says what it reads and writes.
The baseline below still applies to what the command does not cover: screenshots,
routes, query states and anything outside lists and articles.

## Take a baseline

Work from a recorded commit or export. Serve a read-only snapshot with the
original route behavior. Use public files or material the owner explicitly
approved for the preview, and keep capture artifacts out of public Git.

- Inventory routes from the source, sitemap and rendered internal links.
  Include aliases, redirects, query states and pages reachable by direct URL.
  Classify fragments, drafts, verification files and offline source snapshots.
- Save the rendered HTML and desktop and phone screenshots for every page.
  Record the viewport, browser, locale, route and starting state so the capture
  can be repeated.
- Record each item's exact text, title, date, position, links, media paths, alt
  text and media hashes. Count pages, items by kind and media files. For any
  owner-approved external exports, count posts and mark duplicates and variants.
- Record existing broken links, missing media and disagreements between the
  source, documentation, sitemap and rendered pages. Use the served baseline
  for comparisons.

## Map the content

Use [suggest-labels](../suggest-labels/SKILL.md) and the curator's decisions log
for the owner's labels, sublabels and channels. A decision that changes whether
something is public belongs to the owner. Keep anything outside that decision
out of the preview's public collection.

For every item, write its old URL, channel, label, slug, intended URL, original
date and content fields. [What to keep in a record](../../docs/set-up-with-an-agent.md#what-to-keep-in-the-record)
explains the shared fields. Use the shared field wherever its meaning matches.
Keep site-specific fields in the [optional layer](../../docs/schema-layers.md).
Record the source URI and platform for imported posts, and preserve text,
language variants, embeds, media and alt text. Mark the pages or fragments that
stay site-owned. List ambiguities and missing fields with the sample where they
occur, and ask about each unresolved decision once.

Check one representative item's mapped record and page against the baseline.
Keep the preparation read-only for any real PDS. When the owner needs to move
legacy records, [the migrate command](../../README.md#move-to-the-shared-post-schema)
offers a preview for the owner to review. Pass the baseline, approved map and
exceptions to [move-to-astro](../move-to-astro/SKILL.md) for the copy and parity
check.
