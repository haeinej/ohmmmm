// The person's website, for a coding agent, over MCP (`/site/mcp` on `ohm serve`, docs/serve.md).
//
// An agent with its own key can list the site's files, read one, change one, add a picture, and read the
// history of the site or of one artifact (a page, a folder). Every change it makes is an ordinary save,
// kept in the save log with the file before it and named `agent:<name>`, so the person sees it in
// History and can take it back. Nothing here commits, pushes, deploys or publishes: that is the
// person's Publish, in the app.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { addFile, addLink, contentOf, etagOf, historyOf, keepOwnChannels, linksOf, ownChannels, pullsOf, removeLink, saveFile, syncOf, tracked, treeOf } from './site.mjs';
import { boardOf, changeArrows, changeBoard } from './site-board.mjs';
import { toolsDir, toolsOf } from './site-tools.mjs';
import { randomUUID } from 'node:crypto';

const tool = (name, description, properties, required = [], readOnlyHint = false) => ({
  name, description, inputSchema: { type: 'object', properties, required },
  ...(readOnlyHint ? { annotations: { readOnlyHint: true } } : {}),
});
const path = { type: 'string', description: 'A path in the site, as git tracks it: `index.html`, `assets/site.css`, `writings/collisions/index.html`.' };

export const SITE_INSTRUCTIONS = `The person's ohm, as a project you can see and change, like a design tool's: ohm_overview first. The canvas (canvas_*) is shared with them live: what you add or move appears on their screen. Collections are channels of blocks (channels_list, channel_items); links are pages that aren't theirs. The person's website: a git checkout in their ohm. Read before you change: site_read gives a file's text and its version; site_write needs that version back, and refuses if the file changed since. Every change is a save the person can see and take back in History; nothing is committed or published until they press Publish in the app. Keep the site's design and addresses as they are unless asked.`;

