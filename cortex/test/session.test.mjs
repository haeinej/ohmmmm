import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { initCortex, openCortex } from '../src/folder.mjs';
import { createTools } from '../src/tools.mjs';

// Every person and project here is invented.
const template = fileURLToPath(new URL('../template', import.meta.url));
const cli = fileURLToPath(new URL('../bin/cortex.mjs', import.meta.url));
const fresh = async () => {
  const dir = join(await mkdtemp(join(tmpdir(), 'cortex-')), 'cortex');
  await initCortex(dir, template);
  return dir;
};
const refused = code => problem => problem.code === code || JSON.parse(problem.message).error === code;
const journal = async dir => (await readFile(join(dir, '.cortex', 'journal.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));

test('an agent records a finished task: what was done, the changes it made, and the dead ends', async () => {
  const dir = await fresh();
  const tools = createTools(openCortex(dir, { actor: 'codex' }));
  const one = await tools.call('cortex_observe', { id: 'by-book', text: 'Files reading notes by book, not author.' });
  const two = await tools.call('cortex_observe', { id: 'reading-apart', text: 'Keeps reading notes apart from essays.' });
  const done = await tools.call('cortex_session', {
    summary: 'Tidied how reading notes are titled', made: [one.change, two.change], project: '/home/sam/atlas', session: 'codex-7',
    deadEnds: [
      { tried: 'Titling reading notes by author', why: 'Sam files by book, not author', check: 'grep -l author notes/reading' },
      { tried: 'Moving notes/reading under essays', why: 'Sam wants them apart' },
    ],
  });
  assert.equal(done.deadEnds.length, 2);
  const line = (await journal(dir)).at(-1);
  assert.deepEqual([line.type, line.summary, line.outcome, line.made, line.project, line.session, line.actor.name], ['session', 'Tidied how reading notes are titled', 'done', [one.change, two.change], '/home/sam/atlas', 'codex-7', 'codex']);
  assert.deepEqual(line.deadEnds.map(item => [item.id, item.tried, item.check]), [[done.deadEnds[0], 'Titling reading notes by author', 'grep -l author notes/reading'], [done.deadEnds[1], 'Moving notes/reading under essays', undefined]]);

  // Only what this agent made can be grouped, and only what exists.
  await assert.rejects(tools.call('cortex_session', { summary: 'x', made: ['nothing'] }), refused('NotFound'));
  const other = await createTools(openCortex(dir, { actor: 'claude-code' })).call('cortex_observe', { id: 'maps', text: 'Draws maps.' });
  await assert.rejects(tools.call('cortex_session', { summary: 'x', made: [other.change] }), refused('InvalidRequest'));
  for (const bad of [{ summary: '' }, { summary: 'two\nlines' }, { summary: 'x', outcome: 'maybe' }, { summary: 'x', deadEnds: [{ tried: 'x' }] }, { summary: 'x', deadEnds: [{ tried: 'x', why: 'y', when: 'z' }] }]) {
    await assert.rejects(tools.call('cortex_session', bad), refused('InvalidRequest'), JSON.stringify(bad));
  }
  // The person does not write sessions.
  await assert.rejects(openCortex(dir, { actor: 'member' }).recordSession({ summary: 'x' }), refused('InvalidRequest'));
  // A task given up is a session too.
  await tools.call('cortex_session', { summary: 'Tried to merge two channels', outcome: 'stopped', project: '/home/sam/other', deadEnds: [{ tried: 'Merging notes and essays', why: 'The person said no' }] });
  assert.equal((await journal(dir)).at(-1).outcome, 'stopped');
});

test('open dead ends are shown at the start: all of them to cortex_start, the ones near the project to the hook', async () => {
  const dir = await fresh();
  const codex = createTools(openCortex(dir, { actor: 'codex' }));
  const atlas = await codex.call('cortex_session', { summary: 'Atlas work', project: '/home/sam/atlas', deadEnds: [{ tried: 'Titling by author', why: 'Filed by book', check: 'ls notes/reading' }] });
  await codex.call('cortex_session', { summary: 'Garden work', project: '/home/sam/garden', deadEnds: [{ tried: 'Splitting the seed list', why: 'One list is easier' }] });

  const start = await createTools(openCortex(dir, { actor: 'claude-code' })).call('cortex_start');
  assert.deepEqual(start.deadEnds.map(item => [item.tried, item.agent, item.project]), [['Splitting the seed list', 'codex', '/home/sam/garden'], ['Titling by author', 'codex', '/home/sam/atlas']]);

  const hook = cwd => JSON.parse(spawnSync('node', [cli, 'hook', 'session-start', dir, '--agent', 'claude-code'], { input: JSON.stringify({ session_id: 's1', cwd, hook_event_name: 'SessionStart', source: 'startup' }), encoding: 'utf8' }).stdout).hookSpecificOutput.additionalContext;
  const near = hook('/home/sam/atlas/notes');
  assert.match(near, /## Dead ends near this project\n\n- Titling by author: Filed by book \(check: ls notes\/reading\)/);
  assert.doesNotMatch(near, /seed list/);
  assert.doesNotMatch(hook('/home/sam/elsewhere'), /Dead ends/);

  // A later session marks a dead end resolved; it is no longer shown.
  await codex.call('cortex_session', { summary: 'Retitled by author after all', project: '/home/sam/atlas', resolved: [atlas.deadEnds[0]] });
  assert.doesNotMatch(hook('/home/sam/atlas'), /Titling by author/);
  assert.deepEqual((await openCortex(dir).deadEnds()).map(item => item.tried), ['Splitting the seed list']);
  await assert.rejects(codex.call('cortex_session', { summary: 'x', resolved: [atlas.deadEnds[0]] }), refused('NotFound'));
});

test('an agent reverts its own change; the person reverts anyone\'s, and the agent\'s versions stay in history', async () => {
  const dir = await fresh();
  const codex = createTools(openCortex(dir, { actor: 'codex' }));
  const person = openCortex(dir, { actor: 'member' });
  const first = await codex.call('cortex_observe', { id: 'titles', text: 'Short titles.', reason: 'Said so twice' });
  const second = await codex.call('cortex_observe', { id: 'titles', text: 'Titles of one word.', version: first.version, reason: 'Guessed from one title' });
  assert.deepEqual((await person.history({ actor: 'codex' })).changes.map(line => [line.id, line.op, line.reason]), [[first.change, 'create', 'Said so twice'], [second.change, 'update', 'Guessed from one title']]);

  // The agent undoes its own guess.
  await assert.rejects(codex.call('cortex_revert', { change: first.change }), refused('Changed'), 'the node has changed since');
  const undone = await codex.call('cortex_revert', { change: second.change, reason: 'One title is not enough' });
  assert.deepEqual([undone.reverted, undone.version], [second.change, first.version]);
  assert.equal((await person.readObservation('titles')).observation.text, 'Short titles.');
  // Another agent cannot.
  const back = (await journal(dir)).at(-1);
  await assert.rejects(createTools(openCortex(dir, { actor: 'claude-code' })).call('cortex_revert', { change: back.id }), refused('PersonOnly'));

  // The person brings the agent's version back from the command line, then reverts the first change: it goes, and is kept.
  assert.match(execFileSync('node', [cli, 'restore', 'observation/titles', second.version, dir, '--reason', 'It was right'], { encoding: 'utf8' }), /is back to/);
  assert.deepEqual(await journal(dir).then(all => [all.at(-1).actor.kind, all.at(-1).restores, all.at(-1).reason]), ['human', second.version, 'It was right']);
  execFileSync('node', [cli, 'restore', 'observation/titles', first.version, dir]);
  assert.match(execFileSync('node', [cli, 'revert', first.change, dir], { encoding: 'utf8' }), /is undone/);
  await assert.rejects(person.readObservation('titles'), refused('NotFound'));
  assert.equal((await person.readObservation('titles', { version: first.version })).observation.text, 'Short titles.');
  // Nothing in the journal was rewritten: the agent's changes are where they were.
  assert.deepEqual((await person.history({ actor: 'codex' })).changes.slice(0, 2).map(line => line.id), [first.change, second.change]);
  await assert.rejects(person.revert({ change: 'no-such-change' }), refused('NotFound'));
});

test('a skill the person approved is reverted only by the person, and read back whole', async () => {
  const dir = await fresh();
  const person = openCortex(dir, { actor: 'member' });
  const agent = openCortex(dir, { actor: 'codex' });
  await agent.proposeSkill({ text: '---\nname: file-a-receipt\ndescription: How receipts are filed\n---\nFile by month.\n' });
  const approved = await person.approveSkill('file-a-receipt');
  await assert.rejects(createTools(agent).call('cortex_revert', { change: approved.change }), refused('PersonOnly'));
  const seq = (await journal(dir)).find(line => line.id === approved.change).seq;
  assert.match(execFileSync('node', [cli, 'as-of', 'skill/file-a-receipt', String(seq), dir], { encoding: 'utf8' }), /"text": "---\\nname: file-a-receipt[\s\S]*File by month/);
  await person.revert({ change: approved.change });
  await assert.rejects(agent.getSkill('file-a-receipt'), refused('NotFound'));
});
