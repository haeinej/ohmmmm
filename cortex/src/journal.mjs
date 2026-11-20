// The journal: one append-only file, .cortex/journal.jsonl, that says what happened in a cortex and
// who did it. This module is the only thing that writes it.
//
// Every line has `seq` (this cortex's count of lines, one more than the highest it has seen), `id`
// (unique, so lines from two machines joined by a union merge never clash), `at`, `actor`
// ({ kind: human or agent, name }), `session` when there is one, and `type`:
//
//   change    a node was created, updated, removed or restored, with its versions before and after,
//             and why. Whoever made it, the person or an agent, is its actor. Writing an observation
//             is a change to observation/<id>
//   session   an agent's record of a task it finished or gave up: what was done, the changes it
//             made, and the dead ends
//   save      a name and a note for this point in history, to read the cortex as it was here.
//             It changes nothing. Lines written as `stamp` before the name changed are read as saves.
//
// A journal from before docs/model.md may also hold `observation` and `settled` lines, from when
// observations waited in the journal to be settled into memories, and `proposal` and `decision`
// lines from when agents' edits waited for the person. They are still read and kept as history, and
// `cortex migrate` turns the observations no one settled into observation files. Nothing writes them now.
import { randomBytes } from 'node:crypto';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const TYPES = ['change', 'session', 'save'];
export const OPS = ['create', 'update', 'remove', 'restore'];
// Names that mean the person, or the signed-in account. Everyone else is an agent.
export const PEOPLE = ['member', 'account'];
export const actorOf = name => ({ kind: PEOPLE.includes(name) ? 'human' : 'agent', name });

export const journalPath = dir => join(dir, '.cortex', 'journal.jsonl');

// Lines from two machines joined by a union merge can share a seq. They are ordered by seq, then by
// when they were written, then by ID, so every reader puts them in the same order.
export const order = (a, b) => a.seq - b.seq || String(a.at).localeCompare(String(b.at)) || String(a.id).localeCompare(String(b.id));

export function openJournal(dir, { now = () => new Date() } = {}) {
  const path = journalPath(dir);
  const raw = () => readFile(path, 'utf8').catch(problem => { if (problem?.code === 'ENOENT') return ''; throw problem; });

  // Every line that can be read, in order. A line that cannot be read, say one cut short, is skipped.
  async function read() {
    const lines = [];
    for (const line of (await raw()).split('\n')) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        if (!entry || typeof entry !== 'object' || !Number.isSafeInteger(entry.seq) || typeof entry.type !== 'string') continue;
        // Older names, read as today's: a stamp is a save, a note an observation, and a settled or
        // decision line names the observation it settled as `note`.
        const named = entry.observation === undefined && typeof entry.note === 'string' && ['note', 'settled', 'decision'].includes(entry.type)
          ? (({ note, ...rest }) => ({ ...rest, observation: note }))(entry) : entry;
        if (named.type === 'stamp') lines.push({ ...named, type: 'save' });
        else if (named.type === 'note') lines.push({ ...named, type: 'observation' });
        else if (named.type === 'decision' && typeof named.observation === 'string') lines.push({ ...named, type: 'settled' });
        else lines.push(named);
      } catch {}
    }
    return lines.sort(order);
  }

  // Adds one line and returns it. `actor` is the name the cortex was opened with.
  async function append(actor, type, fields = {}, { session } = {}) {
    if (!TYPES.includes(type)) throw new Error(`The journal does not take ${type} lines`);
    let last = 0;
    for (const found of (await raw()).matchAll(/"seq":(\d+)/g)) last = Math.max(last, Number(found[1]));
    const entry = {
      seq: last + 1,
      id: `${Date.now().toString(36)}-${randomBytes(6).toString('hex')}`,
      at: now().toISOString(),
      actor: actorOf(actor),
      ...(typeof session === 'string' && session ? { session } : {}),
      type,
      ...fields,
    };
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, `${JSON.stringify(entry)}\n`);
    return entry;
  }

  return { path, read, append };
}
