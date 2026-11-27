// A prompt card, run (docs/serve.md): Send on a prompt card on the canvas starts Claude Code in the person's
// ohm home, with what the card asks and what its arrows point at. It works there with its own file tools
// and ohm's MCP (the ohm plugin), but runs no terminal commands; its answer lands under the card. Nothing is
// committed or published: that stays the person's. One run per card at a time; Stop ends it.
import { spawn } from 'node:child_process';
import { dirname } from 'node:path';
import { boardOf, changeBoard } from './site-board.mjs';

const ANSWER = 4000;
const tail = (text, n) => (text.length > n ? `…${text.slice(-n)}` : text);

/** What a prompt points at, by its arrows (either way), said plainly for the agent. */
function aboutOf(board, id) {
  return board.arrows.filter(a => a.from === id || a.to === id)
    .map(a => board.cards.find(c => c.id === (a.from === id ? a.to : a.from)))
    .filter(Boolean)
    .map(c => c.kind === 'block' || c.kind === 'page' ? `- the ${c.kind} ${c.path}`
      : c.kind === 'channel' ? `- the channel ${c.name}`
      : c.kind === 'link' ? `- the link ${c.link?.url}`
      : c.kind === 'tool' ? `- the tool ${c.name} (tools/${c.name}/)`
      : c.kind === 'note' ? `- a note: ${String(c.text ?? '').slice(0, 400)}`
      : `- a ${c.kind} card (${c.id})`);
}

/**
 * Runs for one site. `command` is how Claude Code is started: `claude` (or OHM_CLAUDE), or an array of a
 * program and its first arguments, for tests.
 */
export function promptRuns({ dir, live, command = process.env.OHM_CLAUDE || 'claude' }) {
  const running = new Map(); // card id → child process
  const [program, ...first] = Array.isArray(command) ? command : [command];

  const set = (id, change) => changeBoard(dir, cards => cards.map(c => (c.id === id && c.kind === 'prompt' ? { ...c, ...change } : c)), { by: 'agent:claude-code', live });

  return {
    running: id => running.has(id),
    /** Start Claude Code on a prompt card. Resolves once it has started; the card follows the run. */
    async run(id) {
      if (running.has(id)) throw Object.assign(new Error('Claude Code is already working on this prompt'), { status: 409 });
      const board = await boardOf(dir);
      const card = board.cards.find(c => c.id === id && c.kind === 'prompt');
      if (!card) throw Object.assign(new Error('No such prompt on the canvas'), { status: 404 });
      if (!String(card.text ?? '').trim()) throw Object.assign(new Error('The prompt is empty'), { status: 400 });
      const about = aboutOf(board, id);
      const prompt = [
        `This comes from a prompt card on the person's ohm canvas (card ${id}).`,
        '',
        String(card.text).trim(),
        ...(about.length ? ['', 'It points at:', ...about] : []),
        '',
        'You are in their ohm home: site/ is their website (a git checkout), tools/ their tools. Work with your file tools and the ohm-site tools; do not commit, push or publish. When you are done, reply with a short summary of what you did, for the person: it is shown under their card.',
      ].join('\n');
      const child = spawn(program, [...first, '-p', prompt, '--permission-mode', 'acceptEdits', '--disallowedTools', 'Bash', '--allowedTools', 'mcp__plugin_ohm_ohm-site__*'], { cwd: dirname(dir), stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
      running.set(id, child);
      let out = '', err = '', stopped = false;
      child.stdout.on('data', d => { out += d; });
      child.stderr.on('data', d => { err += d; });
      child.stopping = () => { stopped = true; child.kill('SIGTERM'); };
      // Listened to at once: a Claude Code that can't start says so before anything else happens.
      let settled = false;
      let finished;
      const finish = change => { if (settled) return finished; settled = true; running.delete(id); finished = (async () => { await started; await set(id, change).catch(() => {}); })(); return finished; };
      let started;
      const done = new Promise(resolve => {
        child.on('error', async problem => {
          await finish({ status: 'declined', answer: problem.code === 'ENOENT' ? 'Claude Code isn\'t installed where ohm serve can find it.' : `Claude Code couldn't start: ${problem.message}` });
          resolve();
        });
        child.on('close', async code => {
          const answer = stopped ? 'Stopped.' : code === 0 ? tail(out.trim() || 'Done.', ANSWER) : tail((err.trim() || out.trim() || `Claude Code stopped (${code}).`), ANSWER);
          await finish({ status: !stopped && code === 0 ? 'done' : 'declined', answer, answered: new Date().toISOString() });
          resolve();
        });
      });
      started = set(id, { status: 'working', to: 'claude-code', by: 'claude-code', answer: 'Started from the canvas…', sent: card.sent ?? new Date().toISOString() });
      await started;
      return { id, started: true, done };
    },
    /** Stop the run on a card, if there is one. */
    stop(id) {
      const child = running.get(id);
      if (!child) return { id, stopped: false };
      child.stopping();
      return { id, stopped: true };
    },
  };
}
