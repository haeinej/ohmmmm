---
name: move-to-astro
description: Move an existing site onto Astro and the ohm content loader while preserving what readers see and the URLs they use. Use after the curator and owner agree which channels the site reads.
---

# Move a site onto Astro and ohm

The site is the owner's design. Its source and rendered pages set the expected
result. [Design the home](../design-home/SKILL.md) first. Get the owner's agreed
public channels and their mapping to the site's content, and keep the agreement
with the work. Ask about an unresolved publication or label decision one at a
time. A navigation label observed on the site is evidence for the discussion.

Use [migrate-site](../migrate-site/SKILL.md) to take the baseline and make the
content map. Work on a branch or separate checkout from a recorded commit.
Keep the baseline in a second, read-only copy. For a Git-backed public site,
start with the tracked public tree and explicitly exclude any private roots.
Keep capture output outside Git unless the owner asks to retain it there.

## Check the content source

Read the [loader guide](https://github.com/haeinej/ohmmmm/tree/main/vault/astro).
You need an Astro version supported by the loader and Node 22.19 or newer.
Use a packed package from a pinned ohmmmm revision. When working with an open
loader PR, record its commit so the same preview can be rebuilt.

For the PDS source, compare the actual public `site.standard.document` inventory
with the content map before changing routes. Each mapped item needs an ohm
document with `com.ohmmmm.post` content. Legacy collections, documents from
other apps, and an empty inventory leave that PDS source without matching posts. Check
pagination, labels, sublabels, record keys, dates, and whether attachments
resolve. A successful empty response is still a coverage gap when the baseline
has pages. Keep the baseline content intact and report any missing decisions or
records.

An empty remote inventory still allows work on the Astro copy. Use the loader's
`read({ channel })` source interface with the site's existing, tracked public
content for a local preview. Keep stable IDs, channel membership, source order,
languages, original routes and complete snapshots. Preserve the authored content
and adapt it at the template boundary. Use raw rendered HTML only for reviewed,
trusted public sources. Record the adapter and its provenance in the site guides,
and report remote record coverage and integration as pending. A local PDS with
approved public content can also exercise a preview. Use synthetic data in
committed test fixtures and documentation examples. Production publication and
visibility decisions belong to the owner.

## If the site already uses Astro

1. Locate `src/content.config.*`, collection schemas, route generators and
   the components that consume entries. Record how they use IDs, fields, dates,
   image metadata and ordering.
2. Install the loader in the copy. Add an `ohm({ source, channel })` loader
   for each agreed collection. With the PDS source, map each channel to the
   agreed public label and optional sublabel. Preserve the existing collection
   names where possible and adapt entry fields at the collection or page boundary.
3. Wire the existing route generators and templates to the entries. Preserve
   URL patterns, component markup, assets, ordering and styling. Render body
   and media through the entry contract where it matches the baseline. Keep
   site-specific structure in the components. Preview one representative route
   per template before switching the remaining routes.

## If the site uses another generator, a CMS export, or HTML

1. Use the same existing site branch or checkout. Build Astro layouts and
   components from the original templates, including shared navigation and
   repeated content regions. Retain the original tags, attributes, CSS cascade,
   fonts, inline scripts, script loading order and public asset paths. Leave
   standalone applications and fixed downloads at their existing addresses.
2. Recreate the routes from the baseline, including `.html` addresses,
   directory indexes, explicitly linked aliases and redirect behavior. Preserve
   document metadata and page-language behavior. Port one representative
   route per template and compare it before porting the rest.
3. Move the mapped public content into `ohm` collections and wire those
   collections into the new templates. Keep design assets and site-owned copy
   where the templates can reach them. Decide source coverage item by item
   before removing a public content file. Site-specific structure such as a
   language switch belongs in the template. Record which approved field or
   site-owned source supplies each language's text.

## Compare and bring the owner the copy

Build both copies and serve them locally with the same route handling. Compare
every baseline route and relevant query state, including pages absent from the
sitemap. Use the same browser, desktop and phone viewports, and initial content
state. Compare rendered screenshots, visible text, markup, metadata, dates,
order, links, navigation and behavior. Verify media paths, alt text and hashes
where bytes are available. Check the built output for duplicate routes and
unintentionally widened access to source snapshots, drafts, and private files.

Check the preview server's redirects, slashless directory paths, query retention,
directory-listing policy and media byte ranges against the baseline. An Astro
build with identical files can still behave differently under another server.
Use equivalent static-server options and capture those options with the evidence.
Where possible, compare the complete output path inventory and file bytes before
browser checks, including copied assets and source fragments.

Where the site's style guide, generator, sitemap and committed pages disagree,
record the discrepancy and use the served baseline for parity. Test query
filters and language toggles independently of page inventories. Classify HTML
fragments, verification files and offline source snapshots before moving
templates. Preserve their existing access status and compare the public routes
separately from source materials.

Report matching and differing routes, counts by kind, extra or missing routes,
the files changed, what the loader reads, and any gaps in coverage. Show the
owner the preview and wait for their approval before anything replaces the
live site. A branch or PR is the review copy. Keep publication, deployment and
merging under the owner's control.

See [the site owner's guide](README.md) for the review and approval experience.
