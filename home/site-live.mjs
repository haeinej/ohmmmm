// The website, live (docs/serve.md): what is changing in the site folder, where each coding agent says it
// is working, and what the person last pointed at, kept in memory by `ohm serve` and told to the open
// app as it happens. Nothing here is written to disk: it is presence, not history (that is the save log).
import { watch } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';

const IGNORED = /(^|\/)(\.git|\.ohm|node_modules|\.DS_Store)(\/|$)/;

/** One site's live state, for one bridge. */
export function siteLive(dir) {
  const listeners = new Set();
  const focus = new Map(); // agent → { agent, path, selector, note, at }
  let pointed = null;      // { path, selector, text, html, at }
  let selection = [];      // ids of the cards chosen on the canvas
  const seen = new Map();  // agent → when it last spoke over MCP
  const sessions = new Map(); // agent → Map(session → { open, doing, at }): from its hooks (the ohm plugin), when it has them
  const edited = new Map();   // path → { agent, at }: files an agent said it just edited
  let watcher = null;
  const pending = new Map();

  const tell = event => { for (const send of listeners) send(event); };
  const start = () => {
    if (watcher) return;
    try {
      watcher = watch(dir, { recursive: true }, (_kind, name) => {
        if (!name) return;
        const path = String(name).split(sep).join('/');
        if (IGNORED.test(path) || path === basename(dir)) return;
        // A save is often several writes at once: tell it once, a moment after the last.
        clearTimeout(pending.get(path));
        pending.set(path, setTimeout(() => {
          pending.delete(path);
          // Who changed it, when an agent said so a moment ago (its hooks); else nobody known.
          const by = edited.get(path); const who = by && Date.now() - by.at < 10_000 ? by.agent : undefined;
          tell({ type: 'change', path, ...(who ? { by: who } : {}), at: new Date().toISOString() });
        }, 80));
      });
      watcher.on('error', () => { watcher?.close(); watcher = null; });
    } catch { watcher = null; }
  };
  const stopIfIdle = () => { if (!listeners.size && watcher) { watcher.close(); watcher = null; } };

  return {
    /** Listen to what happens: `send(event)` for every change, focus and pick. Returns the way to stop. */
    listen(send) {
      listeners.add(send);
      start();
      for (const f of focus.values()) send({ type: 'focus', ...f });
      if (pointed) send({ type: 'pointed', ...pointed });
      send({ type: 'agents', agents: this.agents() });
      return () => { listeners.delete(send); stopIfIdle(); };
    },
    /** Where an agent says it is working: a file, an element on a page, a word on what it is doing. */
    setFocus(agent, { path = '', selector = '', note = '' } = {}) {
      const f = { agent, path: String(path).slice(0, 300), selector: String(selector).slice(0, 500), note: String(note).slice(0, 200), at: new Date().toISOString() };
      if (!f.path && !f.selector) focus.delete(agent); else focus.set(agent, f);
      tell({ type: 'focus', ...f });
      return f;
    },
    /** What the person pointed at, from the app. */
    setPointed(pick) {
      pointed = pick && typeof pick === 'object' ? {
        path: String(pick.path ?? '').slice(0, 300), selector: String(pick.selector ?? '').slice(0, 500),
        text: String(pick.text ?? '').slice(0, 2000), html: String(pick.html ?? '').slice(0, 6000), at: new Date().toISOString(),
      } : null;
      tell({ type: 'pointed', ...(pointed ?? { cleared: true }) });
      return pointed;
    },
    pointed: () => pointed,
    /** An agent spoke over MCP: it is connected. Told when it first appears, or comes back after a quiet while. */
    agentSeen(agent) {
      const last = seen.get(agent) ?? 0
      seen.set(agent, Date.now());
      if (Date.now() - last > 60_000) tell({ type: 'agents', agents: this.agents() });
    },
    agents: () => [...new Set([...seen.keys(), ...sessions.keys()])].map(agent => {
      // Open while any of its sessions is; doing what its latest open session last said.
      const all = [...(sessions.get(agent)?.values() ?? [])];
      const open = all.filter(x => x.open).sort((a, b) => b.at - a.at);
      const at = Math.max(seen.get(agent) ?? 0, ...all.map(x => x.at));
      return { agent, seen: new Date(at).toISOString(), ...(all.length ? { open: open.length > 0, doing: open[0]?.doing ?? '' } : {}) };
    }),
    /**
     * What an agent says it is doing, from its own hooks (the ohm plugin): `start` and `end` of a session,
     * `edit` of a file (its full path), `prompt`, `stop` (done answering). An edit inside the site is told
     * to the app at once, so the change it makes next is known to be the agent's.
     */
    activity(agent, { event = '', tool = '', path = '', session = '' } = {}) {
      const now = Date.now();
      const before = this.agents().find(a => a.agent === agent);
      const mine = sessions.get(agent) ?? new Map(); sessions.set(agent, mine);
      const id = String(session || 'one').slice(0, 80);
      const was = mine.get(id);
      const rel = path ? relative(dir, String(path)).split(sep).join('/') : '';
      const inSite = rel && !rel.startsWith('..') && !IGNORED.test(rel);
      const tools = path ? relative(join(dir, '..', 'tools'), String(path)).split(sep).join('/') : '';
      const inTools = tools && !tools.startsWith('..');
      const shown = inSite ? rel : inTools ? `tools/${tools}` : '';
      // A page is called by its folder when it is that folder's index: writings/x/index.html is x.
      const named = shown.split('/').filter(Boolean); const what = /^index\./.test(named.at(-1) ?? '') && named.length > 1 ? named.at(-2) : named.at(-1);
      const doing = event === 'edit' ? (what ? `editing ${what}` : 'editing') : event === 'prompt' ? 'working' : event === 'stop' ? '' : was?.doing ?? '';
      const open = event === 'end' ? false : true;
      if (event === 'end') mine.delete(id); else mine.set(id, { open, doing, at: now });
      // A session not heard from for a day is forgotten.
      for (const [k, v] of mine) if (now - v.at > 86_400_000) mine.delete(k);
      if (!mine.size) mine.set('ended', { open: false, doing: '', at: now });
      else if (mine.size > 1) mine.delete('ended');
      seen.set(agent, now);
      if (event === 'edit' && inSite) edited.set(rel, { agent, at: now });
      if (event === 'edit' && shown) this.setFocus(agent, { path: shown, note: doing });
      tell({ type: 'activity', agent, event, tool: String(tool).slice(0, 60), path: shown, at: new Date(now).toISOString() });
      const after = this.agents().find(a => a.agent === agent);
      if (!before || before.open !== after.open || before.doing !== after.doing) tell({ type: 'agents', agents: this.agents() });
      return { agent, event, path: shown };
    },
    /** Tell the open app something happened: the board changed, a view was asked for. */
    announce: event => tell(event),
    /** What is chosen on the canvas, as the app says. */
    setSelection(ids) { selection = Array.isArray(ids) ? ids.filter(i => typeof i === 'string').slice(0, 200) : []; return selection; },
    selection: () => selection,
    relativeTo: full => relative(dir, full).split(sep).join('/'),
  };
}
