// A cortex kept as a folder. The files are the cortex: what a person reads and edits by hand is
// what an agent is given, and nothing here holds a second copy (docs/model.md).
//
//   profile.md  observations/  skills/  tools/  agents/     what is in force
//   .cortex/                                               the journal, what was replaced, and machinery
//
// Four parts. The profile is the person: the account it belongs to, and their preferences and goals
// in their own words. Observations are what agents learned while working with them, one file each:
// about the person, or about blocks and channels of their vault. Skills are how to do things their
// way; tools are what an agent may act with.
//
// The person can edit everything. Agents add observations, edit or remove only their own (and only
// until the person has changed one), propose profile lines and skills, and ask for tools. Every
// write is a change line in the journal that says who made it, and can be reverted.
import { homeVaultFor } from '../../home/home.mjs';
import { appendFile, cp, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, sep } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { vaultFrom } from './vault.mjs';
import { actorOf, openJournal, order, PEOPLE } from './journal.mjs';
import { cortexVersion, NAME, Refused, splitFront, writeFront } from './core.mjs';

const bytes = text => new TextEncoder().encode(text).length;
const missing = problem => problem?.code === 'ENOENT' || problem?.code === 'ENOTDIR';
const text = path => readFile(path, 'utf8').catch(problem => { if (missing(problem)) return null; throw problem; });
const names = path => readdir(path, { withFileTypes: true }).catch(problem => { if (missing(problem)) return []; throw problem; });
const changed = (what, current) => new Refused('Changed', `The ${what} has changed since the version this request names. Read it again.`, { current });
const known = (name, what) => {
  if (typeof name !== 'string' || name.length > 100 || !NAME.test(name)) throw new Refused('InvalidRequest', `Say which ${what} with its lowercase, hyphenated name`);
  return name;
};
const oneLine = (value, max = 500) => typeof value === 'string' && value.trim() && [...value].length <= max && !/[\r\n]/.test(value);

async function put(path, content) {
  await mkdir(dirname(path), { recursive: true });
  const partial = `${path}.${process.pid}.tmp`;
  await writeFile(partial, content);
  await rename(partial, path);
}

const checkReason = reason => {
  if (reason !== undefined && !oneLine(reason)) throw new Refused('InvalidRequest', 'reason is one line, at most 500 characters');
  return reason?.trim();
};

// Names that mean the person, or the signed-in account. An agent never writes under one of them.
export const RESERVED = PEOPLE;
export const agentName = given => {
  const name = typeof given === 'string' && given.trim() ? given.trim().slice(0, 100) : 'agent';
  return RESERVED.includes(name.toLowerCase()) || name.toLowerCase() === 'you' ? `agent:${name}` : name;
};
// How an author is written in an observation: the person is "you", anyone else by name.
const authorOf = actor => (actorOf(actor).kind === 'human' ? 'you' : actor);

// Hooks keep their own checkpoints (a session's start, its turns, an ask) to know when to ask for
// observations. They are bookkeeping for this machine, not history, so they are not in the journal.
export const hooksLog = dir => join(dir, '.cortex', 'hooks.jsonl');

// The account a profile belongs to: a DID, or a handle.
export const ACCOUNT = /^(?:did:[a-z]+:[A-Za-z0-9._:%-]+|(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,})$/i;
export const checkAccount = value => {
  if (typeof value !== 'string' || !ACCOUNT.test(value.trim())) throw new Refused('InvalidRequest', 'The account is a DID, such as did:plc:…, or a handle, such as alice.example.com');
  return value.trim();
};

// An observation's ID is made once where it was seen, and reused on a retry.
export const OBSERVATION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
// Who an observation is waiting for. A working agent flags what only the curator settles (labels,
// channels, moves, merges) with needs: curator; the curator answers with an observation of its own
// that settles it. A settle names the flag at the version it answered, so a flag rewritten with a
// new question is open again. The cortex cannot tell a curator subagent from the agent it runs in
// (they share one name), so a flag is settled by the person, or by an agent other than the one that
// raised it; nothing else counts.
export const NEEDS = ['curator'];
// How many observations a session is handed, besides the pinned ones.
export const RECENT = 30;
const CHANNEL = 'channel:';

// A new cortex is a copy of the template. An existing one is never written over.
export async function initCortex(dir, template, { account } = {}) {
  // Checked before anything is copied, so a refusal leaves the folder as it was.
  const checked = account === undefined ? undefined : checkAccount(account);
  if ((await names(dir)).some(entry => !entry.name.startsWith('.'))) throw new Refused('NameTaken', `${dir} already holds files. A cortex is started in an empty folder.`);
  await cp(template, dir, { recursive: true, filter: source => !source.endsWith('.gitkeep') });
  for (const folder of ['agents/secrets', 'observations', 'skills', 'tools', '.cortex']) await mkdir(join(dir, folder), { recursive: true });
  if (checked !== undefined) await openCortex(dir, { actor: 'account' }).setAccount(checked);
  return { dir };
}

