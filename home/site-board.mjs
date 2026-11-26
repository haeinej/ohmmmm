// The canvas, kept in the person's home (docs/serve.md): every card on it, as `site/.ohm/board.json`, ohm's
// own and never tracked by git. The app shows it and saves it; a coding agent reads and changes it over
// MCP; each change is told to the open app, so both see the same canvas at once.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export const BOARD = '.ohm/board.json';
const KINDS = new Set(['block', 'channel', 'page', 'link', 'note', 'prompt', 'tool']);

/** `{ cards, arrows, rev }`: the cards, the arrows between them, and how many times the board has changed. */
export async function boardOf(dir) {
  let text;
  try { text = await readFile(join(dir, BOARD), 'utf8'); } catch (problem) {
    if (problem.code === 'ENOENT') return { cards: [], arrows: [], rev: 0 };
    throw problem;
  }
  // A board that is there but can't be read is never taken for an empty one: that would be saved over it.
  let b;
  try { b = JSON.parse(text); } catch { throw Object.assign(new Error(`${BOARD} can't be read; it was left as it is`), { status: 500 }); }
  return { cards: Array.isArray(b.cards) ? b.cards : [], arrows: Array.isArray(b.arrows) ? b.arrows : [], rev: b.rev ?? 0 };
}

// One change to a board at a time, in this process: each reads the board as the last one left it.
const queues = new Map();
const inTurn = (dir, work) => {
  const next = (queues.get(dir) ?? Promise.resolve()).then(work, work);
  queues.set(dir, next.catch(() => {}));
  return next;
};
/** An arrow from one card to another, with words on it if any. */
const arrow = a => a && typeof a === 'object' && typeof a.id === 'string' && typeof a.from === 'string' && typeof a.to === 'string'
  ? { id: a.id, from: a.from, to: a.to, ...(a.text ? { text: String(a.text).slice(0, 200) } : {}) } : null;

const clean = card => card && typeof card === 'object' && typeof card.id === 'string' && KINDS.has(card.kind)
  && Number.isFinite(card.x) && Number.isFinite(card.y) ? card : null;

/** Replace the board's cards. `by` says who (`app`, `agent:<name>`); the change is told to the open app. */
export function saveBoard(dir, cards, options = {}) { return inTurn(dir, () => writeBoard(dir, cards, options)); }

async function writeBoard(dir, cards, { by, live, arrows } = {}) {
  const now = await boardOf(dir);
  const kept = (Array.isArray(cards) ? cards : []).map(clean).filter(Boolean).slice(0, 2000);
  const ids = new Set(kept.map(c => c.id));
  // Arrows are kept unless new ones are given; an arrow whose card is gone goes with it.
  const lines = (Array.isArray(arrows) ? arrows : now.arrows).map(arrow).filter(a => a && ids.has(a.from) && ids.has(a.to));
  const next = { cards: kept, arrows: lines, rev: now.rev + 1 };
  await mkdir(join(dir, '.ohm'), { recursive: true });
  // Its own temporary file, so two writers never share one; renamed into place whole.
  const tmp = join(dir, `${BOARD}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`);
  await writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`);
  await rename(tmp, join(dir, BOARD));
  live?.announce({ type: 'board', rev: next.rev, by });
  return next;
}

/** Change the board by a function of its cards, as one change. */
export function changeBoard(dir, change, options) {
  return inTurn(dir, async () => { const { cards } = await boardOf(dir); return writeBoard(dir, change(cards), options); });
}

/** Change the arrows, as one change. */
export function changeArrows(dir, change, options) {
  return inTurn(dir, async () => { const { cards, arrows } = await boardOf(dir); return writeBoard(dir, cards, { ...options, arrows: change(arrows) }); });
}
