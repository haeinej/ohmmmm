# Home report: haeinjung.com

Screened 2026-11-23 by the curator, read-only, as a dry run of [design-home](../skills/design-home/SKILL.md) with the [home report template](../docs/agents/home-report.md). Nothing was changed: no file in the site folder, no git operation that writes (`fetch`, `pull`), no vault, no PDS write.

This copy is committed to a public repository, so anything not already published is described by folder, kind and count only: no file names, no subfolder names or layout, no description of what notes say, and no local paths. In a real session the curator shows those names to the owner and keeps the report as a private block in their vault.

## 1. Sources

| # | Source | Kind | Where | How it was read |
| --- | --- | --- | --- | --- |
| S1 | haeinjung.com | site folder (GitHub Pages, `CNAME`) | the site's local checkout, branch `main` | `find <dir> -type f` by top folder and extension; `git ls-files`; `href`s of `index.html`, `writing/index.html`, `work/index.html` |
| S2 | Substack | feed | `https://haeinej.substack.com/feed`, linked from the site's home and writing pages | the RSS feed's items |
| S3 | PDS | PDS | `did:web:pds.haeinjung.com` at `https://pds.haeinjung.com`, handle `haeinjung.com` (`_atproto` TXT record) | `com.atproto.repo.describeRepo`, `listRecords` |
| S4 | Vault and cortex | home | none found at the default home location | `ls` |

There is no vault or cortex yet, so there are **no journals to read** and no flags or agenda waiting. The proposed structure below rests on the site alone.

## 2. What is in each

### S1 haeinjung.com

| Part (as found) | Files | By kind | Published? | Notes |
| --- | --- | --- | --- | --- |
| `/` | 5 | `index.html`, `portrait.jpg`, `water.jpg`, `CNAME`, `SITE_STYLE_GUIDE.md` | home page | Nav links only `/writing/` and `/work/`, plus outside links (Substack, social accounts) |
| `writing/` | 28 | 20 html, 7 jpg, 1 png | linked from nav | 19 essay pages and an index. The index links 17 of them under four sections, as found: "Latest", "잡념들", "Possibilities", "Becoming"; some essays appear in two sections. `writing/media/` holds 8 cover images |
| `work/` | 1 | 1 html | linked from nav | One page with three projects, as found: "Ohm", "MuniForPublic", "United Korean Founders"; each links out |
| `collide/` | 3 tracked (+1 `.DS_Store`) | html, js, css | reachable by address only, not in nav | A built single-page app titled "collision chamber" |
| `archive/` | 372 (+ index) | 344 jpg, 28 mp4 | reachable by address only, not in nav | **172 images**: `img/` 172 with `thumb/` 172 thumbnails of the same files; 14 videos with 14 small copies in `vidsm/`. 118 MB. The local branch is 5 commits behind `origin/main`, which has 467 files here; not fetched |
| `photo archive/` | 490 (+9 `.DS_Store`) | 465 jpg/jpeg, 19 mov, 3 heic, 2 png, 1 mp4 | **not in git, not on the site** | In subfolders, not described here. 1.8 GB |
| `allnotes/` | 14 | 12 md, 2 txt | **not in git, not on the site** | Private-looking. 184 KB |
| `.gstack/` | 3 | logs | not in git | A tool's own logs. Not content; left out |

The brief for this dry run expected 21 essays in `writing/` and 515 files in `photo archive/`. Counted on disk on 2026-11-23: 19 essay pages (20 html with the index) and 490 media files (499 with `.DS_Store`). The owner should say which count is right before anything is recorded.

**Drafts:** 2 essay pages in `writing/` are not linked from its index; not named here.
**Private-looking:** `allnotes/`, notes kept out of git and off the site: 14 files, reported by kind and count only, never published. `photo archive/`, media kept out of git and never published.
**Duplicates across sources:** `elsewheren` and `why-i-started-ohm` are on the site and in the Substack feed. `why-it-makes-sense-to-think-agi-is-bullshit` links to a Substack post that the feed does not list. The PDS holds `why-i-started-ohm` too.

### S2 Substack

| Part | Items | Notes |
| --- | --- | --- |
| Feed | 3 | `collisions`, `elsewheren`, `why-i-started-ohm`. `collisions` is not a page on the site |

### S3 PDS

| Collection | Records | Notes |
| --- | --- | --- |
| `com.haeinjung.post` | 2 | `trap-of-independency`, `why-i-started-ohm`. **The old site-specific type**, not `com.ohmmmm.post`, and neither record has a label |

## 3. Proposed channel structure

By shape only. Every name is the owner's; `?` until they give one.

| # | Channel (owner names it) | Would hold | From | Layer it would start in |
| --- | --- | --- | --- | --- |
| C1 | ? (as found: `writing/`, nav "Writing") | 19 essays and their 8 cover images | S1 `writing/`, S2, S3 | Private, until each is published |
| C1.1–C1.4 | ? (as found: "Latest", "잡념들", "Possibilities", "Becoming") | the essays the index lists under each | S1 `writing/index.html` | as C1 |
| C2 | ? (as found: `work/`, nav "Work") | 3 projects | S1 `work/` | Private, until published |
| C3 | ? | `collide/`, a built app | S1 `collide/` | Private. A code record, or left out: the owner's call |
| C4 | ? | 172 images and 14 videos | S1 `archive/` | Private |
| C5 | ? | 490 photos and videos in subfolders; each subfolder could be a sub-channel, `?` each | S1 `photo archive/` | Private |
| C6 | ? | 14 notes | S1 `allnotes/` | Private |

