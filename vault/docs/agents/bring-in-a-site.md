# Bring in a site: the contract

For people: [docs/bring-in-a-site.md](../bring-in-a-site.md). Code: [site-import/](../../site-import/) (`html.mjs`, `scan.mjs`, `apply.mjs`, `check.mjs`), the command [scripts/site.mjs](../../scripts/site.mjs), tests [test/site-import.test.mjs](../../test/site-import.test.mjs). It automates the mechanical parts of [migrate-site](../../skills/migrate-site/SKILL.md) and [design-home](../../skills/design-home/SKILL.md); it does not replace their decisions.

## The site folder

`ohm site connect <repository> [--project] [--branch]` is the home's, not the vault's: [bin/ohmmmm.mjs](../../../bin/ohmmmm.mjs) routes it to [home/site.mjs](../../../home/site.mjs), which clones into `<home>/site` and writes `site/.ohm/site.json`. Every other `ohm site` subcommand below is this folder's. The editor's routes for that folder (save, files, publish, history) are the bridge's, in [docs/serve.md](../../../docs/serve.md); no MCP or WebMCP tool pushes, deploys or publishes it.

## Commands

```sh
ohm site scan  --folder DIR [--origin URL] [--plan FILE] [--json]   # read-only; writes the plan (refuses to overwrite one unless --plan is given)
ohm site import --plan FILE [--vault DIR] [--apply] [--update]      # preview by default
ohm site compose --plan FILE [--vault DIR] --out DIR                 # writes only into --out
ohm site check  --plan FILE [--vault DIR] [--built DIR]              # read-only; exit 1 when anything differs
```

`--vault` falls back to `OHM_VAULT_FOLDER`, then the home's vault (`home/home.mjs` `defaultVault`).

The same three steps are local MCP tools ([mcp/local.mjs](../../mcp/local.mjs)), for the [curator](../../agents/curator.md) and its [design-home](../../skills/design-home/SKILL.md) skill: `vault_site_scan({ folder, origin? })` and `vault_site_check({ plan })` read only; `vault_site_import({ plan, apply? })` previews, and with `apply` writes the new files through the same path as `vault_write` (journal, history, `by: agent:<name>`, private), after checking the agent's write grant on every folder first and writing nothing if any is missing. Files that differ in the vault are listed and never overwritten by an agent. Skipping a channel leaves the cards that point at it with nothing to be kept with; they are listed as unresolved and the check reports the gap.

## Rules it keeps

- **Reads tracked files only** (`git ls-files`). A folder that is not a repository is read whole, skipping names that start with `.` or `_`.
- **Never names a channel.** `channels[].name` is `null` in a fresh plan; `import` refuses until every channel has a name or `"skip": true` (`planProblems`).
- **Writes nothing outside the vault, and nothing without `--apply`.** New files are written with `wx`. Changed files are written only with `--update`, after `keepVersion`, with `before` on the journal event.
- **Every block is private**: no `visibility` is written. Nothing is published and no PDS is touched.
- **Never sets a post's form** (rule 7 of [AGENTS.md](../../AGENTS.md)). Blocks are `kind: text` or `kind: media`, written with `kindGiven`.
- **Stable ids.** `itemId(key, when, taken)`: a TID from the item's date (a year field, an article's `datePublished`, else the site's commit date), spread over that day by a hash of `<origin>|<source>|<item key>`, bumped past any id already given in the same import. `created` is that same date, so a second import writes identical files.

## How the scan reads a site

- **Pages** are classified: `article` (an `<article>` with an `<h1>`), `copy` (a canonical link to another page of the site; left out), `redirect` (meta refresh), `fragment` (no `<html>` or `<body>`), `verification` (`google….html`, `yandex_….html`), `app` (a module script from `assets/` and a `#root` or `#app`), else `page`.
- **Runs**: in every `page` and `article`, sibling elements with the same signature (tag + first class), three or more, outside `head`, `nav`, `svg`, `script`, `style`, `article`, `ul`, `ol`, `table`, `p` and a few others. A run identical on two pages is a shared part and is skipped. A run is named `items:<page>#<region>><signature>`, where region is the container's id or its chain of signatures.
- **Templates** (`templatesOf`): each item is split into atoms, literal text and values (every attribute value, and the text between any two tags, even empty). Items with the same literal text are one shape. A value is a field when it differs anywhere in the run, whatever the shape. `fill(shape.parts, fields)` gives each item back exactly; the plan's `checks` record that for every run.
- **Kinds**: a run with at most `max(3, ceil(count / 5))` shapes is `list` (fields kept whole); more is `rich` (entries with writing of their own; brought in as Markdown).
- **Views**: a list run with an `a@href` field where at least half the links resolve to an article, an anchored rich item (`page#id`) or a folder of articles is a view, not content.
- **Field roles** are guessed from field names only: `media` (`img|video|source@src`), `link` (`a@href`), `title`, `date` (`year|date|time|published`), `sub` (`loc|place|location|city|country|category|topic|series|section|tag`, with 2 to count/2 distinct values). The owner can change any of them in the plan.
- **Media**: files by extension; a file name in two folders is an original (the largest) and its copies; a file no tracked page, stylesheet or script names is `unreferenced`.

