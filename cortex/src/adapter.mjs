// The hooks adapter: what `cortex hook <moment>` answers when Claude Code or Codex runs it at a fixed
// moment of a session. It reads the cortex folder directly and never waits on the network, so it
// answers fast whatever the model does. A hook must never break the session it runs in: whatever
// goes wrong, the command writes nothing and exits 0.
import { appendFile, mkdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { agentName, hooksLog, openCortex, RECENT } from './folder.mjs';
import { INSTRUCTIONS } from './tools.mjs';

export const MOMENTS = ['session-start', 'prompt', 'stop', 'session-end'];
// How much context one hook may hand the model, in characters.
// - Claude Code caps each additionalContext at 10,000 characters; beyond that it saves the text to a
//   file and shows the model a 2,000-character preview (code.claude.com/docs/en/hooks).
// - Codex limits each model-visible hook-output message to roughly 2,500 tokens by default; beyond
//   that it shows a head-and-tail preview (the Codex hooks docs, developers.openai.com/codex/hooks).
//   6,000 characters keeps well under 2,500 tokens for English and Markdown.
// Any other agent gets the smaller budget, since we do not know its limit.
export const BUDGETS = { 'claude-code': 9999, codex: 6000 };
export const budgetFor = agent => BUDGETS[same(agent)] ?? BUDGETS.codex;
export const ASK = 'Before you finish: did anything this session belong in the cortex for the next one? Record each with cortex_observe, about the blocks, channels or skills it concerns: a correction the person made (what you did, what they wanted instead); something you got wrong or could not find, or found out of date (a renamed field, a stale skill, a missing note); something they asked for again that could become a skill; a preference or fact about them or their vault. If nothing, just finish.';
// The stop hook first asks from this many turns on, so a one-question session is never asked.
export const ASK_AFTER = 2;
// After an ask, it asks again once this many more turns have passed with nothing recorded, so a long
// session's later corrections are not lost, at most ASK_MAX times a session.
export const ASK_EVERY = 8;
export const ASK_MAX = 4;
// What the prompt hook may add: a few older observations that match the prompt's words, which the
// session-start context did not already hold, each given once a session.
export const RECALL_LIMIT = 5;
export const RECALL_BUDGET = 2000;
const POINTER = 'The playbook (agents/AGENTS.md) is too long to include here. Call cortex_start now: it returns the playbook in full. Follow it.';

// Agents are matched by a plain form of their name, so `Codex` and `codex` agree.
const same = name => String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'agent';
const sessionOf = input => typeof input?.session_id === 'string' && input.session_id ? input.session_id.slice(0, 200) : null;
// Lengths and cuts count whole characters, so an emoji is never split in two.
export const chars = text => Array.from(text).length;

// A folder is a cortex when it holds the playbook. Anything else is broken, and the hook stays silent.
async function cortexAt(dir) {
  const found = await stat(join(dir, 'agents', 'AGENTS.md'));
  if (!found.isFile()) throw new Error(`${dir} is not a cortex`);
}

// The hooks' checkpoints: a session's start, each turn's end, and an ask, each { agent, session,
// started | stopped | asked }. They are this machine's bookkeeping for when to ask, not
// history, so they are kept in .cortex/hooks.jsonl, not the journal. A cortex made before kept them
// in .cortex/sessions.jsonl, which is still read, first.
async function sessions(dir) {
  const lines = [];
  for (const path of [join(dir, '.cortex', 'sessions.jsonl'), hooksLog(dir)]) {
    // A log that cannot be read, say one made a folder, is no checkpoints: the hook still answers.
    const content = await readFile(path, 'utf8').catch(() => '');
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      try { const entry = JSON.parse(line); if (entry && typeof entry === 'object') lines.push(entry); } catch {}
    }
  }
  return lines;
}
// .cortex/ may not exist, say after a git clone, since git keeps no empty folders.
async function record(dir, entry) {
  await mkdir(join(dir, '.cortex'), { recursive: true });
  await appendFile(hooksLog(dir), `${JSON.stringify(entry)}\n`);
}
const tryRecord = (dir, entry) => record(dir, entry).then(() => true, () => false);

