# Bring an existing website into ohm

You already have a website. It holds things you made: articles, photographs, projects. ohm keeps those as blocks in your vault, filed in channels, so they can be written, connected, published to your PDS and shown on any site, your own included. `ohm site` moves a website's content into that structure without retyping anything, and proves nothing was lost on the way.

The agent reference for this is [docs/agents/bring-in-a-site.md](agents/bring-in-a-site.md).

## Your site in your ohm

Before any of this, you can keep the site itself in your ohm and edit it there: `ohm site connect https://github.com/you/your-site.git --project your-site` (run inside `~/ohm.<handle>`) clones it into `site/`. With `ohm serve` running, the app opens on it: change it on the canvas or in Files, every save is kept, and nothing goes live until you press Publish. The scan below can read that same folder: `ohm site scan --folder ~/ohm.<handle>/site`.

## What it does

Four steps, each one you run and read:

1. **Scan.** `ohm site scan --folder ~/my-site` reads your site and writes a plan. It finds what your site holds many of: a folder of articles, a gallery of photographs, a list of projects, and the cards that point at them. It says how each could be grouped (photographs by place, articles by series), which pages are copies of others, and which media files no page shows. It changes nothing.
2. **Name.** You open the plan and give each channel a name, in your own words, or mark it to skip. The command will not go on until you have.
3. **Bring in, then check.** `ohm site import --plan site-plan.json` says what it would write. Add `--apply` to write it. `ohm site check --plan site-plan.json` then builds your site's galleries and lists again from what the vault now holds and compares them with your pages, and compares every article's words.
4. **Make it composable.** `ohm site compose --plan site-plan.json --out ~/my-site-astro` writes an Astro component for each thing your site repeats (a photograph, a card), a component for each gallery or list that draws its items from your vault in their order, and a page around each, which is the rest of your page as it is. Build it with Astro, then `ohm site check --plan site-plan.json --built ~/my-site-astro/dist` compares the built pages with yours.

You can also ask the [curator](../agents/curator.md) to do this with you. It scans with the same code, shows you what it found in its home report, asks you to name each channel one at a time, shows you what it would write, and writes only into the channels you have given it, as its own private blocks.

On haeinjung.com, on 25 November 2026: the scan found 8 articles (one series of 4), 467 photographs in 13 places, 8 projects and three runs of cards. With the names Writings, Photographs and Projects, the import wrote 17 channels and 483 blocks, and the check found every gallery, list and article the same. Compose wrote 4 components and 3 pages; Astro built them, and all three pages matched the originals. Changing one photograph's caption in the vault and building again changed that caption on the page.

## What you can rely on

- **It reads only what you committed.** Files git does not track, such as private notes or a photo folder you keep out of the repository, are never opened.
- **Nothing is copied.** A photograph stays where it is on your site; its block points at its address. When the site keeps a small copy and an original, the block points at the original.
- **Nothing is published.** Every block starts private. The site keeps serving what it served. Showing a block to more people is still your Publish.
- **Twice is the same as once.** Bringing the same site in again gives every block the same id and writes nothing new. A file that changed in the vault is left alone unless you add `--update`, and then the earlier version is kept in the vault's history.
- **What your site says that ohm has no field for is kept.** The size class of a photograph, its caption number, how a card describes an article: each is kept on the block under `site`, which is why the check can rebuild the page exactly.

## Before you start

- **Your site's folder, as a git repository, with your work committed.** The scan reads what git tracks, and the plan remembers the commit, so you can tell later whether the site has moved on. Uncommitted changes are read as they are, and the scan says how many there are.
- **A vault to bring it into.** `ohm vault init` makes one. Without `--vault`, the command uses the vault your home names.
- **Your site's address**, for links that should keep working. The scan reads it from a `CNAME` file; otherwise give it with `--origin https://…`.

## What it does not do yet

- **Second languages.** A page written in English and Korean comes in in its first language; the other stays on the site, and the import says which pages.
- **The whole site on Astro.** Compose makes the galleries and lists composable, and the pages that hold them. Articles, project pages and the rest of the site are still the site's own files; moving those is [move-to-astro](../skills/move-to-astro/SKILL.md)'s work.
- **Reading published content.** The composed pages read the vault folder on your computer when they are built. Reading what you have published from your PDS instead is the next step.
- **Pages that are not lists or articles.** A home page or an about page stays the site's own.
- **Guessing names.** Labels and channel names are yours. The plan shows what each was called on the site, for reference.