## The plan

```json
{
  "ohm": "site-plan", "version": 1,
  "site": { "folder", "origin", "commit", "committed", "changed", "files" },
  "channels": [{ "name": null, "asFound", "source", "kind": "articles|list|rich", "count", "sub", "subs", "title", "date", "media", "fields", "shapes", "languages" }],
  "views": [{ "source", "count", "link", "resolved", "shapes" }],
  "pages": [{ "path", "kind", "title", "of?", "to?" }],
  "media": { "files", "variants", "copies", "unreferenced" },
  "shared": [], "checks": [{ "source", "items", "reproduced" }]
}
```

Editable: `channels[].name`, `skip`, `sub`, `title`, `date`, `media`; `views[].skip`. The rest is read again from the folder at import.

## What an import writes

- A **channel** per named channel (`_channel.md`, `kind: collection`, `origin`), and one inside it per group (`sub`: the field's value, or the article's deepest folder). `order` lists slugs, and sub-channel paths at their first item, in the site's order.
- A **block** per item. Articles and rich items: `kind: text`, Markdown body (`mirror/html-to-markdown.mjs`, pictures at their site addresses, a linked picture rewritten as one link), first language only (`inLanguage`). List items: `kind: media` with `![](<original>)` when they have a picture, `origin` the original's address.
- `site` on every block: `{ page, region?, signature?, at?, shape?, fields?, anchor?, subtitle?, published?, languages?, views? }`. `at` is the item's place among every run in the same region. A view's items are kept on what they point at: `site.views` on a block, `views` on a channel (a series). A card that points nowhere is kept with the channel whose index page shows it, and listed.
- Journal events: `op: added|changed`, `via: add`, `root: vault`, `origin` the item's address.

## What compose writes

Into `--out`, an Astro project folder (default `build.format: 'directory'`, so `src/pages/archive/index.astro` builds to `archive/index.html`):

- `src/components/ohm/<Name>.astro` for each `list` run the plan brings in or keeps as a view. Props `{ shape, fields }`; one branch per shape. `shapeMarkup` turns the template into Astro markup: an attribute field becomes `name={decode(f[key])}`, a text field `<Fragment set:html={f[key]} />`; a shape whose literal markup holds a brace, a script or a style is written whole as `set:html`.
- `src/components/ohm/regions/<Page><Region>.astro` for each region: `regionEntries(page, region)` from the vault, each drawn by its run's component.
- `src/lib/ohm-vault.mjs`: reads the vault at build time (`OHM_VAULT`, else the path given to compose): every block's `site` entry with `signature` and `fields`, its `site.views`, and channels' `views`, sorted by `at`.
- `src/ohm/shell/<page>.<n>.html` and `src/pages/<page>.astro`: the page cut at each region's inside, imported `?raw`, with each region's component between.

Astro writes an empty attribute bare (`data-year`); `normalised` treats `x=""` and `x` alike, as HTML does.

## What a check compares

- **Regions**: every region with list runs. The vault's entries for it (`site` with `signature` and `fields`, and every `views` entry), sorted by `at`, are filled into the current site's templates and compared with the page's items, after `normalised` (comments removed, white space collapsed). A shape missing from the site is reported as such.
- **Built pages** (`--built DIR`): each page that holds a region, read from the build, against the site's page, both `normalised`.
- **Texts**: every article and rich block's Markdown, rendered and reduced to words, against the page's first-language text. Quotes and emphasis marks are ignored.

## Verified

`npm test` in `vault/` (the six tests in `site-import.test.mjs` use a made-up site).
Compose on haeinjung.com: 4 components, 3 pages; Astro 7.4.13 built them, and `site check --built` reported all three pages the same; one caption changed in the vault appeared on the rebuilt page. On 25 November 2026 against haeinjung.com at `2f778dd`: 17 channels, 483 blocks, 500 files; a second import wrote nothing; `site check` reported every region and text the same; `ohm vault lint` reported no problems.

## Known gaps

- Second languages are not brought in.
- Field roles are guessed from names; a site with unusual class names needs its plan edited.
- Rich items are checked by words, not markup; list items by markup.
- Compose covers list runs and the pages that hold them. Articles and rich items are not composed; the rest of the site is [move-to-astro](../../skills/move-to-astro/SKILL.md).
- The composed pages read a vault folder at build time, not the PDS; private blocks must not be built into a public site.