// Cuts at the last line that fits, never inside a character.
function headCut(text, max) {
  if (chars(text) <= max) return text;
  const marker = '(Cut to fit. Call cortex_start for the rest.)';
  const kept = [];
  let used = chars(marker);
  for (const line of text.split('\n')) {
    const size = chars(line) + 1;
    if (used + size > max) break;
    kept.push(line);
    used += size;
  }
  if (!kept.length) return Array.from(marker).slice(0, max).join('');
  return [...kept, marker].join('\n');
}

// How one observation is shown to the model: one line to start, what it is about, who saw it, when.
const shown = item => `- ${item.text.replace(/\s+/g, ' ')}${item.about?.length ? ` (about ${item.about.join(', ')})` : ''} [${item.id}, ${item.by}${item.at ? `, ${item.at.slice(0, 10)}` : ''}]`;

// Words worth matching: letters and digits, lowercased; short Latin words and common ones are dropped.
const COMMON = new Set('the and for with that this from have what your you are was were will would should could can not but all any into about there their them then than when which while where who how why also just like make more some such only very please lets let use using want need'.split(' '));
export const promptWords = text => [...new Set((text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
  .filter(word => (/^[\p{Script=Latin}\p{N}]+$/u.test(word) ? word.length >= 4 : word.length >= 2) && !COMMON.has(word)))].slice(0, 24);

// Older observations that match the prompt: not pinned and not among the newest, since session start
// gave those, and not already given this session. Ranked by how many of the prompt's words they hold;
// at least two must match, or the one word of a short prompt.
export async function recall(dir, agent, prompt, given = new Set()) {
  const words = promptWords(prompt);
  if (!words.length) return [];
  const need = Math.min(2, words.length);
  const { observations } = await openCortex(dir, { actor: agent }).observations({ limit: 500 });
  const older = observations.filter(item => !item.pin).slice(RECENT).filter(item => !given.has(item.id));
  return older.map(item => {
    const within = `${item.text} ${(item.about ?? []).join(' ')}`.toLowerCase();
    return { item, score: words.filter(word => within.includes(word)).length };
  }).filter(({ score }) => score >= need).sort((a, b) => b.score - a.score).slice(0, RECALL_LIMIT).map(({ item }) => item);
}

// The context put in front of the model at session start, cut to fit the agent's budget: the
// playbook, the profile, the observations (pinned first, then the newest), and open dead ends near
// the project. To fit, the oldest observations go first, then the playbook becomes a pointer to
// cortex_start (and observations come back as they fit), then the end is cut.
export async function sessionContext(dir, agent, budget = budgetFor(agent), { project } = {}) {
  const cortex = openCortex(dir, { actor: agent });
  // Dead ends recorded near the folder this session works in, so the agent does not try them again.
  const ends = project ? await cortex.deadEnds({ project, limit: 10 }).catch(() => []) : [];
  const endsText = ends.map(item => `- ${item.tried}: ${item.why}${item.check ? ` (check: ${item.check})` : ''} [${item.id}, ${item.agent}, ${item.at.slice(0, 10)}]`).join('\n');
  const profile = await cortex.profile();
  const { observations } = await cortex.observations({ limit: 500 });
  const pinned = observations.filter(item => item.pin);
  const recent = observations.filter(item => !item.pin).slice(0, RECENT);
  const playbook = (await cortex.rules()).trim();

  const build = ({ full = true, count = recent.length }) => [
    '# Your cortex',
    INSTRUCTIONS,
    'This was read from the cortex folder as the session started. cortex_start gives the rest, such as the vault, skills and tools; cortex_recall finds older observations.',
    '## The playbook (agents/AGENTS.md)',
    full ? playbook : POINTER,
    '## Their profile',
    `Account: ${profile.account ?? '(not set)'}`,
    profile.text || '(nothing written yet)',
    '## Observations',
    [...pinned, ...recent.slice(0, count)].map(shown).join('\n') || '(none yet)',
    ...(endsText ? ['## Dead ends near this project', endsText] : []),
  ].join('\n\n');
  const fits = text => chars(text) <= budget;
  for (const full of [true, false]) {
    for (let count = recent.length; count >= 0; count--) {
      const text = build({ full, count });
      if (fits(text)) return text;
    }
  }
  return headCut(build({ full: false, count: 0 }), budget);
}

// Answers one moment. Returns what to write to standard output, which may be nothing, and what to
// record once it has been written. A record that fails never takes the answer with it.
export async function hook(moment, { dir, agent: given, input = {}, now = () => new Date() }) {
  if (!MOMENTS.includes(moment)) throw new Error(`No moment ${moment}`);
  await cortexAt(dir);
  const agent = agentName(given);
  const who = same(agent);
  const session = sessionOf(input);
  const ours = (await sessions(dir)).filter(entry => same(entry.agent) === who && (entry.session ?? null) === session);

  if (moment === 'session-start') {
    const context = await sessionContext(dir, agent, budgetFor(agent), { project: typeof input.cwd === 'string' ? input.cwd : undefined });
    const output = JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context } });
    // A resume or a compaction fires again for the same session; its start is the first one.
    const after = async () => {
      if (session && ours.some(entry => typeof entry.started === 'string')) return;
      await tryRecord(dir, { agent, session, started: now().toISOString() });
    };
    return { output, after };
  }

  if (moment === 'prompt') {
    const prompt = typeof input.prompt === 'string' ? input.prompt : '';
    const given = new Set(ours.flatMap(entry => Array.isArray(entry.recalled) ? entry.recalled : []));
    const found = await recall(dir, agent, prompt, given);
    if (!found.length) return { output: '' };
    const context = headCut(['# From your cortex: older observations that match this prompt', ...found.map(shown)].join('\n'), RECALL_BUDGET);
    const output = JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: context } });
    return { output, after: () => tryRecord(dir, { agent, session, recalled: found.map(item => item.id) }) };
  }

  if (moment === 'stop') {
    // stop_hook_active: the client is already continuing because a stop hook asked.
    if (input.stop_hook_active === true) return { output: '' };
    if (!(await tryRecord(dir, { agent, session, stopped: now().toISOString() }))) return { output: '' };
    const asks = ours.filter(entry => typeof entry.asked === 'string');
    if (asks.length >= ASK_MAX) return { output: '' };
    // Turns since the last ask, or since the session started; this one counts.
    const last = ours.findLastIndex(entry => typeof entry.asked === 'string');
    const turns = ours.slice(last + 1).filter(entry => typeof entry.stopped === 'string').length + 1;
    if (turns < (asks.length ? ASK_EVERY : ASK_AFTER)) return { output: '' };
    // An agent that recorded an observation since then has done what the ask is for.
    const since = asks.at(-1)?.asked ?? ours.find(entry => typeof entry.started === 'string')?.started;
    if (since) {
      const { observations } = await openCortex(dir, { actor: agent }).observations({ by: agent, limit: 1 });
      if (observations.some(item => item.at && item.at >= since)) return { output: '' };
    }
    if (!(await tryRecord(dir, { agent, session, asked: now().toISOString() }))) return { output: '' };
    return { output: JSON.stringify({ decision: 'block', reason: ASK }) };
  }

  // session-end records nothing: the agent's turn is over, so it cannot be asked.
  return { output: '' };
}