// `vault`, when given, is the vault this cortex reads; otherwise it is the one .cortex/vault.json names.
export function openCortex(dir, { actor = 'member', now = () => new Date(), vault: givenVault } = {}) {
  const at = (...parts) => join(dir, ...parts);
  const journal = openJournal(dir, { now });
  const person = actorOf(actor).kind === 'human';
  const onlyPerson = what => { if (!person) throw new Refused('PersonOnly', `Only the person ${what}`); };

  // Every replaced or removed file is kept, named by when it was replaced and the version it was.
  async function keep(kind, name, content, version) {
    const stamp = now().toISOString().replace(/[:.]/g, '-');
    await put(at('.cortex', 'history', kind, name, `${stamp}_${version}.md`), content);
  }
  const fileVersion = content => cortexVersion({ file: content });
  const earlier = async (kind, name) => (await names(at('.cortex', 'history', kind, name)))
    .filter(entry => entry.isFile()).map(entry => entry.name).filter(file => file.endsWith('.md')).sort().reverse()
    .map(file => ({ file, version: file.slice(file.indexOf('_') + 1, -3), replacedAt: file.slice(0, file.indexOf('_')) }));

  // --- Skills and tools -------------------------------------------------------------------------
  async function folderOf(root) {
    const files = [];
    async function walk(relative) {
      for (const entry of await names(join(root, relative))) {
        const path = relative ? `${relative}/${entry.name}` : entry.name;
        if (entry.isDirectory()) await walk(path);
        else if (entry.isFile() && path !== 'SKILL.md') files.push({ path, text: await readFile(join(root, path), 'utf8') });
      }
    }
    await walk('');
    return files.sort((a, b) => a.path.localeCompare(b.path));
  }
  async function skillAt(root) {
    const content = await text(join(root, 'SKILL.md'));
    if (content === null) return null;
    const skill = { text: content, files: await folderOf(root) };
    const { name, description } = splitFront(content).properties;
    return { name, description, skill, version: await cortexVersion(skill) };
  }
  async function listed(root, read) {
    const found = [];
    for (const entry of await names(root)) {
      const item = await read(entry);
      if (item) found.push(item);
    }
    return found.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }
  const skillsIn = root => listed(root, async entry => {
    if (!entry.isDirectory()) return null;
    const found = await skillAt(join(root, entry.name));
    return found && { name: entry.name, description: String(found.description ?? ''), version: found.version };
  });
  const toolsIn = root => listed(root, async entry => {
    if (!entry.isFile() || !entry.name.endsWith('.md')) return null;
    const { properties } = splitFront(await readFile(join(root, entry.name), 'utf8'));
    return { name: entry.name.slice(0, -3), description: String(properties.description ?? ''), on: properties.on === true };
  });

  // --- The vault --------------------------------------------------------------------------------
  // The vault this cortex reads, if one is connected. Read through the contract only.
  let openedVault;
  async function theVault() {
    if (givenVault) return givenVault;
    if (openedVault !== undefined) return openedVault;
    const config = await text(at('.cortex', 'vault.json'));
    let parsed = null;
    if (config) {
      try { parsed = JSON.parse(config); } catch { throw new Refused('InvalidVault', '.cortex/vault.json cannot be read. Connect the vault again with cortex vault connect'); }
    }
    // In a home (ohmmmm.<handle>/cortex), the sibling vault, unless the person named another.
    parsed ??= homeVaultFor(dir);
    openedVault = parsed ? vaultFrom(parsed) : null;
    return openedVault;
  }
  const short = value => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);

  // --- Observations -----------------------------------------------------------------------------
  // One file each, observations/<id>.md: who wrote it and when between --- lines, then what was seen.
  const observationPath = id => at('observations', `${id}.md`);
  const readObservationFile = (id, content) => {
    const { properties, body } = splitFront(content);
    const about = Array.isArray(properties.about) ? properties.about.filter(item => typeof item === 'string') : [];
    // Each settle is written <flag id>@<the flag's version it answered>.
    const settled = (Array.isArray(properties.settles) ? properties.settles : [])
      .map(item => (typeof item === 'string' ? /^([^@]+)@(c[0-9a-f]+)$/.exec(item) : null)).filter(Boolean)
      .map(([, flag, version]) => ({ id: flag, version }));
    return {
      id, text: body.trim(), by: typeof properties.by === 'string' ? properties.by : 'you',
      at: typeof properties.at === 'string' ? properties.at : null,
      ...(typeof properties.session === 'string' ? { session: properties.session } : {}),
      ...(about.length ? { about } : {}),
      ...(properties.pin === true ? { pin: true } : {}),
      ...(NEEDS.includes(properties.needs) ? { needs: properties.needs } : {}),
      ...(settled.length ? { settles: settled.map(item => item.id), settled } : {}),
    };
  };
  const observationFile = ({ text: said, by, at: when, session, about, pin, needs, settled }) =>
    writeFront({ at: when, by, ...(session ? { session } : {}), ...(about?.length ? { about } : {}), ...(pin ? { pin: true } : {}),
      ...(needs ? { needs } : {}), ...(settled?.length ? { settles: settled.map(item => `${item.id}@${item.version}`) } : {}) }, `${said.trim()}\n`);
  async function heldObservation(id) {
    const content = await text(observationPath(id));
    if (content === null) return null;
    return { observation: readObservationFile(id, content), content, version: await fileVersion(content) };
  }
  // Every observation, newest first. A file that cannot be read is reported, not thrown.
  async function allObservations() {
    const found = [];
    const problems = [];
    for (const entry of await names(at('observations'))) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      const id = entry.name.slice(0, -3);
      if (!OBSERVATION_ID.test(id)) { problems.push(`observations/${entry.name}: its name is not an observation ID`); continue; }
      try {
        const held = await heldObservation(id);
        if (held) found.push({ ...held.observation, version: held.version });
      } catch (problem) {
        if (!problem?.code) throw problem;
        problems.push(`observations/${entry.name} cannot be read: ${problem.code}`);
      }
    }
    found.sort((a, b) => String(b.at ?? '').localeCompare(String(a.at ?? '')) || a.id.localeCompare(b.id));
    return { observations: found, problems };
  }
  const checkObservationId = id => {
    if (typeof id !== 'string' || !OBSERVATION_ID.test(id)) throw new Refused('InvalidRequest', 'An observation ID is letters, digits, - and _, at most 128 characters, made once where it was seen');
    return id;
  };
  // What an observation is about must be there: a block the vault has, or one of its channels.
  async function checkAbout(about) {
    if (about === undefined) return [];
    if (!Array.isArray(about) || about.length > 20 || new Set(about).size !== about.length
      || about.some(item => typeof item !== 'string' || !item.trim() || item.length > 300 || /[\r\n]/.test(item))) {
      throw new Refused('InvalidRequest', 'about is up to 20 distinct block IDs, or channels written channel:<path>');
    }
    const vault = await theVault();
    if (!vault || !about.length) return about;
    const channels = about.filter(item => item.startsWith(CHANNEL)).map(item => item.slice(CHANNEL.length));
    const blocks = about.filter(item => !item.startsWith(CHANNEL));
    if (channels.length) {
      const shape = await vault.shape();
      const have = new Set(shape.channels.map(item => item.channel));
      const gone = channels.filter(channel => !have.has(channel));
      if (gone.length) throw new Refused('NotFound', `The vault has no channel ${gone.join(', ')}`);
    }
    if (blocks.length) {
      const where = await vault.exists(blocks);
      const gone = blocks.filter(id => !where[id]?.exists);
      if (gone.length) throw new Refused('NotFound', `The vault has no block ${gone.join(', ')}`);
    }
    return about;
  }

  // --- The profile ------------------------------------------------------------------------------
  const HEADINGS = ['Preferences', 'Goals', 'Notes'];
  async function readProfile() {
    const content = await text(at('profile.md'));
    if (content === null) return { account: null, text: '', sections: [], version: null, content: null };
    const { properties, body } = splitFront(content);
    const sections = [];
    for (const line of body.split(/\r?\n/)) {
      const heading = /^##\s+(.+?)\s*$/.exec(line);
      if (heading) sections.push({ heading: heading[1], lines: [] });
      else if (sections.length && line.trim()) sections.at(-1).lines.push(line.replace(/^\s*[-*]\s+/, '').trim());
    }
    return { account: typeof properties.account === 'string' ? properties.account : null, text: body.trim(), sections, version: await fileVersion(content), content };
  }
  const profileLog = at('.cortex', 'profile.jsonl');
  const same = value => String(value).trim().toLowerCase().replace(/\s+/g, ' ');
  async function profileEntries() {
    return ((await text(profileLog)) ?? '').split('\n').filter(Boolean).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
  }
  const recordProfile = async entry => {
    await mkdir(dirname(profileLog), { recursive: true });
    await appendFile(profileLog, `${JSON.stringify({ ...entry, by: actor, when: now().toISOString() })}\n`);
  };
  // Adds one line under a heading, making the heading at the end if the profile has none of that name.
  function withLine(body, heading, line) {
    const lines = body.replace(/\s+$/, '').split('\n');
    const start = lines.findIndex(each => same(each.replace(/^##\s+/, '')) === same(heading) && /^##\s+/.test(each));
    if (start < 0) return `${lines.join('\n')}${lines.join('').trim() ? '\n\n' : ''}## ${heading.trim()}\n\n- ${line.trim()}\n`;
    let end = lines.findIndex((each, index) => index > start && /^##\s+/.test(each));
    if (end < 0) end = lines.length;
    // After the section's last line with words, so the blank line before the next heading stays.
    let last = end - 1;
    while (last > start && !lines[last].trim()) last--;
    lines.splice(last + 1, 0, ...(last === start ? ['', `- ${line.trim()}`] : [`- ${line.trim()}`]));
    return `${lines.join('\n')}\n`;
  }

  // --- Nodes ------------------------------------------------------------------------------------
  // Every file of the cortex is a node, named the same way in every change line:
  //   profile              profile.md
  //   playbook             agents/AGENTS.md
  //   observation/<id>     observations/<id>.md
  //   skill/<name>         skills/<name>/, SKILL.md and the files beside it
  //   tool/<name>          tools/<name>.md
  // A journal from before docs/model.md also names identity, memory/<name>, working/<agent> and
  // channel/<path>. Their earlier versions can still be read, and only the person restores them.
  const SLUG = '[a-z]+(?:-[a-z]+)*';
  const fileNode = (node, path, kept, extra = {}) => ({
    node, kept, ...extra,
    live: async () => { const content = await text(path); return content === null ? null : { content, version: await fileVersion(content) }; },
    version: content => fileVersion(content),
    write: content => put(path, content),
    remove: () => rm(path, { force: true }),
  });
  function nodeOf(node) {
    if (typeof node !== 'string' || !node || node.length > 300) throw new Refused('InvalidRequest', 'Name a node as cortex_history lists it, such as observation/<id>, profile or skill/<name>');
    let found;
    if (node === 'profile') return fileNode(node, at('profile.md'), ['profile', 'profile'], { personOnly: true });
    if (node === 'playbook') return fileNode(node, at('agents', 'AGENTS.md'), ['playbook', 'playbook'], { personOnly: true });
    if ((found = /^observation\/(.+)$/.exec(node)) && OBSERVATION_ID.test(found[1])) {
      return { ...fileNode(node, observationPath(found[1]), ['observations', found[1]]), observation: found[1] };
    }
    if ((found = new RegExp(`^skill/(${SLUG})$`).exec(node))) {
      const root = at('skills', found[1]);
      return {
        node, kept: ['skills', found[1]], personOnly: true,
        // Kept as the whole skill; a skill kept before this was its SKILL.md alone.
        encode: content => JSON.stringify(content),
        decode: kept => { try { const parsed = JSON.parse(kept); if (typeof parsed?.text === 'string') return parsed; } catch {} return kept; },
        live: async () => { const live = await skillAt(root); return live && { content: live.skill, version: live.version }; },
        version: content => cortexVersion(typeof content === 'string' ? { text: content, files: [] } : content),
        write: async content => {
          if (typeof content === 'string') return put(join(root, 'SKILL.md'), content);
          await rm(root, { recursive: true, force: true });
          await put(join(root, 'SKILL.md'), content.text);
          for (const file of content.files) await put(join(root, normalize(file.path)), file.text);
        },
        remove: () => rm(root, { recursive: true, force: true }),
      };
    }
    if ((found = new RegExp(`^tool/(${SLUG})$`).exec(node))) return fileNode(node, at('tools', `${found[1]}.md`), ['tools', found[1]], { personOnly: true });
    // From before docs/model.md.
    if (node === 'identity') return fileNode(node, at('identity.md'), ['identity', 'identity'], { personOnly: true });
    if ((found = new RegExp(`^memory/(${SLUG})$`).exec(node))) return fileNode(node, at('memory', `${found[1]}.md`), ['memory', found[1]], { personOnly: true });
    if ((found = /^working\/([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(node))) return fileNode(node, at('.cortex', 'working', `${found[1]}.md`), ['working', found[1]], { personOnly: true });
    if ((found = /^channel\/(.+)$/.exec(node)) && !found[1].split('/').some(part => !part || part === '.' || part === '..')) {
      return { node, kept: ['channels', found[1]], personOnly: true, decode: kept => JSON.parse(kept), live: async () => null,
        version: content => cortexVersion({ channel: content }), write: async () => {}, remove: async () => {} };
    }
    throw new Refused('NotFound', `There is no node ${node}. A node is profile, playbook, observation/<id>, skill/<name> or tool/<name>`);
  }
  const encode = (spec, content) => (spec.encode ? spec.encode(content) : content);
  // The content of a node at one of its versions: as it is now, or the copy kept when it was
  // replaced. A journal from when agents' edits waited for the person may hold proposal lines that
  // carried their content; those versions can be read back too.
  async function contentAt(spec, version, lines) {
    const live = await spec.live();
    if (live?.version === version) return live.content;
    const file = (await earlier(...spec.kept)).find(item => item.version === version)?.file;
    if (file) {
      const kept = await readFile(at('.cortex', 'history', ...spec.kept, file), 'utf8');
      return spec.decode ? spec.decode(kept) : kept;
    }
    const proposed = (lines ?? await journal.read()).find(line => line.type === 'proposal' && line.node === spec.node && line.after === version && line.content !== undefined);
    return proposed ? proposed.content : null;
  }

  // Writes a node: what it replaces is kept, then the new content, or nothing to remove it.
  async function apply(spec, content) {
    const live = await spec.live();
    if (live) await keep(...spec.kept, encode(spec, live.content), live.version);
    if (content === null) await spec.remove(); else await spec.write(content);
    return (await spec.live())?.version ?? null;
  }

  // Whether this actor may write a node. The person may write any. An agent never writes a
  // personOnly node. It writes an observation only when it is new, or its own and as it left it:
  // once the person or another agent has changed one, by hand or through cortex, it is theirs.
  async function mayWrite(spec, what) {
    if (person) return;
    if (spec.personOnly) throw new Refused('PersonOnly', `Only the person ${what} ${spec.node}`);
    if (spec.observation === undefined) return;
    const live = await spec.live();
    if (!live) return;
    const { by } = readObservationFile(spec.observation, live.content);
    const last = (await journal.read()).filter(line => line.type === 'change' && line.node === spec.node).at(-1);
    if (by === 'vault' && (!last || last.after === live.version)) return;
    if (by !== actor || !last || last.actor?.name !== actor || last.after !== live.version) {
      throw new Refused('PersonOnly', `${spec.node} is not yours as you left it, so only the person changes it now. Write a new observation instead`);
    }
  }

  // The one way an edit is made, by the person or an agent alike: what it replaces is kept, the node
  // is written, and a change line says who made it, with its versions before and after, and why.
  async function edit(spec, op, content, { before = null, reason, session, extra = {} } = {}) {
    await mayWrite(spec, op === 'restore' ? 'restores' : 'changes');
    const after = await apply(spec, content);
    const line = await journal.append(actor, 'change', { node: spec.node, op, before, after, ...(reason ? { reason } : {}), ...extra }, { session });
    return { node: spec.node, op, version: after, change: line.id, seq: line.seq };
  }

  // A point in the journal: a save's name, a date or a time, or a seq. A date with no time means
  // the end of that day, in UTC.
  const DAY = /^\d{4}-\d{2}-\d{2}$/;
  function pointOf(when, lines) {
    if (Number.isSafeInteger(when) || (typeof when === 'string' && /^\d+$/.test(when))) {
      const seq = Number(when);
      return { said: { seq }, holds: line => line.seq <= seq };
    }
    if (typeof when !== 'string' || !when.trim() || when.length > 100) throw new Refused('InvalidRequest', 'Say when: a save\'s name, a date such as 2026-11-19, a time, or a seq');
    if (/^\d{4}-\d{2}-\d{2}/.test(when)) {
      const time = DAY.test(when) ? `${when}T23:59:59.999Z` : when;
      if (!Number.isFinite(Date.parse(time))) throw new Refused('InvalidRequest', `${when} is not a date or a time`);
      const until = new Date(time).toISOString();
      return { said: { at: until }, holds: line => line.at <= until };
    }
    const saved = lines.filter(line => line.type === 'save' && line.name === when).at(-1);
    if (!saved) throw new Refused('NotFound', `There is no save named ${when}`);
    return { said: { save: saved.name, seq: saved.seq, at: saved.at }, holds: line => order(line, saved) <= 0 };
  }
  const SAVE_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

  // Sessions: what an agent writes when it finishes a task, or gives it up.
  function checkSession({ summary, outcome = 'done', made = [], deadEnds = [], resolved = [], project, session } = {}) {
    if (!oneLine(summary, 300)) throw new Refused('InvalidRequest', 'summary is one line of what was done, at most 300 characters');
    if (!['done', 'stopped'].includes(outcome)) throw new Refused('InvalidRequest', 'outcome is done, or stopped when the task was given up');
    if (!Array.isArray(made) || made.length > 100 || made.some(id => typeof id !== 'string' || !id || id.length > 100)) throw new Refused('InvalidRequest', 'made is up to 100 IDs of the changes this task made');
    if (!Array.isArray(deadEnds) || deadEnds.length > 20) throw new Refused('InvalidRequest', 'deadEnds is up to 20 things tried and dropped');
    for (const item of deadEnds) {
      if (!item || typeof item !== 'object' || Object.keys(item).some(key => !['tried', 'why', 'check'].includes(key)) || !oneLine(item.tried) || !oneLine(item.why) || (item.check !== undefined && !oneLine(item.check))) {
        throw new Refused('InvalidRequest', 'A dead end has tried and why, one line each, and may have check: a command that shows whether it still holds');
      }
    }
    if (!Array.isArray(resolved) || resolved.length > 50 || resolved.some(id => typeof id !== 'string' || !id)) throw new Refused('InvalidRequest', 'resolved is up to 50 IDs of dead ends that no longer hold');
    if (project !== undefined && !oneLine(project, 2000)) throw new Refused('InvalidRequest', 'project is the folder or project the task was in, on one line');
    if (session !== undefined && !oneLine(session, 200)) throw new Refused('InvalidRequest', 'session is one line, at most 200 characters');
  }
  // Two paths are near when one is the other or holds it.
  const near = (a, b) => {
    const trim = path => String(path).replace(/\/+$/, '');
    const [x, y] = [trim(a), trim(b)];
    return x === y || x.startsWith(`${y}/`) || y.startsWith(`${x}/`);
  };

  // What the vault looks like to the cortex: its channels and counts, how many observations are
  // about each, and observations pointing at blocks no longer there.
  async function vaultView(vault, observations) {
    const shape = await vault.shape();
    const pointed = [...new Set(observations.flatMap(item => (item.about ?? []).filter(each => !each.startsWith(CHANNEL))))];
    const where = pointed.length ? await vault.exists(pointed) : {};
    const notes = channel => observations.filter(item => item.about?.includes(`${CHANNEL}${channel}`)).length;
    return {
      connected: true,
      channels: shape.channels.map(({ channel, blocks }) => ({ channel, blocks, ...(notes(channel) ? { observations: notes(channel) } : {}) })),
      broken: observations.flatMap(item => (item.about ?? []).filter(each => !each.startsWith(CHANNEL) && !where[each]?.exists).map(block => ({ observation: item.id, block }))),
      ...(shape.problems?.length ? { problems: shape.problems } : {}),
    };
  }

  const cortex = {
    dir, nodeOf,

    // --- History --------------------------------------------------------------------------------

    // The changes recorded in the journal, oldest first, and the saves among them. node is a node,
    // or a prefix ending in / for every node under it. since is a seq (changes after it) or a date or
    // time (changes from then on). actor is a name, or human or agent.
    async history({ node, since, actor: who, limit = 50 } = {}) {
      if (node !== undefined && (typeof node !== 'string' || !node || node.length > 300)) throw new Refused('InvalidRequest', 'node is a node, such as observation/<id>, or a prefix ending in /, such as observation/');
      if (who !== undefined && (typeof who !== 'string' || !who || who.length > 100)) throw new Refused('InvalidRequest', 'actor is a name, or human or agent');
      if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Refused('InvalidRequest', 'limit is a whole number from 1 to 500');
      let after = () => true;
      if (since !== undefined) {
        if (Number.isSafeInteger(since) || (typeof since === 'string' && /^\d+$/.test(since))) after = line => line.seq > Number(since);
        else {
          const from = typeof since === 'string' && /^\d{4}-\d{2}-\d{2}/.test(since) ? Date.parse(DAY.test(since) ? `${since}T00:00:00.000Z` : since) : NaN;
          if (!Number.isFinite(from)) throw new Refused('InvalidRequest', 'since is a seq, or a date such as 2026-11-19, or a time');
          const start = new Date(from).toISOString();
          after = line => line.at >= start;
        }
      }
      const by = line => who === undefined || line.actor?.name === who || line.actor?.kind === who;
      const lines = (await journal.read()).filter(line => after(line) && by(line));
      const on = line => node === undefined || (node.endsWith('/') ? String(line.node).startsWith(node) : line.node === node);
      const changes = lines.filter(line => line.type === 'change' && on(line)).map(({ type, ...line }) => line);
      const saves = lines.filter(line => line.type === 'save').map(({ type, ...line }) => line);
      return { changes: changes.slice(-limit), saves, ...(changes.length > limit ? { more: changes.length - limit } : {}) };
    },

    // A node as it was at a point, read back from the journal and the kept versions. Nothing changes.
    async asOf({ node, at: when } = {}) {
      const spec = nodeOf(node);
      const lines = await journal.read();
      const point = pointOf(when, lines);
      const changes = lines.filter(line => line.type === 'change' && line.node === node);
      const upto = changes.filter(point.holds);
      const later = changes.filter(line => !point.holds(line));
      // The version then is what the last change up to that point left. With no change before it, it
      // is what the first change after it found, or, with no change at all, the version now.
      const live = await spec.live();
      const version = upto.length ? upto.at(-1).after : later.length ? later[0].before : live?.version ?? null;
      const answer = { node, as: point.said, ...(upto.length ? { change: upto.at(-1).seq } : {}) };
      if (version === null) return { ...answer, exists: false };
      const content = await contentAt(spec, version, lines);
      if (content === null) return { ...answer, version, kept: false };
      return { ...answer, version, ...(typeof content === 'string' ? { text: content } : { content }) };
    },

    // Names this point in the journal, so the cortex can be read as it was here. It changes nothing.
    async save({ name, note } = {}) {
      if (typeof name !== 'string' || name.length > 100 || !SAVE_NAME.test(name) || /^\d+$/.test(name) || /^\d{4}-\d{2}-\d{2}/.test(name)) throw new Refused('InvalidRequest', 'A save\'s name is lowercase letters and digits joined by hyphens, at most 100 characters, and not a number or a date');
      if (!oneLine(note)) throw new Refused('InvalidRequest', 'A save has a note: one line, at most 500 characters');
      if ((await journal.read()).some(line => line.type === 'save' && line.name === name)) throw new Refused('NameTaken', `There is already a save named ${name}`);
      const line = await journal.append(actor, 'save', { name, note: note.trim() });
      return { name, seq: line.seq, at: line.at };
    },

    // Brings a node back to an earlier version, as a new change: what it replaces is kept, and no
    // line of the journal is rewritten. The profile, the playbook, skills and tools are restored only
    // by the person; an agent restores only its own observations. `replaces`, when given, is the
    // version read now, and the restore is refused if it changed.
    async restore({ node, version, replaces, reason, extra = {} } = {}) {
      const spec = nodeOf(node);
      if (typeof version !== 'string' || !version) throw new Refused('InvalidRequest', 'Name the version to bring back');
      if (!person && spec.personOnly) throw new Refused('PersonOnly', `Only the person restores ${node}. Ask them to run: cortex restore ${node} ${version}`);
      await mayWrite(spec, 'restores');
      const why = checkReason(reason);
      const live = await spec.live();
      if (replaces !== undefined && (live?.version ?? null) !== (replaces ?? null)) throw changed(node, live?.version ?? null);
      if (live?.version === version) return { node, version, unchanged: true };
      const content = await contentAt(spec, version);
      if (content === null) throw new Refused('NotFound', `No version ${version} of ${node} is kept`);
      const done = await edit(spec, 'restore', content, { before: live?.version ?? null, reason: why ?? `restored ${version}`, extra: { restores: version, ...extra } });
      return { ...done, restored: version };
    },

    // Undoes one change, as a new change: the node goes back to what it was before that change. It
    // is refused once the node has changed again since; restore a version instead.
    async revert({ change, reason } = {}) {
      if ((typeof change !== 'string' || !change) && !Number.isSafeInteger(change)) throw new Refused('InvalidRequest', 'Name the change by its seq or ID');
      const lines = await journal.read();
      const target = lines.find(line => line.type === 'change' && (line.id === change || String(line.seq) === String(change)));
      if (!target) throw new Refused('NotFound', `There is no change ${change}`);
      const spec = nodeOf(target.node);
      if (!person && spec.personOnly) throw new Refused('PersonOnly', `Only the person reverts a change to ${target.node}. Ask them to run: cortex revert ${target.seq}`);
      await mayWrite(spec, 'reverts');
      const live = await spec.live();
      if ((live?.version ?? null) !== target.after) throw new Refused('Changed', `${target.node} has changed since change ${target.seq}. Restore a version instead`, { current: live?.version ?? null });
      const why = checkReason(reason) ?? `reverts change ${target.seq}`;
      if (target.before === null) {
        return { ...await edit(spec, 'remove', null, { before: live?.version ?? null, reason: why, extra: { reverts: target.id } }), reverted: target.id };
      }
      return { ...await cortex.restore({ node: target.node, version: target.before, reason: why, extra: { reverts: target.id } }), reverted: target.id };
    },

    // An agent records a task it finished, or gave up: one line of what was done, the changes it
    // made, grouped by their IDs, and the dead ends, each with what was tried, why it was dropped, and
    // a command that would show whether it still holds. Only agents write sessions.
    async recordSession(given = {}) {
      if (person) throw new Refused('InvalidRequest', 'A session is written by the agent that did the task');
      checkSession(given);
      const { summary, outcome = 'done', made = [], deadEnds = [], resolved = [], project, session } = given;
      const lines = await journal.read();
      for (const id of made) {
        const found = lines.find(line => line.type === 'change' && line.id === id);
        if (!found) throw new Refused('NotFound', `There is no change ${id}`);
        if (found.actor?.name !== actor) throw new Refused('InvalidRequest', `${id} was made by ${found.actor?.name}, not by you`);
      }
      const open = new Set((await cortex.deadEnds()).map(item => item.id));
      for (const id of resolved) if (!open.has(id)) throw new Refused('NotFound', `There is no open dead end ${id}`);
      const ends = deadEnds.map(item => ({ id: `d${randomBytes(6).toString('hex')}`, tried: item.tried.trim(), why: item.why.trim(), ...(item.check ? { check: item.check.trim() } : {}) }));
      const line = await journal.append(actor, 'session', { summary: summary.trim(), outcome, made, deadEnds: ends, ...(resolved.length ? { resolved } : {}), ...(project ? { project: project.trim() } : {}) }, { session });
      return { id: line.id, seq: line.seq, deadEnds: ends.map(item => item.id) };
    },

    // Dead ends no later session resolved, newest first. With a project, only those near it.
    async deadEnds({ project, limit = 20 } = {}) {
      const sessions = (await journal.read()).filter(line => line.type === 'session' && Array.isArray(line.deadEnds));
      const resolved = new Set(sessions.flatMap(line => line.resolved ?? []));
      const open = sessions.flatMap(line => line.deadEnds.filter(item => !resolved.has(item.id)).map(item => ({ ...item, agent: line.actor?.name, at: line.at, ...(line.project ? { project: line.project } : {}) })));
      return open.filter(item => project === undefined || (item.project && near(item.project, project))).reverse().slice(0, limit);
    },

    // --- A session --------------------------------------------------------------------------------

    // What an agent is given at the start of a session. Starting brings the cortex in step with the
    // vault first, which can record what the vault reported as observations.
    async start() {
      const vault = await cortex.syncVault().catch(problem => {
        if (!(problem instanceof Refused)) throw problem;
        return { connected: true, reachable: false, problem: problem.message };
      });
      return cortex.inspect(vault);
    },

    // A read-only view for the person and for status. Unlike starting a session, it syncs nothing.
    async inspect(synced) {
      const { observations, problems } = await all();
      let vault = synced;
      if (!vault) {
        try {
          const connected = await theVault();
          vault = connected ? await vaultView(connected, observations) : { connected: false };
        } catch (problem) {
          vault = { connected: true, reachable: false, problem: problem.message };
        }
      }
      // A profile that cannot be read is reported, so a session or status still answers.
      let profile;
      try { profile = await readProfile(); } catch (problem) {
        if (!problem?.code) throw problem;
        profile = { account: null, text: '', unreadable: `profile.md cannot be read: ${problem.code}` };
      }
      const pinned = observations.filter(item => item.pin);
      const recent = observations.filter(item => !item.pin).slice(0, RECENT);
      const found = [...problems, ...(profile.unreadable ? [profile.unreadable] : profile.content === null ? ['There is no profile.md'] : []), ...(vault.problem ? [`vault: ${vault.problem}`] : []), ...(vault.problems ?? []).map(problem => `vault: ${problem}`)];
      return {
        rules: await cortex.rules(),
        profile: { account: profile.account, text: profile.text },
        vault: vault.connected && vault.reachable !== false
          ? { connected: true, channels: vault.channels, ...(vault.broken?.length ? { broken: vault.broken } : {}) }
          : { connected: vault.connected, ...(vault.reachable === false ? { reachable: false } : {}) },
        // Pinned first, then the newest. cortex_recall finds the rest.
        observations: [...pinned, ...recent],
        ...(observations.length > pinned.length + recent.length ? { moreObservations: observations.length - pinned.length - recent.length } : {}),
        // Only what the person has approved or switched on is handed over as usable.
        skills: (await skillsIn(at('skills'))).map(({ name, description }) => ({ name, description })),
        tools: (await toolsIn(at('tools'))).filter(tool => tool.on).map(({ name, description }) => ({ name, description })),
        // What only the person can settle: profile lines to accept, skills to approve, tools asked for.
        waiting: {
          profile: (await cortex.profileProposals()).map(({ id, heading, line, by }) => ({ id, heading, line, by })),
          skills: (await skillsIn(at('.cortex', 'proposed', 'skills'))).map(skill => skill.name),
          tools: (await toolsIn(at('.cortex', 'proposed', 'tools'))).map(tool => tool.name),
        },
        deadEnds: await cortex.deadEnds(),
        ...(found.length ? { problems: found } : {}),
      };
    },

    // The playbook, as the person keeps it, their own rules included.
    rules: async () => (await text(at('agents', 'AGENTS.md'))) ?? '',
    // The vault this cortex reads, or null. For operations that only read it, such as filing advice.
    connectedVault: () => theVault(),

    // --- The vault --------------------------------------------------------------------------------

    // The person names the vault this cortex reads. It is opened and read once to check it answers.
    async connectVault(config) {
      const vault = vaultFrom(config);
      await vault.shape();
      await put(at('.cortex', 'vault.json'), `${JSON.stringify(config, null, 2)}\n`);
      await rm(at('.cortex', 'vault-cursor.json'), { force: true });
      openedVault = vault;
      return cortex.syncVault();
    },

    // Brings the cortex in step with the vault. When a block an observation is about moves or goes,
    // that is written down as an observation of the vault's, once, so the next agent sees it.
    async syncVault() {
      const vault = await theVault();
      if (!vault) return { connected: false };
      const cursorPath = at('.cortex', 'vault-cursor.json');
      // A cursor that cannot be read, say after a merge, is started again: the vault is read afresh
      // and nothing that happened before is reported.
      let before = null;
      try { before = JSON.parse(await text(cursorPath) ?? 'null'); } catch {}
      const { changes, cursor } = await vault.changes(before);
      const { observations } = await all();
      const pointing = id => observations.filter(item => item.about?.includes(id)).map(item => item.id);
      const observed = [];
      const note = async (key, said) => {
        const id = `vault-${short(key)}`;
        if (await heldObservation(id)) return;
        const spec = nodeOf(`observation/${id}`);
        await apply(spec, observationFile({ text: said, by: 'vault', at: now().toISOString(), session: 'vault' }));
        const line = await journal.append(actor, 'change', { node: spec.node, op: 'create', before: null, after: (await spec.live()).version, reason: 'reported by the vault' });
        observed.push({ id, change: line.id });
      };
      for (const change of changes) {
        const ids = pointing(change.id);
        if (change.type === 'removed' && ids.length) await note([change.type, change.id], `Block "${change.title}" (${change.id}) was removed from ${change.channel}. These observations were about it: ${ids.join(', ')}`);
        if (change.type === 'moved' && ids.length) await note([change.type, change.id, change.channel], `Block "${change.title}" (${change.id}) moved from ${change.from} to ${change.channel}. These observations are about it: ${ids.join(', ')}`);
      }
      if (JSON.stringify(before) !== JSON.stringify(cursor)) await put(cursorPath, JSON.stringify(cursor));
      const view = await vaultView(vault, (await all()).observations);
      return { ...view, changes: changes.length, observed: observed.map(item => item.id) };
    },

    // What has been observed about each channel, as one text per channel, for filing advice.
    async channelNotes() {
      const notes = new Map();
      for (const item of (await all()).observations) {
        for (const each of item.about ?? []) {
          if (!each.startsWith(CHANNEL)) continue;
          const channel = each.slice(CHANNEL.length);
          notes.set(channel, [notes.get(channel), item.text].filter(Boolean).join(' '));
        }
      }
      return notes;
    },

    // --- The profile ------------------------------------------------------------------------------

    // The account it belongs to, and the person's own words: their preferences, goals and notes.
    async profile() {
      const { account, text: said, sections, version } = await readProfile();
      return { account, text: said, sections, version };
    },

    // The account is what the signed-in account says it is. Only the person, or the account, sets it.
    async setAccount(value) {
      onlyPerson('sets the account');
      const checked = checkAccount(value);
      const spec = nodeOf('profile');
      const held = await readProfile();
      const body = held.content === null ? `\n${HEADINGS.map(heading => `## ${heading}\n`).join('\n')}` : splitFront(held.content).body;
      const properties = held.content === null ? {} : splitFront(held.content).properties;
      if (properties.account === checked) return { account: checked, unchanged: true };
      const done = await edit(spec, held.content === null ? 'create' : 'update', writeFront({ ...properties, account: checked }, body.startsWith('\n') ? body : `\n${body}`), { before: held.version, reason: 'account set' });
      return { account: checked, ...done };
    },

    // The person rewrites their part of the profile, whole, as the app's editor does. The account
    // stays as it is. `replaces` is the version read; the write is refused if it changed.
    async writeProfile(said, { replaces } = {}) {
      onlyPerson('writes the profile');
      if (typeof said !== 'string' || bytes(said) > 16384) throw new Refused('InvalidRequest', 'The profile is Markdown, at most 16 KB');
      const held = await readProfile();
      if (replaces !== undefined && (held.version ?? null) !== (replaces ?? null)) throw changed('profile', held.version);
      const properties = held.content === null ? {} : splitFront(held.content).properties;
      const content = writeFront(properties, `\n${said.trim()}\n`);
      if (content === held.content) return { version: held.version, unchanged: true };
      return edit(nodeOf('profile'), held.content === null ? 'create' : 'update', content, { before: held.version, reason: 'profile edited' });
    },

    // An agent proposes one line for the profile, under a heading such as Preferences or Goals,
    // usually because the person said it. Nothing changes until the person accepts it.
    async proposeProfile({ heading = 'Preferences', line, quote } = {}) {
      if (!oneLine(heading, 60)) throw new Refused('InvalidRequest', 'heading is one line, at most 60 characters, such as Preferences or Goals');
      if (!oneLine(line, 300)) throw new Refused('InvalidRequest', 'line is what to add, one line, at most 300 characters');
      if (quote !== undefined && !oneLine(quote, 500)) throw new Refused('InvalidRequest', 'quote is what the person said, one line, at most 500 characters');
      const { sections } = await readProfile();
      if (sections.some(section => same(section.heading) === same(heading) && section.lines.some(each => same(each) === same(line)))) return { heading, line, unchanged: true };
      const entries = await profileEntries();
      const key = entry => `${same(entry.heading)}\u0000${same(entry.line)}`;
      const asked = key({ heading, line });
      if (entries.some(entry => entry.type === 'declined' && key(entry) === asked)) throw new Refused('AlreadyDeclined', 'The person already turned this line down. Do not propose it again');
      const waiting = (await cortex.profileProposals()).find(entry => key(entry) === asked);
      if (waiting) return { id: waiting.id, heading, line, waiting: true, unchanged: true };
      const id = `p${(await cortexVersion({ heading: same(heading), line: same(line) })).slice(1, 13)}`;
      await recordProfile({ type: 'proposed', id, heading: heading.trim(), line: line.trim(), ...(quote ? { quote: quote.trim() } : {}) });
      return { id, heading: heading.trim(), line: line.trim(), waiting: true };
    },

    // Proposals no one has answered, oldest first.
    async profileProposals() {
      const waiting = new Map();
      for (const entry of await profileEntries()) {
        if (entry.type === 'proposed' && !waiting.has(entry.id)) waiting.set(entry.id, entry);
        else if (entry.type === 'accepted' || entry.type === 'declined') waiting.delete(entry.id);
      }
      return [...waiting.values()];
    },

    // The person's answer. Accepting adds the line under its heading, as the person's change.
    async acceptProfile(id) {
      onlyPerson('accepts a profile line');
      const proposal = (await cortex.profileProposals()).find(entry => entry.id === id);
      if (!proposal) throw new Refused('NotFound', `No profile line ${id} is waiting`);
      const held = await readProfile();
      const { properties, body } = held.content === null ? { properties: {}, body: '' } : splitFront(held.content);
      const content = writeFront(properties, `\n${withLine(body.trim(), proposal.heading, proposal.line).trimStart()}`);
      const done = await edit(nodeOf('profile'), held.content === null ? 'create' : 'update', content, { before: held.version, reason: `accepted: ${proposal.line}`, extra: { proposedBy: proposal.by } });
      await recordProfile({ type: 'accepted', id, heading: proposal.heading, line: proposal.line });
      return { id, heading: proposal.heading, line: proposal.line, accepted: true, ...done };
    },

    async declineProfile(id) {
      onlyPerson('declines a profile line');
      const proposal = (await cortex.profileProposals()).find(entry => entry.id === id);
      if (!proposal) throw new Refused('NotFound', `No profile line ${id} is waiting`);
      await recordProfile({ type: 'declined', id, heading: proposal.heading, line: proposal.line });
      return { id, declined: true };
    },

    // --- Observations -----------------------------------------------------------------------------

    // Writes one observation: a new one, or a rewrite of one given with the version read. The person
    // writes any; an agent writes new ones, and rewrites only its own as it left them. Only the
    // person pins one, so every session is handed it.
    async observe({ id, text: said, about, session, pin, needs, settles, replaces, reason } = {}) {
      checkObservationId(id);
      if (typeof said !== 'string' || !said.trim() || [...said].length > 2000) throw new Refused('InvalidRequest', 'An observation is what was seen, at most 2,000 characters');
      if (session !== undefined && !oneLine(session, 200)) throw new Refused('InvalidRequest', 'session is one line, at most 200 characters');
      if (pin !== undefined && typeof pin !== 'boolean') throw new Refused('InvalidRequest', 'pin is true or false');
      if (pin !== undefined && !person) throw new Refused('PersonOnly', 'Only the person pins an observation');
      // needs: null withdraws a flag when its author rewrites it.
      if (needs !== undefined && needs !== null && !NEEDS.includes(needs)) throw new Refused('InvalidRequest', `needs is ${NEEDS.join(' or ')}, or null to withdraw a flag`);
      const held = await heldObservation(id);
      let settled;
      if (settles !== undefined) {
        if (!Array.isArray(settles) || settles.length > 20 || new Set(settles).size !== settles.length || settles.includes(id)) throw new Refused('InvalidRequest', 'settles is up to 20 distinct IDs of other observations');
        // A flag this observation already settles keeps the version it answered, even if it has
        // since been removed, so a retry or a rewrite of the answer still works.
        const already = new Map((held?.observation.settled ?? []).map(item => [item.id, item.version]));
        settled = [];
        for (const flag of settles) {
          checkObservationId(flag);
          if (already.has(flag)) { settled.push({ id: flag, version: already.get(flag) }); continue; }
          const target = await heldObservation(flag);
          if (!target?.observation.needs) throw new Refused('NotFound', `There is no observation ${flag} waiting to be settled`);
          if (!person && target.observation.by === authorOf(actor)) throw new Refused('PersonOnly', `${flag} was raised under your own name, so the person settles it: ask them, and they run cortex observe with --settles ${flag}`);
          settled.push({ id: flag, version: target.version });
        }
      }
      const why = checkReason(reason);
      const checked = await checkAbout(about);
      const spec = nodeOf(`observation/${id}`);
      if (held) {
        const { settles: _ids, settled: wasSettled, needs: wasNeeds, ...was } = held.observation;
        const keptNeeds = needs === undefined ? wasNeeds : needs ?? undefined;
        const next = { ...was, text: said, ...(about !== undefined ? { about: checked } : {}), ...(pin !== undefined ? { pin } : {}),
          ...(keptNeeds ? { needs: keptNeeds } : {}), settled: settled ?? wasSettled };
        const content = observationFile(next);
        if (replaces === undefined) {
          // A retry of the same observation is not a second one.
          if (content === held.content) return { id, version: held.version, unchanged: true };
          throw new Refused('NameTaken', 'An observation already has this ID. Read it and pass its version to rewrite it, or make a new ID', { id, current: held.version });
        }
        if (replaces !== held.version) throw changed(`observation ${id}`, held.version);
        if (content === held.content) return { id, version: held.version, unchanged: true };
        return { id, ...await edit(spec, 'update', content, { before: held.version, reason: why, session }) };
      }
      if (replaces !== undefined && replaces !== null) throw changed(`observation ${id}`, null);
      const content = observationFile({ text: said, by: authorOf(actor), at: now().toISOString(), session, about: checked, pin, needs: needs ?? undefined, settled });
      return { id, ...await edit(spec, 'create', content, { reason: why, session }) };
    },

    // Removes one, with the version read. What it removes is kept, and can be restored.
    async removeObservation(id, { replaces, reason } = {}) {
      checkObservationId(id);
      const held = await heldObservation(id);
      if (!held) return { id, removed: true, unchanged: true };
      if (replaces !== held.version) throw changed(`observation ${id}`, held.version);
      return { id, removed: true, ...await edit(nodeOf(`observation/${id}`), 'remove', null, { before: held.version, reason: checkReason(reason) }) };
    },

    // One observation, now or at an earlier version, with its earlier versions when asked.
    async readObservation(id, { version, history = false } = {}) {
      checkObservationId(id);
      const held = await heldObservation(id);
      const versions = history || (version !== undefined && held?.version !== version) ? await earlier('observations', id) : [];
      if (held && (version === undefined || held.version === version)) {
        return { observation: held.observation, version: held.version, ...(history ? { earlier: versions.map(({ version: v, replacedAt }) => ({ version: v, replacedAt })) } : {}) };
      }
      const kept = version !== undefined && versions.find(item => item.version === version);
      if (!kept) throw new Refused('NotFound', `There is no observation ${id}${version ? ` at ${version}` : ''}`);
      const content = await readFile(at('.cortex', 'history', 'observations', id, kept.file), 'utf8');
      return { observation: readObservationFile(id, content), version, ...(history ? { earlier: versions.map(({ version: v, replacedAt }) => ({ version: v, replacedAt })) } : {}) };
    },

    // Observations, newest first: all of them, those about something (a block ID or channel:<path>),
    // or those whose words match. Words in the text count, and so do the IDs and channels it is about.
    // With needs, only the flags waiting for that agent: marked needs, and not settled at their
    // current version by the person or by an agent other than the flag's author.
    async observations({ q, about, by, needs, limit = 50 } = {}) {
      if (needs !== undefined && !NEEDS.includes(needs)) throw new Refused('InvalidRequest', `needs is ${NEEDS.join(' or ')}`);
      if (q !== undefined && (typeof q !== 'string' || !q.trim() || q.length > 2000)) throw new Refused('InvalidRequest', 'q is one or more words, at most 2,000 characters');
      if (about !== undefined && (typeof about !== 'string' || !about.trim())) throw new Refused('InvalidRequest', 'about is a block ID, or a channel written channel:<path>');
      if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Refused('InvalidRequest', 'limit is a whole number from 1 to 500');
      let { observations: found } = await all();
      const flags = new Map(found.filter(item => item.needs).map(item => [item.id, item]));
      const settled = new Set(found.flatMap(answer => (answer.settled ?? []).filter(({ id: flag, version }) => {
        const target = flags.get(flag);
        return target && target.version === version && (answer.by === 'you' || answer.by !== target.by);
      }).map(item => item.id)));
      if (about !== undefined) found = found.filter(item => item.about?.includes(about));
      if (by !== undefined) found = found.filter(item => item.by === by);
      if (needs !== undefined) found = found.filter(item => item.needs === needs && !settled.has(item.id));
      if (q !== undefined) {
        const words = [...new Set(q.toLowerCase().split(/\s+/).filter(Boolean))].slice(0, 12);
        const count = (within, word) => within.toLowerCase().split(word).length - 1;
        found = found.map(item => ({ item, scores: words.map(word => count(item.text, word) + 3 * count((item.about ?? []).join(' '), word)) }))
          .filter(({ scores }) => scores.every(Boolean))
          .sort((a, b) => b.scores.reduce((s, x) => s + x, 0) - a.scores.reduce((s, x) => s + x, 0))
          .map(({ item }) => item);
      }
      return { observations: found.slice(0, limit), ...(found.length > limit ? { more: found.length - limit } : {}) };
    },

    // --- Skills and tools -------------------------------------------------------------------------

    listSkills: () => skillsIn(at('skills')),

    async getSkill(name) {
      const found = await skillAt(at('skills', known(name, 'skill')));
      if (found) return { skill: found.skill, version: found.version };
      if (await skillAt(at('.cortex', 'proposed', 'skills', name))) throw new Refused('SkillNotApproved', 'This skill is waiting for the person to approve it, and is not used before');
      throw new Refused('NotFound', 'There is no such skill');
    },

    // A skill, whole: SKILL.md and the files beside it. It is kept apart from skills/, so nothing
    // reads it as a skill until the person approves it. It changes no node, so it is not a change.
    async proposeSkill({ text: content, files = [] } = {}) {
      const { properties, found } = splitFront(typeof content === 'string' ? content : '');
      if (!found || typeof properties.name !== 'string' || !NAME.test(properties.name) || properties.name.length > 100) throw new Refused('InvalidSkill', 'SKILL.md starts with a lowercase, hyphenated name between --- lines');
      if (typeof properties.description !== 'string' || !properties.description.trim()) throw new Refused('InvalidSkill', 'SKILL.md needs a one-line description');
      if (bytes(content) > 65536 || !Array.isArray(files) || files.length > 20) throw new Refused('InvalidSkill', 'A skill is at most 64 KB, with at most 20 files beside it');
      for (const file of files) {
        const path = typeof file?.path === 'string' ? normalize(file.path) : '';
        if (!path || path.startsWith('..') || path.startsWith(sep) || path.split(sep).some(part => part.startsWith('.')) || path === 'SKILL.md' || typeof file.text !== 'string' || bytes(file.text) > 65536) throw new Refused('InvalidSkill', 'Each file beside a skill has a path inside its folder and text of at most 64 KB');
      }
      const root = at('.cortex', 'proposed', 'skills', properties.name);
      await rm(root, { recursive: true, force: true });
      await put(join(root, 'SKILL.md'), content);
      for (const file of files) await put(join(root, normalize(file.path)), file.text);
      await put(join(root, '.proposal.json'), JSON.stringify({ by: actor, when: now().toISOString() }));
      return { name: properties.name, version: (await skillAt(root)).version, approved: false };
    },

    // Only the person does this. The skill moves into skills/, whole; the one it replaces is kept,
    // and the change is the person's, naming the agent that proposed it.
    async approveSkill(name) {
      onlyPerson('approves a skill');
      const root = at('.cortex', 'proposed', 'skills', known(name, 'skill'));
      const proposed = await skillAt(root);
      if (!proposed) throw new Refused('NotFound', 'No skill of that name is waiting');
      let by;
      try { by = JSON.parse(await text(join(root, '.proposal.json')) ?? 'null')?.by; } catch {}
      const spec = nodeOf(`skill/${name}`);
      const live = await spec.live();
      if (live) await keep(...spec.kept, encode(spec, live.content), live.version);
      await rm(join(root, '.proposal.json'), { force: true });
      await rm(at('skills', name), { recursive: true, force: true });
      await mkdir(at('skills'), { recursive: true });
      await rename(root, at('skills', name));
      const after = (await spec.live()).version;
      const line = await journal.append(actor, 'change', { node: spec.node, op: live ? 'update' : 'create', before: live?.version ?? null, after, reason: 'approved', ...(typeof by === 'string' && by ? { proposedBy: by } : {}) });
      return { name, approved: true, version: after, change: line.id };
    },

    listTools: () => toolsIn(at('tools')),

    // A proposed tool does nothing and cannot be switched on. It is a request for one to be built,
    // kept in .cortex/proposed/tools/ until the person builds it and adds it to tools/.
    async proposeTool({ name, description, inputs, outputs } = {}) {
      known(name, 'tool');
      for (const [field, value] of Object.entries({ description, inputs, outputs })) {
        if (typeof value !== 'string' || !value.trim() || value.length > 2000) throw new Refused('InvalidRequest', `${field} is text, at most 2,000 characters`);
      }
      if (await text(at('tools', `${name}.md`)) !== null) throw new Refused('NameTaken', 'A tool already has this name');
      await put(at('.cortex', 'proposed', 'tools', `${name}.md`), writeFront({ name, description, on: false, proposedBy: actor }, `## Takes\n\n${inputs}\n\n## Gives\n\n${outputs}\n`));
      return { name, proposed: true };
    },

    // --- From before docs/model.md ---------------------------------------------------------------

    // Brings a cortex made before docs/model.md to the four parts, once, as the person's changes.
    // identity.md becomes profile.md, each memory and each observation waiting in the journal
    // becomes an observation, what vault.md said about a channel becomes an observation about it,
    // and working memory goes. Everything it replaces or removes is kept in .cortex/history/.
    async migrate() {
      onlyPerson('migrates the cortex');
      const done = { profile: false, observations: [], proposals: [], removed: [] };
      const write = async (id, fields) => {
        if (await heldObservation(id)) return;
        await edit(nodeOf(`observation/${id}`), 'create', observationFile(fields), { reason: 'migrated' });
        done.observations.push(id);
      };
      const remove = async (node, path) => {
        const spec = { ...fileNode(node, path, node === 'identity' ? ['identity', 'identity'] : node.split('/')), personOnly: false };
        const live = await spec.live();
        if (!live) return;
        await edit(spec, 'remove', null, { before: live.version, reason: 'migrated to docs/model.md' });
        done.removed.push(node);
      };
      const when = now().toISOString();
      const slugId = value => String(value).replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120) || randomBytes(6).toString('hex');

      // identity.md: the account stays the account; every other field is a line under Notes.
      const identity = await text(at('identity.md'));
      if (identity !== null) {
        const { properties, body } = splitFront(identity);
        const held = await readProfile();
        let profileBody = held.content === null ? HEADINGS.map(heading => `## ${heading}\n`).join('\n') : splitFront(held.content).body.trim();
        for (const [field, value] of Object.entries(properties)) {
          if (field === 'account' || value === undefined || value === null || value === '') continue;
          const shown = Array.isArray(value) ? value.map(item => (item && typeof item === 'object' ? item.address ?? JSON.stringify(item) : item)).join(', ') : String(value);
          profileBody = withLine(profileBody, 'Notes', `${field}: ${shown}`).trim();
        }
        const words = body.replace(/<!--[\s\S]*?-->/g, '').trim();
        if (words) profileBody = withLine(profileBody, 'Notes', words.replace(/\s+/g, ' ')).trim();
        const account = typeof properties.account === 'string' ? { account: properties.account } : {};
        const front = held.content === null ? account : { ...splitFront(held.content).properties, ...account };
        await edit(nodeOf('profile'), held.content === null ? 'create' : 'update', writeFront(front, `\n${profileBody}\n`), { before: held.version, reason: 'migrated from identity.md' });
        done.profile = true;
        await remove('identity', at('identity.md'));
      }

      // Memories: each one an observation; a preference the person stated is also offered for the profile.
      for (const entry of await names(at('memory'))) {
        if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
        const name = entry.name.slice(0, -3);
        if (entry.name === 'MEMORY.md') { await rm(at('memory', entry.name), { force: true }); continue; }
        const content = await text(at('memory', entry.name));
        const { properties, body } = splitFront(content ?? '');
        const description = typeof properties.description === 'string' ? properties.description.trim() : '';
        const said = [description, body.trim()].filter(Boolean).join('\n\n') || name;
        const blocks = Array.isArray(properties.blocks) ? properties.blocks.filter(item => typeof item === 'string').slice(0, 20) : [];
        const by = typeof properties.writtenBy === 'string' && !PEOPLE.includes(properties.writtenBy) ? properties.writtenBy : 'you';
        await write(`memory-${slugId(name)}`, { text: said.slice(0, 2000), by, at: when, about: blocks, pin: properties.always === true });
        if (properties.stated === true && properties.kind === 'preference' && description) {
          const proposed = await cortex.proposeProfile({ heading: 'Preferences', line: description.slice(0, 300) }).catch(() => null);
          if (proposed?.id) done.proposals.push(proposed.id);
        }
        await remove(`memory/${name}`, at('memory', entry.name));
      }

      // Observations waiting in the journal, never settled into a memory.
      const pending = new Map();
      for (const line of await journal.read()) {
        if (line.type === 'observation' && typeof line.observation === 'string' && !pending.has(line.observation)) pending.set(line.observation, line);
        else if (line.type === 'settled' && typeof line.observation === 'string') pending.delete(line.observation);
      }
      for (const [id, line] of pending) {
        if (typeof line.text !== 'string' || !line.text.trim()) continue;
        const by = line.actor?.kind === 'human' ? 'you' : line.source ?? line.actor?.name ?? 'agent';
        await write(slugId(id), { text: line.text.slice(0, 2000), by, at: line.at ?? when, ...(line.session ? { session: line.session } : {}) });
      }

      // vault.md: what each channel means and how blocks there are filed, as an observation about it.
      const map = await text(at('vault.md'));
      if (map !== null) {
        let channel = null;
        const words = new Map();
        for (const line of map.split(/\r?\n/)) {
          const heading = /^#{2,3} (.+)$/.exec(line);
          if (heading) { channel = heading[1].trim(); continue; }
          const field = /^(Meaning|Conventions):\s*(.+)$/.exec(line);
          if (channel && field) words.set(channel, [words.get(channel), `${field[1] === 'Meaning' ? 'Means' : 'Filed'}: ${field[2].trim()}`].filter(Boolean).join(' '));
        }
        for (const [path, said] of words) await write(`channel-${slugId(path)}`, { text: said.slice(0, 2000), by: 'you', at: when, about: [`${CHANNEL}${path}`] });
        await keep('vault-map', 'vault', map, short(map));
        await rm(at('vault.md'), { force: true });
        done.removed.push('vault.md');
      }

      // Working memory: kept in history, and gone.
      for (const entry of await names(at('.cortex', 'working'))) {
        if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
        await remove(`working/${entry.name.slice(0, -3)}`, at('.cortex', 'working', entry.name));
      }
      await mkdir(at('observations'), { recursive: true });
      return done;
    },
  };

  const all = allObservations;
  return cortex;
}
