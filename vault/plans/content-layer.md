# The content layer: Instagram for websites

**Status:** proposed, 24 November 2026. Changes what the vault is for and removes the inbox. Builds on [the standard.site plan](standard-site.md) (PR #36), which is unchanged by this one.

## Why

The goal is an extension of Instagram for websites: one place where everything you make lives, and your website is a view of it. That is a CMS, and specifically its content layer. It is why Astro and EmDash keep coming back.

So far the vault has been built around publishing: rebuilding a site identically, the mirror, the feed Worker rendering pages, the publish plan. In this framing those are plumbing. **The product is the content layer.** Publishing and plugins are things the vault does inside itself, and that we manage.

| Instagram | ohm |
| --- | --- |
| You post in the app | You write or draft with your coding agent. It pulls content in and adds to it, in your vault. The cockpit is where you see, arrange and decide |
| Your profile grid | Your website: a view of your channels |
| Public / Close Friends / only you | Public / Friends / private, the three layers |
| The feed and following | AT Protocol: other apps read your `site.standard.document`s |

## How content gets in: you and your coding agent

There is no inbox and no review queue. You write or draft with your coding agent, in your vault:

- **Write and draft:** the agent writes blocks into the channel you are working in, with you.
- **Pull in:** it brings content in from where it already is (notes, photos, a site's source, a feed), as blocks and media records, with `origin` saying where each came from.
- **Augment:** it adds to what is there: titles, alt text, links between blocks, a channel's description, labels you have agreed.

What keeps you in control, without an inbox:

- **Provenance:** every block an agent made says so (`by: agent:<name>`), and every change goes into the journal with who made it. History keeps each version, so anything can be put back.
- **Visibility:** what an agent writes starts private (or in the channel's layer if that is narrower), until you move it. Showing a block to more people is always yours (standard.site plan, step 2).
- **Grants:** an agent writes only where you granted it (`ohm vault grant`, `.vault/grants.json`). Setting up a home (`design-home`) ends by granting the channels you agreed.
- **Labels:** still the owner's words. The agent proposes and asks; it never decides.

## Remove the inbox

The inbox is the channel `inbox`, the `status: proposed` mark, and keep/decline. All of it goes. `cortex/` keeps its own "proposed" memories: that is not the inbox and is untouched.

| Where | What changes |
| --- | --- |
| `vault/vault/add.mjs` | `addToVault` needs a `channel` (no default); an agent's block gets `by`, never `status: proposed`; no `inbox/_channel.md` |
| `vault/mcp/local.mjs` | `vault_capture` needs a channel and a `write` grant for it, like `vault_write`; the `always` list drops "capture into the Inbox"; the result has no `status` |
| `vault/vault/grants.mjs` | The comment's fallback ("may still capture into the Inbox") goes: no grant means read, search and collect only |
| `vault/vault/lint.mjs` | The `proposed` list goes |
| `vault/vault/node.mjs`, lexicons `com.ohmmmm.vault.block` / `channel` | `proposed` leaves the known statuses, `inbox` leaves the channel kinds. Old files that still say `status: proposed` read as ordinary blocks |
| `vault/service/src/channels.mjs`, `capabilities/channels.mjs`, `capabilities/structure.mjs` (PR #33) | `keepProposed`, `declineProposed`, `NotProposed`, the inbox guards, and the agenda's `proposed` and `waiting` counts go. CAPABILITIES.md regenerated |
| `app/` (PR #33) | `Inbox.tsx`, the rack's inbox button, the `inbox` side and view, `inbox.keep` / `inbox.decline` tools, `source.inbox`, `INBOX`, `workspace-data`'s `inbox` list, the fixtures and the tests for them |
| Docs | `vault/docs/vault-format.md` and its agent twin, `vault/skills/vault/SKILL.md`, `vault/service/README.md`, `app/README.md`, `app/flows/paths.md` (section F becomes notifications only) and `workspace.md`, `app/docs/agents/home-source.md`, `docs/words.md` |

Most of this lives on `home/production-wiring`, so it lands there before PR #33 merges. The rest (vault core, local MCP, lexicons, docs on `main`) goes in the same branch.

## Sites read from the content layer

Today we rebuild a site and swap where its content is read from. Instead, any Astro site, EmDash included, reads ohm through Astro's content layer:

- **An `ohm` loader package.** Channels become collections and blocks become entries, with media as image references served from ohm's media cache. A site maps its collections to channels in its config, and its design stays its own.
- **Public at build time,** from a content loader over the vault service's public reads.
- **Friends at request time,** through Astro's live collections and the viewer's ohm session, on a server-rendered route. A static build can never hold Friends content, so this split is required, not a choice.
- **One content API: the vault service.** The PDS stays the public record other apps read. Sites read through the service, because only it can answer for Friends and render media. The loader starts on the PDS only because the service has no reads for anyone yet, and keeps that source for sites with no ohm account.
- **The curator moves a site onto Astro.** The curator (`vault/agents/curator.md`, PR #34) already screens a site and agrees its channels with the owner. It gains a skill, `vault/skills/move-to-astro/`, that it follows next:
  - **A site already on Astro:** add the loader, map its collections to the channels agreed, and check every page against a baseline.
  - **A site not on Astro** (plain HTML, another generator, a CMS export): rebuild it in Astro identically, with its templates becoming layouts and components and its content read through the loader, then check against the baseline.
  - Either way the design does not change, the site's own files are never edited in place (work on a copy), and the owner approves before anything replaces the live site.
  - `migrate-site` keeps only what is not Astro-specific (baseline, content map) and points to `move-to-astro`. Rule 8 in `vault/AGENTS.md` becomes "move the site onto Astro and the loader, identically".

## Publishing and plugins inside the vault

- **Publishing is a visibility move to public.** The move writes the `site.standard.document` to the member's PDS through Publish, as today. There is no separate publish screen to keep.
- **Plugins are vault capabilities.** Borrowed from EmDash's design rather than depended on: a manifest of what a plugin reads, writes and calls out to; run sandboxed (Worker Loader); granted per channel like agents; discoverable as records over AT Protocol. They hook into the vault (a block saved, a visibility move, media added), never into a site's build.

## What drops in priority

The mirror, the feed Worker rendering pages, and identical rebuilds. They keep working and stay tested; new effort goes to the content layer.

## Order

1. **Remove the inbox** on `home/production-wiring`, then merge PR #33. Merge #34 (curator) and #35 (PDS) once up to date with `main`, dropping the agenda's `proposed` count from the curator docs.
2. **The `ohm` Astro loader**, public first. Until the service has reads for anyone, its public source is the member's PDS (`site.standard.document`s), behind a source interface. haeinjung.com is the first site on it.
3. **Content reads on the service** for sites: public by DID, Friends with the viewer's session. Then the loader reads through them, and gets Friends through live collections.
4. **Visibility moves** (standard.site plan step 2), with publishing as one of them.
5. **Plugin manifest and sandbox**, once a first real plugin is wanted.
6. **Spaces** (standard.site plan step 3), when stable.

Who builds which, and the prompts to start them: [docs/handoff/content-layer-split.md](../../docs/handoff/content-layer-split.md).

## Open: the owner's calls

- Where an agent's new block starts: private (proposed here), or the channel's layer.
- Whether `design-home` grants the agent `write` on every channel it set up, or only those you name.
- The loader's package name and whether it lives in this repo (`vault/astro/`) or its own.
- The standard.site plan's open questions still stand.
