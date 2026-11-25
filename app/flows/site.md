# Site

The person sees their own website as an editor view, and changes its text in place; when it's done, the page's own file on their computer says the new text.

- **Flow id:** `site`. It prefixes every tool name.
- **Starts from:** the main panel with nothing else open: the site is what it shows by default, and there is no rack entry for it. Development only for now ([src/features.ts](../src/features.ts) `site`): it is on when the dev server was started with `VITE_OHM_SITE` naming the site's folder, and no build has it.
- **Ends in:** saved (the file changed), discarded (nothing changed), or refused (the text could not be placed in the file, or the file changed on disk).

Where it reads and writes: [site-dev.ts](../site-dev.ts), a Vite dev-server plugin. It serves the folder's **git-tracked** files under `/site/` on the app's own origin, so a frame can be reached into, and takes a page back with `PUT` and `If-Match`. It also runs git in that folder for the sync steps below, and nothing else. Every request that changes the folder must carry the app's own header and come from the app's own origin.

```sh
VITE_OHM_SITE=~/development/haeinjung.com npm --prefix app run dev
```

## The screen

- **Profile**, fixed at the top of the side panel while the channels scroll under it: a card in the shape of ohm-ui's identity card (4:3, the picture above, then the name, the address of the home in a pill that opens it, and the identity and wallet read in fours). It is the person's own colour (the profile's `color`; until they choose one, the ink their site is written in), matt, one size whatever the panel's width, and it leans toward the pointer. Opening it shows the profile over the main screen: what they say about themselves in the editor, as Markdown, and on the right the fields for name, handle, identity (DID), wallet, picture and card colour. It is one file, `profile.md` in the folder, properties on top and Markdown under them, so **Save** writes all of it as written. It has no tool: a person's identity and wallet are theirs to write. The file is not tracked by git, so Commit leaves it out until the person adds it.
- **Side panel**, for as long as the site is the main panel: the site's content as the vault holds it, and it does not close. There are three channels, each one row of block tiles that scrolls sideways, with a button that expands it: the channel is then the only one shown and fills the panel under the profile, its blocks in a two-column masonry that scrolls down: **Writings** (the article pages under `writing/`), **Photographs** (the images and videos of `archive/`) and **Projects** (the entries of `work/index.html`). A channel can hold channels, as on Are.na: a photograph is filed under the place the archive page gives it, and an article in a series folder under that series. Those show first in the row as covers: the block at the channel's front, exactly as its own tile shows it, blurred and dimmed under the channel's name and count; under the pointer the blur and the name ease away, and ease back when it leaves. Opening one shows its blocks under the profile. Once the panel has gone anywhere, Back and Forward sit small at the head of the line that says where it is, and walk where it has been, as in a browser. Index pages, shared parts, script sources and the pictures inside an article are not blocks. An image or a video keeps its own shape; an article or a project is a 3:4 sheet holding the start of its own writing in miniature. A tile opens its block. Every tile can be dragged onto a page.
- **A block, open:** it covers the canvas, and every block opens in the app's own editor view, not as a web page: the toolbar's pills (what it is and where it is filed, then Text, Image, Table and Insert), the title and the line under it, then the body. An article or a project is its own writing with its pictures in place, read from the page's first language; a photograph is a block holding the picture, to read; only a video, which the editor can't hold, plays as it is. Writing has everything the editor has: Markdown as you type (`## `, `- `, `**bold**`), the `/` menu, the selection toolbar, block handles and tables. The toolbar's Image is off: a new picture has to be filed in the site's folder first. On the right: the block's title and path, its kind, its channel and when it last changed, then its connections, which for an image or a video are the pages that show it. A connection, or **Show on canvas**, goes to that page's frame. Arrows step through the channel and Escape closes, except while the caret is in the text.
- **Saving an article:** each paragraph whose words changed is changed in the page's file, by what it said before, through the same handler as every other save. A paragraph that was added or removed, or that holds a link or bold text, can't be placed that way yet: nothing is written for it, and the person is told.
- **Dropping a block on a page:** dragging a tile over a frame makes it the active one. The block lands after an element that holds only text (an image, a video, or a link to a page), or, an image on an image, takes that image's place. The frame shows it at once and the save bar says what changed; one change waits at a time.
- **Sync**, in the canvas header: the branch and where it stands (files changed, commits to publish, commits behind), then **Pull** (fetch, then fast-forward only), **Commit** (tracked files only, after naming the change) and **Publish** (push, after a dialog that says where it goes and that everyone can see it). The folder is an ordinary git checkout, so `git` in a terminal works beside it.
- **Main screen: the canvas.** One endless white sheet that continues the person's website, in its ink: the name on top, then Writings and Projects as 3:4 cards and Photographs as a masonry, one run per place. Blocks lie on it directly, not inside framed pages. Wheel pans, ⌘ or Ctrl with the wheel zooms. A click opens a block; dragging one puts it anywhere, and a tile dropped from the side panel lands where it is let go. Where blocks were put is kept in this browser only, and **Tidy** puts them back. It has no tools yet.
- **Pages**, beside Canvas in the header: the site's pages as frames, for changing a page in place. Each page is a live frame. Wheel pans, ⌘ or Ctrl with the wheel zooms, dragging the background pans. One click makes a frame the active one, and a double-click on its title fits it. Desktop and phone widths.
- **In the active frame:** hover outlines an element, a click chooses it, ⌘-click on a link goes to that page's frame, and a double-click on an element that holds only text edits it. Enter or leaving the element ends the edit; Escape undoes it.

## Steps

| # | Step | Screen (ohm-ui) | Primary action (forest) | Tool | Annotations | Approval |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | See the pages | canvas of frames | none | `site.pages` | `readOnlyHint` | none |
| 2 | Open a page | its frame, active | none | `site.open-page` | `readOnlyHint` | none |
| 3 | Open a block | the block, over the canvas | none | `site.open-block` | `readOnlyHint` | none |
| 4 | Change text | the save bar | Save | `site.edit-text` | none | none |
| 5 | Place a block | the save bar | Save | `site.place-block` | none | none |

| 6 | See where the folder stands | the canvas header | none | `site.sync-status` | `readOnlyHint` | none |
| 7 | Pull | the canvas header | none | `site.pull` | none | none |
| 8 | Commit | the commit dialog | Commit | `site.commit` | none | none |
| 9 | Publish | the publish dialog | Publish | none: the person's alone | | the dialog |

**Publish has no tool.** Pushing is what puts the site in front of everyone, and only the person publishes (the repository's AGENTS.md). An agent can pull and commit; it cannot push.

`site.edit-text`, `site.place-block` and **Save** call the same handler (`save` in [src/site/SiteView.tsx](../src/site/SiteView.tsx), over `saveChange` in [src/site/source.ts](../src/site/source.ts)). It is not consequential: it changes one file on the person's computer, which git can undo, and no one else sees it.

## How a change is placed

The frame shows what the browser rendered; the file is changed in one place. `replaceText` finds the element's text in the file between a `>` and a `<`, allowing for entities and line breaks, and counts how many elements say exactly that. If the file holds a different number than the page shows, or none, nothing is written and the person is told why.

A block is placed the same way: `insertAfter` finds the element it follows by its text and writes the block on a new line after that element closes. `replaceSrc` swaps an image only when its `src` is written once in the file.

## Not built yet

- Moving or removing what is on a page, and styles. A placed image is plain markup (`<img src alt="" loading="lazy">`): the site's own styles decide how it sits.
- The side panel reading the person's vault instead of the site's folder, and the channels coming from the person and not from this site's folders.
- Saving an article's structure (new paragraphs, pictures, formatting), its title, and its second language.
- The tools are not in Settings › Agents' list; they follow the one switch that allows agents at all.
- A hand walk in dark and on a phone, and tests for `replaceText`, `insertAfter` and `replaceSrc`.