## 4. Media as path + metadata

Recorded in place. Nothing copied or moved. Every row's label is pending the owner.

| # | Folder (as found) | Files | Kinds | Pairs or variants | Record as | Label |
| --- | --- | --- | --- | --- | --- | --- |
| M1 | `archive/img/`, `archive/vid/` | 172 + 14 | jpg, mp4 | `thumb/` and `vidsm/` are smaller copies: one record each with a variant, not two | media records, root with `retain: reference` | pending the owner |
| M2 | `photo archive/` | 490 | jpeg, jpg, mov, heic, png, mp4 | none seen | media records, root with `retain: reference`, excluding `.DS_Store` | pending the owner |
| M3 | `allnotes/` | 14 | md, txt | none | note records, root with `retain: text` | pending the owner |
| M4 | `writing/media/`, `/portrait.jpg`, `/water.jpg` | 10 | jpg, png | none | media records embedded from the page that shows them; alt text only from that page | pending the owner |

## 5. Open label questions

No names were chosen. The plain starting point from suggest-labels is Writing, Photos, Projects; the site already has its own words, so those are offered instead.

| # | Question | What it decides | Seen in |
| --- | --- | --- | --- |
| L1 | The site's nav says "Writing" and "Work". `docs/labels.md` uses this site as its example with three labels, "Writings", "photographs" and "things i make". Which words are yours now? | the labels | S1 nav, `docs/labels.md` |
| L2 | Should the four sections of the writing page ("Latest", "잡념들", "Possibilities", "Becoming") be sublabels, or only how that page groups essays? An essay can have one sublabel; some sit in two sections. | sublabels of writing | C1.1–C1.4 |
| L3 | `docs/labels.md` files `trap-of-independency` under a sublabel "Collisions", and Substack has a `collisions` post. Is Collisions a series, and what do you call it? | a sublabel | S2, S3 |
| L4 | What is `archive/` to you, and what would you call it? It is on the site but not in the nav. | a channel name, and whether it is a label | C4, M1 |
| L5 | `photo archive/` is filed in subfolders. Is it one channel with a sub-channel per subfolder, and are any meant to be public? | channel names, public or not | C5, M2 |
| L6 | `collide/`: a project under your work, its own thing, or left out of the vault? | a channel, or nothing | C3 |
| L7 | The two unlinked essays: drafts, or finished and not listed yet? | whether they are posts | S1 `writing/` |
| L8 | `allnotes/`: what do you call this channel? It stays Private either way. | a channel name | C6, M3 |

## 6. PDS or personal

| Source or part | Call | Why | Owner's answer |
| --- | --- | --- | --- |
| S1 `writing/` (17 linked essays) | PDS once published, personal until then | already public on the site | ? |
| S1 `writing/` (2 unlinked) | personal | not listed anywhere | ? |
| S1 `work/` | PDS once published | already public | ? |
| S1 `collide/` | personal | an app, not a post | ? |
| S1 `archive/` | personal until the owner says otherwise | reachable on the site but not in the nav | ? |
| S1 `photo archive/` | personal, Private | never published, not in git | ? |
| S1 `allnotes/` | personal, Private, never published | notes kept out of git and off the site | ? |
| S2 Substack | stays where it is; mirrored only if the owner asks | the owner already publishes there | ? |
| S3 PDS | PDS | public records already | ? |

Records already on the PDS: 2, in `com.haeinjung.post`, none in `com.ohmmmm.post`, none labelled.

## 7. Mismatches

| # | Here | There | Question it raises |
| --- | --- | --- | --- |
| X1 | Site nav: `/writing/` "Writing", `/work/` "Work" | `docs/labels.md`: "Writings", "photographs", "things i make" | L1 |
| X2 | `docs/labels.md`: a "photographs" section with "Seoul" | the site has no photographs page; the photos are in `archive/` (unlisted) and `photo archive/` (unpublished) | L4, L5 |
| X3 | PDS: `com.haeinjung.post`, 2 records | every post is `com.ohmmmm.post` | moving them is migrate-site's, with a preview and the owner's approval |
| X4 | Site: 19 essays | PDS: 2 records; Substack: 3 items | which essays should become posts, and in what order |
| X5 | Local `main` | `origin/main`, 5 commits ahead, `archive/` 467 files there | counts above are for the local copy; the owner pulls when they choose |

## 8. Decisions log

Empty: this was a dry run, and nothing was discussed with the owner yet. Nothing has been applied.

| # | Date | Item (S#, C#, M#, L#) | The owner decided (their words) | Applied by | Change IDs |
| --- | --- | --- | --- | --- | --- |

Still open after this session: every item, L1 to L8, and every call in section 6.
