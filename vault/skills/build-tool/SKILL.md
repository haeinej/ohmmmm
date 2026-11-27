---
name: build-tool
description: Build a small tool (an app) for the person that runs on their ohm canvas, as a plain folder in their ohm home that you write with your own file tools. Use when they ask for a tool, a helper, a little app, or "build me something that…", or when a prompt card on their canvas asks for one.
---

# Building a tool for the person's ohm

A tool is a folder in the person's ohm home: `<home>/tools/<name>/index.html`. You write it as you would any small project. `ohm serve` watches that folder: a new tool appears in the person's Tools, from where they drag it onto their canvas, and the page reloads wherever it runs each time you save it. ohm never writes tools itself.

1. **Find the folder.** It is `tools/` in the person's ohm home, beside `site/`: when you are working in their home (a folder named `ohm.<their name>`), that is `./tools`. `tools_list` (the `ohm-site` MCP) returns it as `folder`, with the tools already there; if you cannot call it, use `./tools` from the home. If the person names one that exists, read its `index.html` and change it rather than starting again.
2. **Name it.** Use lower case with dashes, e.g. `caption-checker`. That is the folder's name. Anything else is ignored.
3. **Write `index.html`.** Make it one self-contained page with inline CSS and script, up to 1 MB. It runs sandboxed: no network, no outside scripts, fonts or images, and no cookies or storage you can rely on.
4. **Read the person's things through ohm.** The page has `ohm.ask`:
   - `await ohm.ask("channels")`: an array of `{ name, blocks, inside }`, where `name` is the channel's name, `blocks` how many blocks it holds, and `inside` the names of the channels within it (an array of strings).
   - `await ohm.ask("items", { channel: "Photographs" })` (or `"Photographs/Berlin"`): an array of `{ path, title, kind, modified, excerpt }`; `kind` is article, project, image or video.
   - `await ohm.ask("links")`: an array of `{ id, url, title, description, image, site }`.
   - `await ohm.ask("canvas")`: an array of cards, `{ id, kind, x, y, w, h }` plus what each shows (`path`, `name`, `link`, `text`).

   It reads only. A tool cannot change their site, channels or canvas.
5. **Say what it is.** Add `<title>` and `<meta name="description" content="…">`. Or, beside the page, add `tool.json` with `{ "title": "…", "description": "…" }`. The canvas and their tool list show these.
6. **Keep to their design:** a white page, Helvetica Neue, quiet greys, no borders, generous space, and small type for labels.
7. **Tell them where it is.** Give them the folder path, and say it is in their Tools, ready to drag onto the canvas.

If `tools_list` fails, `ohm serve` is not running or this agent has no key. Ask the person to start `ohm serve`, or to give the plugin its key: `claude plugin configure ohm` (the key from `ohmmmm agents add claude-code`).
