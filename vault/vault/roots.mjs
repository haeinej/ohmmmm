// The places a vault reads from besides itself, as `.vault/config.json` names them. Nothing here
// touches a disk: it checks the configuration and answers which files a root takes in.
//
//   { "roots": [
//       { "name": "drive", "path": "~/Library/CloudStorage/GoogleDrive-…/My Drive/Research",
//         "channel": "research", "include": ["**/*.pdf", "*.md"], "exclude": ["drafts/**"], "retain": "reference",
//         "note": "Papers I cite. Newest at the top of each folder; the README in each says which are read." } ] }
//
// `note` is the person's guidance for agents: what lives here, which files to trust, how to use them.
// vault_where gives it to agents with the root's counts.
//
// The vault's own folder is always the canonical root, named `vault`, and is not listed. Every listed
// root is read-only: the vault indexes its files as blocks in the root's channel, with `origin` set
// to where each file is, and never writes there.
import { originKind, RETAIN, isChannelPath } from './node.mjs';

export const CONFIG = '.vault/config.json';
export const CANONICAL = 'vault';
export const MODES = ['read'];
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// A glob as a test of a path relative to its root. `**` crosses folders, `*` and `?` do not. A
// pattern with no "/" is matched against the file's name wherever it is, as .gitignore does.
export function globTest(pattern) {
  const anywhere = !pattern.includes('/');
  let source = '';
  for (let at = 0; at < pattern.length; at++) {
    const char = pattern[at];
    if (char === '*' && pattern[at + 1] === '*') {
      const slash = pattern[at + 2] === '/';
      source += slash ? '(?:.*/)?' : '.*';
      at += slash ? 2 : 1;
    } else if (char === '*') source += '[^/]*';
    else if (char === '?') source += '[^/]';
    else source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  const test = new RegExp(`^${source}$`);
  return path => test.test(anywhere ? path.split('/').at(-1) : path);
}

const expand = (path, home) => (path === '~' ? home : path.startsWith('~/') ? `${home}${path.slice(1)}` : path);
const inside = (child, parent) => child === parent || child.startsWith(parent.endsWith('/') ? parent : `${parent}/`);

// The configuration checked and filled in: each root with its absolute path, channel, patterns and
// how much of each file is kept. `problems` says what is wrong, in sentences; a root with a problem
// is left out, so one bad entry does not stop the others being indexed.
//   vault: the vault's own absolute path; home: the user's home folder, for "~"
export function readConfig(value, { vault, home }) {
  const problems = [];
  if (value === undefined || value === null) return { roots: [], problems };
  if (typeof value !== 'object' || Array.isArray(value)) return { roots: [], problems: [`${CONFIG} holds one object, with a "roots" list`] };
  const unknown = Object.keys(value).filter(key => key !== 'roots');
  if (unknown.length) problems.push(`${CONFIG} has settings this vault does not know: ${unknown.join(', ')}`);
  if (value.roots !== undefined && !Array.isArray(value.roots)) return { roots: [], problems: [...problems, '"roots" is a list'] };
  const roots = [];
  for (const [index, entry] of (value.roots ?? []).entries()) {
    const label = typeof entry?.name === 'string' ? `The root "${entry.name}"` : `Root ${index + 1}`;
    const said = [];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) { problems.push(`${label} is not an object`); continue; }
    const name = entry.name;
    if (typeof name !== 'string' || !NAME.test(name)) said.push('needs a name in lowercase letters, digits and hyphens');
    else if (name === CANONICAL) said.push(`cannot be called "${CANONICAL}", which is the vault's own folder`);
    else if (roots.some(root => root.name === name)) said.push('has the same name as another root');
    const mode = entry.mode ?? 'read';
    if (mode === 'two-way') said.push('asks for two-way sync, which is not built yet. Use "read" for now: the vault indexes the folder and never writes to it');
    else if (!MODES.includes(mode)) said.push(`has mode "${mode}"; the mode is "read"`);
    const path = typeof entry.path === 'string' ? expand(entry.path.trim(), home).replace(/\/+$/, '') : '';
    if (!path.startsWith('/')) said.push('needs a path: an absolute folder, or one starting ~/');
    else if (inside(path, vault) || inside(vault, path)) said.push('is the vault itself, inside it, or around it; a root is a different folder');
    else if (roots.some(root => root.path === path)) said.push('has the same folder as another root');
    const channel = entry.channel ?? name;
    if (!isChannelPath(channel)) said.push(`has channel "${channel}", which is not a channel's path: folders joined by "/", none starting with "." or "_"`);
    const drive = originKind(path) === 'drive';
    const retain = entry.retain ?? (drive ? 'reference' : 'text');
    if (!RETAIN.includes(retain)) said.push(`keeps "${retain}"; retain is one of: ${RETAIN.join(', ')}`);
    const patterns = key => {
      const given = entry[key] ?? (key === 'include' ? ['**/*'] : []);
      if (!Array.isArray(given) || !given.every(each => typeof each === 'string' && each.trim())) { said.push(`has "${key}" that is not a list of patterns`); return []; }
      return given;
    };
    const include = patterns('include'), exclude = patterns('exclude');
    const note = entry.note;
    if (note !== undefined && (typeof note !== 'string' || note.length > 4000)) said.push('has a note that is not text of at most 4,000 characters');
    const extra = Object.keys(entry).filter(key => !['name', 'path', 'mode', 'channel', 'include', 'exclude', 'retain', 'note'].includes(key));
    if (extra.length) said.push(`has settings this vault does not know: ${extra.join(', ')}`);
    if (said.length) { problems.push(`${label} ${said.join('; ')}.`); continue; }
    const includes = include.map(globTest), excludes = exclude.map(globTest);
    roots.push({
      name, path, mode, channel, retain, include, exclude, drive, ...(note ? { note } : {}),
      takes: relative => includes.some(test => test(relative)) && !excludes.some(test => test(relative)),
    });
  }
  return { roots, problems };
}

// The configuration a new vault starts with: no roots besides itself.
export const emptyConfig = () => ({ roots: [] });
