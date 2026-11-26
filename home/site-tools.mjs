// Tools (docs/serve.md): small apps the person's coding agent builds for them, each a plain folder in their
// home, beside the site: `<home>/tools/<name>/index.html`. The agent writes them with its own file tools,
// like any project; ohm does not make them. ohm watches the folder, lists each tool with the person's blocks
// (they drag it onto the canvas), and runs each one sandboxed: no network, no reach into ohm, only what ohm hands it on asking (its channels,
// links, canvas). A `tool.json` beside the page may say its `title` and `description`; without one, the
// page's <title> and <meta name="description"> do.
import { existsSync, watch } from 'node:fs';
import { mkdir, readdir, readFile, rename, stat } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';

export const slug = name => String(name ?? '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
/** Where the tools are, for a site at `dir`: `tools/` in the same home. */
export const toolsDir = dir => join(dirname(dir), 'tools');
const MAX = 1_000_000;

const tag = (html, re) => (html.match(re)?.[1] ?? '').replace(/\s+/g, ' ').trim();

/** Every tool: `{ name, title, description, changed, folder }`, newest first. */
export async function toolsOf(dir) {
  const root = toolsDir(dir);
  const out = [];
  for (const name of await readdir(root).catch(() => [])) {
    if (name.startsWith('.') || slug(name) !== name) continue;
    const page = join(root, name, 'index.html');
    const s = await stat(page).catch(() => null);
    if (!s?.isFile()) continue;
    const meta = await readFile(join(root, name, 'tool.json'), 'utf8').then(JSON.parse).catch(() => ({}));
    const html = s.size <= MAX ? await readFile(page, 'utf8').catch(() => '') : '';
    out.push({
      name,
      title: String(meta.title || tag(html, /<title[^>]*>([^<]*)<\/title>/i) || name).slice(0, 120),
      description: String(meta.description || tag(html, /<meta\s+name=["']description["']\s+content=["']([^"']*)["']/i)).slice(0, 400),
      ...(typeof meta.by === 'string' ? { by: meta.by } : {}),
      changed: s.mtime.toISOString(),
      folder: join(root, name),
    });
  }
  return out.sort((a, b) => b.changed.localeCompare(a.changed));
}

/** One tool's page. */
export async function toolPage(dir, name) {
  const n = slug(name);
  if (!n || n !== name) throw Object.assign(new Error('Say which tool, by its folder name'), { status: 400 });
  const page = join(toolsDir(dir), n, 'index.html');
  const s = await stat(page).catch(() => null);
  if (!s?.isFile()) throw Object.assign(new Error(`No tool called ${name}`), { status: 404 });
  if (s.size > MAX) throw Object.assign(new Error('A tool is up to 1 MB'), { status: 413 });
  return readFile(page, 'utf8');
}

/** Tools kept by earlier versions in `site/.ohm/tools/` move to the home's `tools/`, once. */
export async function moveOldTools(dir) {
  const old = join(dir, '.ohm', 'tools');
  if (!existsSync(old)) return [];
  await mkdir(toolsDir(dir), { recursive: true });
  const moved = [];
  for (const name of await readdir(old).catch(() => [])) {
    const to = join(toolsDir(dir), name);
    if (existsSync(to)) continue;
    await rename(join(old, name), to); moved.push(name);
  }
  return moved;
}

/**
 * Watch the tools folder: a tool that is new or changed is told to the open app, which lists it in Tools
 * (to drag onto the canvas, like any block) and reloads it where it runs. Returns the way to stop.
 */
export function watchTools(dir, live) {
  const root = toolsDir(dir);
  let watcher = null;
  const pending = new Map();
  const seen = async name => {
    if (existsSync(join(root, name, 'index.html'))) live?.announce({ type: 'tools', name });
  };
  const start = async () => {
    await mkdir(root, { recursive: true });
    try {
      watcher = watch(root, { recursive: true }, (_kind, file) => {
        const name = String(file ?? '').split(sep)[0];
        if (!name || name.startsWith('.') || slug(name) !== name) return;
        clearTimeout(pending.get(name));
        pending.set(name, setTimeout(() => { pending.delete(name); seen(name).catch(() => {}); }, 150));
      });
      // It never keeps ohm running by itself.
      watcher.unref?.();
      watcher.on('error', () => { watcher?.close(); watcher = null; });
    } catch { watcher = null; }
  };
  const ready = start();
  return { ready, stop: () => { watcher?.close(); for (const t of pending.values()) clearTimeout(t); } };
}
