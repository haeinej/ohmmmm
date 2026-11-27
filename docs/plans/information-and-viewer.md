# Plan: how information is organised, and the main screen that shows it

Status: plan, 26 November 2026. Nothing here is built yet unless it says so.

## The rule

Everything is a file. A folder is a channel. A connected place (a git repository, a website, a feed) is a channel that remembers where it came from. The app is only a way of seeing the files, as in [Obsidian's connectors](https://obsidian.md/help/connectors): the same content, a different interface. An agent reads the same files a person sees.

## Three units

| Unit | On disk | Seen as |
|---|---|---|
| **Block** | a `.md` file with front matter (`id`, `kind`, `title`, `origin`, …), or a file with a sidecar `.md` | a tile in a row; a page on the main screen |
| **Channel** | a folder with `_channel.md` (`title`, `order`, `kind`) | a row of tiles; a grid on the main screen |
| **Source** | a channel whose `_channel.md` also has `source:` | a row with a sync mark (branch, last commit, domain) |

```yaml
# _channel.md of a source
title: ohmmmm
source:
  kind: git            # git | site | feed | folder
  remote: https://github.com/you/ohmmmm.git
  branch: main
  path: ~/development/ohmmmm   # the checkout on this machine
  synced: 2026-11-26T10:00:00Z
  commit: bb8555f
```

### What a block is in each kind of source

| Source | Channel | Blocks | Not copied |
|---|---|---|---|
| Website repository | the site, with sub-channels per section | each article, photo, project (what `ohm site scan` already finds) | layout, scripts, styles |
| Code repository | the repository, with sub-channels per top folder that matters (`docs/`, `design/`, `app/`) | README, each doc, each design file, each release, each open PR, and any file the person pins | ordinary source files are **read in place**, never copied |
| Feed | the feed | each entry | — |
| Folder | the folder | each file | — |

A code file is not a block until someone pins it or links to it. Then its block is a small `.md` with `origin: git:<remote>#<path>@<commit>` and no body. The text is read from the checkout. So a repository never becomes thousands of blocks, but anything in it can become one.

### Links, not copies

Dragging a block into another channel, or onto the canvas, adds a link (`[[id]]`, or an entry in the channel's `order`). The file stays where it is. One block can show in many channels, as on Are.na.

## Two panels, one structure

| Panel | Holds | Written by |
|---|---|---|
| **Collections** | profile, your channels, connected sources | you, and agents only where granted |
| **Mind** | **Memory**: what the agent knows about you, one fact per block. **Cortex**: observations, plans, questions, and what it did | the agent; you can read, correct, delete |

Mind blocks link to the Collections blocks they are about (`about: [id]`). On the canvas a photograph and the agent's note on it sit together, joined by an edge. Nothing in the agent's head is hidden from the person.

## The main use case

The agent keeps your public self in shape, with you. That means your site, your writing and your projects stay current, connected and published the way you want.

- **Sources** are how things come in.
- **Collections** is how you see and arrange them.
- **Memory** is why the agent's suggestions fit you.
- **Cortex** is how you see what it is doing.
- **Publish** is the one step only you take.

A new use (reading list, research, a project's docs) is another source, not a new structure.

## The main screen: a viewer for any block

Today the main screen is the site canvas, and blocks open in `BlockView` or `ArticleView` from `app/src/site/`. In this plan the main screen is **the viewer**: whatever is selected in either panel opens there, full size. The canvas becomes one of its modes, for a channel or a set of blocks.

### One frame for every block

```
┌───────────────────────────────────────────────────────────────┐
│ ◂ ▸  Projects / ohmmmm / docs / words.md      git ●main  ⋯    │  path, source, back/forward in channel
├───────────────────────────────────────────────────────────────┤
│ [ View ] [ Edit ] [ Source ] [ History ]        [ Canvas ]     │  modes; only those the kind supports
├───────────────────────────────────────────────────────────────┤
│                                                               │
│               the block, shown as its kind is                 │
│                                                               │
├───────────────────────────────────────────────────────────────┤
│ links in · links out · agent notes (Mind) · visibility        │  context strip
└───────────────────────────────────────────────────────────────┘
```

- **View**: rendered, read-only, the way people meet it on the web.
- **Edit**: the editor for that kind.
- **Source**: the raw file and its front matter, which shows the tile and the file are the same thing.
- **History**: the vault journal for vault blocks, `git log` for repository files. Each entry can be compared or restored.
- **Canvas**: puts this block on the canvas with what it links to.

### Viewers by kind

The viewer is picked by the file, in this order: the block's `kind`, then the extension, then sniffing the content. Each is a small component behind one interface:

```ts
interface Viewer {
  match(file: FileRef): boolean          // kind / extension / mime
  modes: ('view' | 'edit' | 'source' | 'history')[]
  View: Component<{ file: FileRef }>
  Edit?: Component<{ file: FileRef; save(text: string): Promise<void> }>
  Tile: Component<{ file: FileRef }>     // the same thing small, for the panel
}
```

| Kind | View | Edit | Tile |
|---|---|---|---|
| Article (`.md` text) | the page as published: title, date, images in place | the Markdown editor (`editor/PageEditor`) | 3:4 miniature of the writing (exists) |
| README / doc in a repository | rendered like GitHub: headings, tables, code with highlighting, relative images and links resolved from the repository | the same Markdown editor; saving writes the checkout | 3:4 miniature with the repository's mark |
| Code file | highlighted, line numbers, outline of symbols, a "used by" list from links | a code editor (CodeMirror 6): highlighting, find, multiple cursors | the first lines, highlighted, like a page |
| Web page / HTML | the page rendered in a sandboxed frame at the real width, scaled | the HTML in the code editor, side by side with the frame, live | a screenshot of the page, taken once and cached |
| Design file (`.fig` link, `.svg`, `.pen`, images of screens) | the image or embed at full size, zoomable | annotate, or replace the file | the image |
| Image | full size, zoom, EXIF and place | crop, caption, alt text | the image (exists) |
| Video / audio | player | caption, cover frame | cover frame |
| PDF | pages, scrolled | — | first page |
| Data (`.json`, `.csv`, `.yaml`) | a table or tree | the code editor, checked before save | first rows |
| Link (URL block) | the page's card and the page in a frame | title, note | card (exists in `editor/LinkPreview`) |
| Channel | a grid of its tiles, or the canvas | order, title, sub-channels | cover with front image (exists) |
| Repository (source) | its README, with a sidebar: files, branches, recent commits, open PRs | — | the repository card: name, branch, last commit, README's first image |
| Mind block | the note, with what it is `about` shown beside it | correct or delete | a small card with the agent's mark |

Rule: **every viewer shows something.** An unknown file gets the Source view with its size and type, never a blank screen.

### Repositories on the main screen

Selecting a repository channel opens a page that works like a repository's front page:

- the **README**, rendered;
- a **file tree** on the left, showing the files that are blocks in front and the rest dimmed;
- the **branch and status**: changed files, ahead/behind, with Save (write to the checkout) and Publish (commit, push, deploy) as on the site today (`app/src/site/SiteSync.tsx`, `site-deploy.ts`);
- **recent commits and open PRs**, each one a block you can open.

Editing a file in a repository writes to the local checkout through the bridge (`ohm serve`). Nothing is pushed until Publish. This extends the routes the site already has (`/site/*`) to any connected repository (`/sources/<id>/*`).

### Previews that look like the thing

A tile previews what the block *is*, not its file type. Code looks like a page of code. A web page looks like the page. A README looks like a document. A repository looks like a repository card. Each preview is rendered once, cached by content hash in `.vault/previews/` (never tracked), and drawn again only when the file changes.

## The layout: rack, side panel, main

The app keeps today's three parts. It borrows two things from elsewhere: how screens lead into each other from a music library (library → channel → block), and the look of the rack, the side panel and the title bar from the Codex app. There is no bottom bar and no search box.

```
┌ ● ● ●  ◂ ▸  ▯ │ ▣ Writings › Collisions › Chrome Country            ⋯  ▯ ┐  title bar: back/forward, panel toggle, breadcrumb
├────┬──────────────────────────┬─────────────────────────────────────────────┤
│ ⌂  │ haeinjung.com ⌄     ◌  ⋯ │                                             │
│ ▤  │ ✎ New block              │   Home: the profile and your site, as now   │
│ ◎  │ ◌ Your agent        3    │                                             │
│ ⟳  │                          │   — or —                                    │
│ ⋯  │ Pinned                   │                                             │
│    │   Collisions             │   Channel: header in its mark colour,       │
│    │   README.md · ohmmmm     │   then its blocks as rows (tile, title,     │
│    │                          │   source, visibility, changed), or as a     │
│    │ Channels                 │   grid, or on the canvas                    │
│    │ ▱ Writings               │                                             │
│    │     Collisions        •  │   — or —                                    │
│    │     Show more            │                                             │
│    │ ▱ Photographs            │   Block: full size in its viewer, with the  │
│    │ ▱ Projects               │   context strip under it (links, notes      │
│    │                          │   from your agent, visibility)              │
│    │ Sources                  │                                             │
│    │ ▱ ohmmmm   ⟳ main        │                                             │
│    │ ▱ haeinjung.com ⟳ main   │                                             │
│ ●  │                          │                                             │
└────┴──────────────────────────┴─────────────────────────────────────────────┘
```

### Rack

A narrow column of icons, as in Codex. Each icon picks what the side panel shows:

| Icon | Side panel shows |
|---|---|
| ⌂ Home | profile, pinned blocks, channels, sources (above) |
| ▤ Collections | every channel and source as a tree, with tiles (today's tile view) |
| ◎ Mind | Memory and Cortex: what your agent knows and is thinking, grouped like channels |
| ⟳ Sources | connected repositories, sites and feeds, with their sync state |
| ● (bottom) | your profile picture: identity card, wallet, settings |

The selected icon gets a filled background, and a dot marks a section with something new.

### Side panel

Built like the Codex sidebar:

- At the top, the home's name with a ⌄ menu, then actions (**New block**, **Your agent** with a count of what it wants from you).
- **Pinned**: blocks and channels you keep at hand.
- **Groups** (Channels, Sources): each channel is a folder row with an icon. Under it come its sub-channels or latest blocks as plain indented rows, with **Show more** after five. A dot marks a row that changed.
- Rows are text-first: one line, an icon or small tile, a muted count or sync mark on the right. Tiles appear in the Collections view, not here.

### Back and forward

Back and forward go in the title bar, beside the panel toggle, as in Codex. They walk your history of what you opened in the main area: home, a channel, a block, another block. Inside a block, the ◂ ▸ in its own header step to the previous or next block in its channel. The title bar's breadcrumb (`Writings › Collisions › Chrome Country`) is clickable at every step.

### How screens lead into each other

1. **Home** opens by default: profile and site, as now.
2. Choosing a **channel** (in the side panel or on home) opens it in main as a list, with a header in its colour and a big action (Open on canvas; for a source, Publish).
3. Choosing a **block** opens it in its viewer. Its channel stays selected in the side panel, so you always see where you are.
4. **Back** returns along that same path.

The side panel never changes when you move in main, only when you choose a rack icon. That's why the information feels like a place.

## Order of work

1. **Rack, side panel and title bar in the Codex style.** Rack icons pick the side panel; back/forward and breadcrumb in the title bar; channel as a list in main.
1. **Viewer frame and registry.** One `Viewer` interface. Move `ArticleView`, `BlockView`'s image view and the channel grid behind it. Back and forward stay within the channel. *Done when:* every existing block opens in the new frame with no loss.
2. **Source, History and the fallback.** Raw file and front matter for every block. Journal history for vault blocks. Unknown files get the Source view.
3. **Code and Markdown-from-a-repository viewers.** CodeMirror 6 for code, data and HTML. GitHub-style Markdown with paths resolved from the repository. *Built 26 November 2026:* `app/src/viewers/CodeView.tsx` and `MarkdownView.tsx`, used by `app/src/site/FileEditor.tsx`.
4. **`source:` on channels, and `ohm source connect <repo>`.** Generalise `ohm site connect`. Write the repository channel with README, docs and releases as blocks, and code read in place. Add bridge routes per source.
5. **Repository page.** File tree, status, commits, PRs. Save and Publish reuse the site's flow.
6. **Web page and design viewers, cached previews.**
7. **Mind panel.** Memory and cortex observations as blocks with `about:`. Edges on the canvas.

Each step lands with its human guide and agent contract (`skills/document-work`).

## Open questions

- **PRs and issues:** live from GitHub each time, or copied in as blocks when synced? Copied is searchable and works offline; live is never stale.
- **Pinned code files:** should a pinned file follow the branch, or stay at the commit it was pinned at?
- **Private repositories:** blocks from them are private by default. Should the app refuse to publish any block whose source is private?
- **Large repositories:** a limit on how many files appear in the tree before it asks the person to choose folders.
