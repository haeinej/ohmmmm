# Home report (template)

The fixed shape of the report the [curator](../../agents/curator.md) writes in the [design-home](../../skills/design-home/SKILL.md) skill. Copy it, keep every heading in this order, and fill each table. A section with nothing to report says "None found" and stays.

Rules that hold for every line of the report:

- **Counts, not content.** Say what kind of thing is where and how many. Do not quote private material; name a private file only by its folder and kind.
- **No label names from the agent.** Wherever a name is still the owner's to choose, write `?` and put the question under [Open label questions](#5-open-label-questions). Existing names (a site's nav, a folder's name, a feed's title) are quoted as found, marked "as found".
- **Read-only.** The report is written before anything changes. Say how each count was taken, so the owner can check it.
- **Two boundaries.** Each source is either **PDS** (public posts, written only on Publish) or **personal** (everything else). Personal is the default.

A worked example: [home-report-haeinjung.md](../../examples/home-report-haeinjung.md).

---

```markdown
# Home report: <handle>

Screened <date> by the curator, read-only. Nothing was changed.

## 1. Sources

| # | Source | Kind | Where | How it was read |
| --- | --- | --- | --- | --- |
| S1 | <name as found> | site folder · feed · PDS · local folder · drive | <path or address> | <command or request, e.g. `find … -type f`, listRecords> |

## 2. What is in each

One table per source.

### S1 <name>

| Part (as found) | Files or items | By kind | Published? | Notes |
| --- | --- | --- | --- | --- |
| <folder or section> | <n> | <n html · n jpg · n mp4 …> | linked from nav · reachable by address · not in git · feed only | drafts, duplicates, sizes, thumbnails |

**Drafts:** <where, how many, how told: unlinked pages, "draft" in front matter, no date>.
**Private-looking:** <folder and kind only, and why it looks private>. Never quoted.
**Duplicates across sources:** <the same piece in two places, by slug or title>.

## 3. Proposed channel structure

Channels are proposed by **shape**, not named. Each row is one channel the content suggests; its name is `?` until the owner gives one. A row may say "as found: writing/" when the site already names it.

| # | Channel (owner names it) | Would hold | From | Layer it would start in |
| --- | --- | --- | --- | --- |
| C1 | ? (as found: <name>) | <n essays> | S1 writing/ | Private until published |

Sub-channels the content suggests (series, trips, sets), each with its own `?`.

## 4. Media as path + metadata

Media and notes are recorded in place: one block per file, its `origin` path, hash, size, kind, dimensions or duration, and alt text where the page gives it. Nothing is copied or moved.

| # | Folder (as found) | Files | Kinds | Pairs or variants | Record as | Label |
| --- | --- | --- | --- | --- | --- | --- |
| M1 | <path> | <n> | <n jpg · n mov> | <thumbnails, small video copies> | media records, `retain: reference` or `text` | pending the owner |

## 5. Open label questions

Questions only, one decision each. The agent proposes no names; it may offer the plain starting point from [suggest-labels](../../skills/suggest-labels/SKILL.md) (Writing, Photos, Projects) once, as a default the owner can drop.

| # | Question | What it decides | Seen in |
| --- | --- | --- | --- |
| L1 | <one question in plain words> | <the label, a sublabel, a channel name, or whether a set is public> | <S#, C#, M#> |

## 6. PDS or personal

| Source or part | Call | Why | Owner's answer |
| --- | --- | --- | --- |
| S1 writing/ | PDS once published, personal until then | already public on the site | ? |
| <private-looking part> | personal, Private | <reason> | ? |

Records already on the PDS: collection, count, and whether they use `com.ohmmmm.post`.

## 7. Mismatches

Where two sources or two names disagree: the site's nav against `docs/labels.md` or the PDS records' labels, a feed against the site, an old record type against `com.ohmmmm.post`.

| # | Here | There | Question it raises |
| --- | --- | --- | --- |

## 8. Decisions log

Written during the discussion, one row per decision, in the owner's words. Only rows here are applied.

| # | Date | Item (S#, C#, M#, L#) | The owner decided (their words) | Applied by | Change IDs |
| --- | --- | --- | --- | --- | --- |
| D1 | | | | `connect` · `suggest-labels` · `migrate-site` · not yet | |

Still open after this session: <items>.
```