// Reads the hook's JSON from standard input, without waiting forever for a client that never
// closes it.
export function readInput(stream, { wait = 1000 } = {}) {
  return new Promise(resolve => {
    const chunks = [];
    const done = () => { clearTimeout(timer); stream.removeAllListeners('data'); stream.pause(); resolve(Buffer.concat(chunks).toString('utf8')); };
    const timer = setTimeout(done, wait);
    stream.on('data', chunk => chunks.push(chunk));
    stream.on('end', done);
    stream.on('error', done);
  });
}

// The whole command: never throws, never fails the session.
export async function runHook(moment, { dir, agent, stdin, stdout }) {
  try {
    // A client that closes the pipe early never sees a stack trace.
    stdout.on('error', () => {});
    // A prompt must not wait long on a client that keeps standard input open.
    const raw = await readInput(stdin, moment === 'prompt' ? { wait: 300 } : undefined);
    const input = raw.trim() ? JSON.parse(raw) : {};
    if (!input || typeof input !== 'object' || Array.isArray(input)) return;
    const { output, after } = await hook(moment, { dir, agent, input });
    if (output) await new Promise(resolve => stdout.write(`${output}\n`, () => resolve()));
    if (after) await after().catch(() => {});
  } catch {
    // Nothing is written. The session goes on as if there were no hook.
  }
}

export const SNIPPETS = {
  'claude-code': { file: 'claude-code.json', where: 'Add to the "hooks" of .claude/settings.json (a project) or ~/.claude/settings.json (every session).' },
  codex: { file: 'codex.toml', where: 'Add to ~/.codex/config.toml, or to .codex/config.toml in a trusted project, then review the hooks with /hooks.' },
};