export const SITE_TOOLS = [
  // The whole of it, as Framer's project overview.
  tool('ohm_overview', 'The person\'s ohm at a glance: their site, its channels (with how many blocks each holds), their own channels, links kept, the cards on the canvas, what is chosen on it and what they pointed at. Start here.', {}, [], true),
  // The canvas, as a design tool's nodes.
  tool('canvas_cards', 'Every card on the canvas, and the `arrows` between them (`from`, `to`, `text`): `id`, `kind` (block, channel, page, link, note), what it shows (`path`, `name`, `link`, `text`), where it is (`x`, `y`) and its size (`w`, `h`), and a channel\'s `view`.', {}, [], true),
  tool('canvas_selection', 'The cards the person has chosen on the canvas right now.', {}, [], true),
  tool('canvas_add', 'Puts a card on the canvas, on their screen at once. `kind`: block (with `path`), channel (with `name`, as `Photographs` or `Photographs/Berlin`), page (with `path` of a site page), link (with `url`, kept as a link too), note (with `text`). `x`, `y` place it; `w`, `h` size it. Returns the card.', { kind: { type: 'string', enum: ['block', 'channel', 'page', 'link', 'note'] }, path: { type: 'string' }, name: { type: 'string' }, url: { type: 'string' }, text: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' }, view: { type: 'string', enum: ['cover', 'grid', 'row', 'list'] } }, ['kind']),
  tool('canvas_update', 'Changes a card: move it (`x`, `y`), size it (`w`, `h`), a channel\'s `view`, a note\'s `text`.', { id: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' }, view: { type: 'string', enum: ['cover', 'grid', 'row', 'list'] }, text: { type: 'string' } }, ['id']),
  tool('canvas_remove', 'Takes a card off the canvas (the block, channel or page itself stays).', { id: { type: 'string' } }, ['id']),
  tool('canvas_connect', 'Draws an arrow on the canvas from one card to another (`from`, `to`: card ids), with a few words on it if any (`text`). Arrows say how things relate; a prompt\'s arrows point at what it is about.', { from: { type: 'string' }, to: { type: 'string' }, text: { type: 'string' } }, ['from', 'to']),
  tool('canvas_disconnect', 'Takes an arrow off the canvas, by its id.', { id: { type: 'string' } }, ['id']),
  tool('canvas_show', 'Moves the person\'s view to a card and chooses it, as zooming into view does.', { id: { type: 'string' } }, ['id']),
  // Collections, as a CMS.
  tool('channels_list', 'Every channel: the site\'s (Writings, Photographs, Projects) with the channels inside them, and the person\'s own, with how many blocks each holds and its colour.', {}, [], true),
  tool('channel_items', 'The blocks of one channel (`Photographs`, or `Photographs/Berlin`): each block\'s `path`, `title`, `kind`.', { channel: { type: 'string' } }, ['channel'], true),
  tool('channel_create', 'Makes a channel of the person\'s own, at the top or inside another (`parent`). It holds blocks filed into it.', { name: { type: 'string' }, parent: { type: 'string' } }, ['name']),
  tool('channel_file', 'Files a block (by its `path`) into one of the person\'s own channels.', { channel: { type: 'string' }, path: { type: 'string' } }, ['channel', 'path']),
  tool('channel_color', 'Gives a channel its colour: one of navy, petrol, forest, ochre, clay, burgundy, plum, ink, or `none`.', { channel: { type: 'string' }, color: { type: 'string', enum: ['navy', 'petrol', 'forest', 'ochre', 'clay', 'burgundy', 'plum', 'ink', 'none'] } }, ['channel', 'color']),
  tool('links_list', 'The links kept (pages that aren\'t the person\'s): address, title, description, picture.', {}, [], true),
  tool('link_add', 'Keeps a web page as a link, in Artifacts. Returns the link.', { url: { type: 'string' } }, ['url']),
  tool('link_remove', 'Removes a kept link.', { id: { type: 'string' } }, ['id']),
  // Prompts: what the person asked of you on the canvas.
  tool('prompts_waiting', 'The prompts the person wrote to you on the canvas and sent, that no one has answered yet: each with its `id`, `text`, and when. Read them when they say "do what\'s on my canvas", or now and then while you work with them.', {}, [], true),
  tool('prompt_answer', 'Answers a prompt from the canvas: say you are `working` on it (with a few words in `answer` on what you are doing), then `done` with what you did, or `declined` with why. The answer shows under the prompt on their screen at once.', { id: { type: 'string' }, status: { type: 'string', enum: ['working', 'done', 'declined'] }, answer: { type: 'string' } }, ['id', 'status']),
  // Internal tools: small apps you build for the person, kept in their home and run sandboxed on their canvas.
  tool('tools_list', 'The person\'s tools: small apps that live as plain folders in their ohm, `<folder>/<name>/index.html`, and run on their canvas. To build one, or change one, write its folder yourself with your own file tools: one self-contained `index.html` (inline CSS and script, no network: it runs sandboxed), and optionally `tool.json` with `title` and `description`. A new folder appears in their Tools, which they drag onto the canvas like any block, and a changed page reloads wherever it runs. To read the person\'s things, the page asks ohm: `const channels = await ohm.ask("channels")` (also "links", "canvas", "items" with `{ channel }`). Keep to their design: white, Helvetica Neue, quiet greys. Folder names are lower case with dashes. Returns `folder` and each tool\'s `name`, `title`, `description`.', {}, [], true),
  tool('pulls_list', 'The site\'s pull requests on GitHub, read with the person\'s gh: state, title, branch, a line on what each is about.', {}, [], true),
  tool('site_files', 'Lists every file of the site that git tracks, with whether it changed since the last commit and whether any page uses it.', {}, [], true),
  tool('site_read', 'Reads one text file of the site. Returns its text and its version (give the version back to site_write).', { path }, ['path'], true),
  tool('site_write', 'Changes one text file of the site to `text`, as a save the person can take back. `version` is what site_read returned; if the file changed since, nothing is written and the reason is returned. Nothing is committed or published.', { path, text: { type: 'string' }, version: { type: 'string' } }, ['path', 'text', 'version']),
  tool('site_add', 'Adds a new picture or video to the site at `path` (not taken yet), from `base64` bytes, as a save. Up to 25 MB. Nothing is committed or published.', { path, base64: { type: 'string' } }, ['path', 'base64']),
  tool('site_history', 'The history of the site, or of one artifact: saves (with who made them) and commits that touched `path` (a file, or a folder ending in /). Without `path`, the whole site.', { path: { ...path, description: 'A file, or a folder ending in /, to read the history of. Leave out for the whole site.' } }, [], true),
  tool('site_focus', 'Says where you are working, so the person sees it live on their screen: a file `path`, and on a page an element `selector` (CSS), with a short `note` on what you are doing. Call it as you move; call it with nothing to clear it.', { path, selector: { type: 'string', description: 'A CSS selector for the element on the page you are working on.' }, note: { type: 'string', description: 'A few words on what you are doing there.' } }),
  tool('site_pointed', 'What the person last pointed at in their site, on screen: the page `path`, the element\'s `selector`, its `text` and `html`. Read it when they say "this" or "here".', {}, [], true),
  tool('site_status', 'Where the site stands against its git remote: the branch, commits ahead and behind, and the files changed since the last commit.', {}, [], true),
];

/** The site's tools for one agent: `{ call(name, args) }`. */
export function createSiteTools({ dir, agent, live }) {
  const by = `agent:${agent}`;
  const within = p => prefix => p === prefix || (prefix.endsWith('/') && p.startsWith(prefix));
  return {
    async call(name, args) {
      if (name === 'site_files') return { files: (await treeOf(dir)).files ?? await treeOf(dir) };
      if (name === 'site_read') {
        if (!tracked(dir).has(args.path)) throw new Error(`${args.path} is not a file of this site`);
        const bytes = await readFile(join(dir, args.path));
        if (bytes.includes(0)) throw new Error(`${args.path} is not text`);
        return { path: args.path, version: etagOf(bytes), text: bytes.toString('utf8') };
      }
      if (name === 'site_write') return saveFile(dir, args.path, Buffer.from(String(args.text), 'utf8'), { replaces: String(args.version), via: by });
      if (name === 'site_add') return addFile(dir, args.path, Buffer.from(String(args.base64), 'base64')).then(r => ({ ...r, by }));
      if (name === 'site_history') {
        const all = await historyOf(dir);
        if (!args.path) return all;
        const of = within(String(args.path))
        return { saves: all.saves.filter(s => of(s.path) || (s.from && of(s.from))), commits: all.commits.filter(c => c.files.some(f => of(f))) };
      }
      if (name === 'site_status') return syncOf(dir);
      if (name === 'ohm_overview') {
        const [content, own, links, board] = await Promise.all([contentOf(dir), ownChannels(dir), linksOf(dir), boardOf(dir)]);
        return {
          site: content.site,
          channels: content.collections.map(c => ({ name: c.name, blocks: c.items.length, inside: [...new Set(c.items.map(i => i.channel).filter(Boolean))] })),
          own: own.channels.map(c => ({ name: c.parent ? `${c.parent}/${c.name}` : c.name, blocks: c.items.length })),
          links: links.length, canvas: { cards: board.cards.length, kinds: board.cards.reduce((n, c) => ({ ...n, [c.kind]: (n[c.kind] ?? 0) + 1 }), {}) },
          selection: live?.selection() ?? [], pointed: live?.pointed() ?? null,
        };
      }
      if (name === 'canvas_cards') return boardOf(dir);
      if (name === 'canvas_selection') { const ids = new Set(live?.selection() ?? []); return { cards: (await boardOf(dir)).cards.filter(c => ids.has(c.id)) }; }
      if (name === 'canvas_add') {
        const base = { id: randomUUID().slice(0, 8), x: Number(args.x ?? 0), y: Number(args.y ?? 0), ...(args.w ? { w: Number(args.w) } : {}), ...(args.h ? { h: Number(args.h) } : {}) };
        let card;
        if (args.kind === 'block') card = { ...base, kind: 'block', path: String(args.path ?? '') };
        else if (args.kind === 'channel') card = { ...base, kind: 'channel', name: String(args.name ?? ''), ...(args.view ? { view: args.view } : {}) };
        else if (args.kind === 'page') card = { ...base, kind: 'page', path: String(args.path ?? 'index.html'), w: base.w ?? 480, h: base.h ?? 300 };
        else if (args.kind === 'link') card = { ...base, kind: 'link', link: await addLink(dir, args.url), w: base.w ?? 320, h: base.h ?? 260 };
        else if (args.kind === 'note') card = { ...base, kind: 'note', text: String(args.text ?? ''), w: base.w ?? 220, h: base.h ?? 140 };
        else throw new Error('kind is one of block, channel, page, link, note');
        await changeBoard(dir, cards => [...cards, card], { by, live });
        return card;
      }
      if (name === 'canvas_update') {
        let found;
        await changeBoard(dir, cards => cards.map(c => {
          if (c.id !== args.id) return c;
          found = { ...c };
          for (const k of ['x', 'y', 'w', 'h']) if (args[k] !== undefined) found[k] = Number(args[k]);
          if (args.view !== undefined && c.kind === 'channel') found.view = args.view;
          if (args.text !== undefined && c.kind === 'note') found.text = String(args.text);
          return found;
        }), { by, live });
        if (!found) throw new Error(`No card ${args.id} on the canvas`);
        return found;
      }
      if (name === 'canvas_remove') { await changeBoard(dir, cards => cards.filter(c => c.id !== args.id), { by, live }); return { removed: args.id }; }
      if (name === 'canvas_connect') {
        const { cards } = await boardOf(dir);
        for (const end of [args.from, args.to]) if (!cards.some(c => c.id === end)) throw new Error(`No card ${end} on the canvas`);
        const line = { id: randomUUID().slice(0, 8), from: String(args.from), to: String(args.to), ...(args.text ? { text: String(args.text) } : {}) };
        await changeArrows(dir, arrows => [...arrows, line], { by, live });
        return line;
      }
      if (name === 'canvas_disconnect') { await changeArrows(dir, arrows => arrows.filter(a => a.id !== args.id), { by, live }); return { removed: args.id }; }
      if (name === 'canvas_show') { live?.announce({ type: 'view', id: String(args.id) }); return { shown: args.id }; }
      if (name === 'channels_list') {
        const [content, own] = await Promise.all([contentOf(dir), ownChannels(dir)]);
        const colorOf = n => own.colors[n] ?? null;
        return {
          site: content.collections.map(c => ({ name: c.name, blocks: c.items.length, color: colorOf(c.name),
            inside: Object.entries(c.items.reduce((n, i) => (i.channel ? { ...n, [i.channel]: (n[i.channel] ?? 0) + 1 } : n), {})).map(([inner, blocks]) => ({ name: `${c.name}/${inner}`, blocks, color: colorOf(`${c.name}/${inner}`) })) })),
          own: own.channels.map(c => ({ name: c.parent ? `${c.parent}/${c.name}` : c.name, blocks: c.items.length, color: c.color ?? null })),
        };
      }
      if (name === 'channel_items') {
        const [outer, inner] = String(args.channel).split('/');
        const content = await contentOf(dir);
        const c = content.collections.find(x => x.name === outer);
        if (c) return { items: c.items.filter(i => !inner || i.channel === inner).map(i => ({ path: i.path, title: i.title, kind: i.kind })) };
        const own = (await ownChannels(dir)).channels.find(x => (x.parent ? `${x.parent}/${x.name}` : x.name) === args.channel);
        if (!own) throw new Error(`No channel ${args.channel}`);
        return { items: own.items.map(path => ({ path })) };
      }
      if (name === 'channel_create') {
        const own = await ownChannels(dir);
        const nm = String(args.name).trim().replace(/\//g, '').slice(0, 80);
        if (!nm) throw new Error('A channel needs a name');
        if (own.channels.some(c => c.name === nm && (c.parent ?? '') === (args.parent ?? ''))) throw new Error(`There is a channel called ${nm} there already`);
        await keepOwnChannels(dir, { ...own, channels: [...own.channels, { name: nm, ...(args.parent ? { parent: args.parent } : {}), items: [] }] });
        live?.announce({ type: 'channels', by });
        return { created: args.parent ? `${args.parent}/${nm}` : nm };
      }
      if (name === 'channel_file') {
        const own = await ownChannels(dir);
        const target = own.channels.find(c => (c.parent ? `${c.parent}/${c.name}` : c.name) === args.channel);
        if (!target) throw new Error(`${args.channel} is not one of the person's own channels; make it with channel_create`);
        target.items = [...new Set([...target.items, String(args.path)])];
        await keepOwnChannels(dir, own);
        live?.announce({ type: 'channels', by });
        return { filed: args.path, into: args.channel };
      }
      if (name === 'channel_color') {
        const own = await ownChannels(dir);
        const value = args.color === 'none' ? '' : args.color;
        const mine = own.channels.find(c => (c.parent ? `${c.parent}/${c.name}` : c.name) === args.channel);
        if (mine) mine.color = value || undefined; else own.colors = { ...own.colors, [args.channel]: value };
        await keepOwnChannels(dir, own);
        live?.announce({ type: 'channels', by });
        return { channel: args.channel, color: args.color };
      }
      if (name === 'links_list') return { links: await linksOf(dir) };
      if (name === 'link_add') { const link = await addLink(dir, args.url); live?.announce({ type: 'links', by }); return link; }
      if (name === 'link_remove') { const out = await removeLink(dir, String(args.id)); live?.announce({ type: 'links', by }); return out; }
      if (name === 'pulls_list') return pullsOf(dir);
      if (name === 'tools_list') return { folder: toolsDir(dir), tools: await toolsOf(dir) };
      if (name === 'prompts_waiting') {
        const me = String(agent);
        const board = await boardOf(dir);
        // What a prompt is about: every card an arrow joins it to, either way.
        const about = id => board.arrows.filter(a => a.from === id || a.to === id).map(a => board.cards.find(c => c.id === (a.from === id ? a.to : a.from))).filter(Boolean)
          .map(c => ({ id: c.id, kind: c.kind, path: c.path, name: c.name, url: c.link?.url, text: c.text }));
        return { prompts: board.cards.filter(c => c.kind === 'prompt' && c.status === 'waiting' && (!c.to || c.to === me)).map(c => ({ id: c.id, text: c.text, sent: c.sent, about: about(c.id) })) };
      }
      if (name === 'prompt_answer') {
        let found;
        await changeBoard(dir, cards => cards.map(c => {
          if (c.id !== args.id || c.kind !== 'prompt') return c;
          found = { ...c, status: args.status, by: agent, answer: String(args.answer ?? c.answer ?? '').slice(0, 4000), answered: new Date().toISOString() };
          return found;
        }), { by, live });
        if (!found) throw new Error(`No prompt ${args.id} on the canvas`);
        return { id: found.id, status: found.status };
      }
      if (name === 'site_focus') return live ? live.setFocus(agent, args) : { shown: false };
      if (name === 'site_pointed') return { pointed: live?.pointed() ?? null };
      throw new Error(`No tool called ${name}`);
    },
  };
}
