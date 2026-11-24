import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { initCortex, openCortex } from '../src/folder.mjs';
import { createServer } from '../src/protocol.mjs';
import { createTools, INSTRUCTIONS, TOOLS } from '../src/tools.mjs';

// Every person here is invented.
const template = fileURLToPath(new URL('../template', import.meta.url));
const cli = fileURLToPath(new URL('../bin/cortex.mjs', import.meta.url));
const fresh = async (options = { actor: 'test-agent' }) => {
  const dir = join(await mkdtemp(join(tmpdir(), 'cortex-')), 'cortex');
  await initCortex(dir, template);
  return { dir, cortex: openCortex(dir, options), person: openCortex(dir, { actor: 'member' }) };
};
const refused = code => problem => problem.code === code || JSON.parse(problem.message).error === code;

test('a new cortex has the playbook, a profile to fill in, no observations, and the filing skill', async () => {
  const { dir, cortex } = await fresh();
  const start = await cortex.start();
  assert.match(start.rules, /How to keep this cortex/);
  assert.deepEqual(start.profile, { account: null, text: '## Preferences\n\n## Goals\n\n## Notes' });
  assert.deepEqual([start.observations, start.skills.map(skill => skill.name), start.tools], [[], ['file-a-source'], []]);
  assert.deepEqual(start.waiting, { profile: [], skills: [], tools: [] });
  assert.deepEqual((await readdir(dir)).filter(name => !name.startsWith('.')).sort(), ['agents', 'observations', 'profile.md', 'skills', 'tools']);
  await assert.rejects(initCortex(dir, template), refused('NameTaken'));
  // Started for an account, the profile names it.
  const other = join(await mkdtemp(join(tmpdir(), 'cortex-')), 'cortex');
  await initCortex(other, template, { account: 'did:plc:example0sam' });
  assert.equal((await openCortex(other).profile()).account, 'did:plc:example0sam');
  await assert.rejects(initCortex(join(other, '..', 'bad'), template, { account: 'not an account' }), refused('InvalidRequest'));
});

test('secrets have one place, and git is told never to take them', async () => {
  const { dir, cortex } = await fresh();
  assert.deepEqual(await readdir(join(dir, 'agents')), ['AGENTS.md', 'secrets']);
  assert.deepEqual(await readdir(join(dir, 'agents', 'secrets')), []);
  assert.match((await cortex.start()).rules, /Never copy what a secret says/);
  await writeFile(join(dir, 'agents', 'secrets', 'calendar.key'), 'not-a-real-key');
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
  git('init', '-q');
  git('add', '-A');
  const tracked = git('ls-files').split('\n');
  assert.equal(tracked.some(file => file.startsWith('agents/secrets/')), false);
  assert.equal(['agents/AGENTS.md', '.gitignore', '.gitattributes', 'profile.md'].every(file => tracked.includes(file)), true);
  assert.match(git('check-attr', 'merge', '--', '.cortex/profile.jsonl'), /merge: union/);
});

test('an observation is one file, a retry is not a second one, and a rewrite names the version it replaces', async () => {
  const { dir, cortex } = await fresh();
  const saved = await cortex.observe({ id: 'short-titles', text: 'Shortens titles to three words.', session: 's1' });
  assert.deepEqual([saved.node, saved.op, typeof saved.change], ['observation/short-titles', 'create', 'string']);
  assert.match(await readFile(join(dir, 'observations', 'short-titles.md'), 'utf8'), /^---\nat: "[^"]+"\nby: "test-agent"\nsession: "s1"\n---\nShortens titles to three words\.\n$/);
  assert.equal((await cortex.observe({ id: 'short-titles', text: 'Shortens titles to three words.', session: 's1' })).unchanged, true);
  await assert.rejects(cortex.observe({ id: 'short-titles', text: 'Something else.' }), refused('NameTaken'));
  await assert.rejects(cortex.observe({ id: 'short-titles', text: 'Something else.', replaces: 'cstale' }), refused('Changed'));
  const rewritten = await cortex.observe({ id: 'short-titles', text: 'Shortens titles to three words, even long ones.', replaces: saved.version, reason: 'Seen again' });
  assert.equal(rewritten.op, 'update');
  const { observation } = await cortex.readObservation('short-titles');
  assert.deepEqual([observation.text, observation.by], ['Shortens titles to three words, even long ones.', 'test-agent']);
  for (const bad of [{ id: '../x', text: 'x' }, { id: 'x', text: '' }, { id: 'x', text: 'y'.repeat(2001) }, { id: 'x', text: 'y', about: 'p1' }]) {
    await assert.rejects(cortex.observe(bad), refused('InvalidRequest'), JSON.stringify(bad).slice(0, 60));
  }
});

test('a working agent flags a question for the curator, and the curator settles it with an observation of its own', async () => {
  const { dir, cortex } = await fresh();
  const curator = openCortex(dir, { actor: 'curator' });
  await cortex.observe({ id: 'label-q', text: 'This essay reads like a photo post; its label may be wrong.', needs: 'curator' });
  await cortex.observe({ id: 'plain', text: 'Prefers tables to lists.' });
  assert.match(await readFile(join(dir, 'observations', 'label-q.md'), 'utf8'), /\nneeds: "curator"\n/);
  assert.deepEqual((await cortex.observations({ needs: 'curator' })).observations.map(item => item.id), ['label-q']);
  await assert.rejects(cortex.observe({ id: 'x', text: 'y', needs: 'anyone' }), refused('InvalidRequest'));
  await assert.rejects(curator.observe({ id: 'answer', text: 'Kept as is.', settles: ['plain'] }), refused('NotFound'));
  await assert.rejects(curator.observe({ id: 'answer', text: 'Kept as is.', settles: ['answer'] }), refused('InvalidRequest'));
  // Settling writes the curator's own observation and leaves the flag as its author wrote it.
  await curator.observe({ id: 'answer', text: 'The person kept the label.', settles: ['label-q'] });
  assert.deepEqual((await cortex.observations({ needs: 'curator' })).observations, []);
  assert.equal((await cortex.readObservation('label-q')).observation.needs, 'curator');
  assert.deepEqual((await cortex.readObservation('answer')).observation.settles, ['label-q']);
  // The same over the tools.
  const tools = createTools(cortex);
  await tools.call('cortex_observe', { id: 'channel-q', text: 'Two channels hold the same trip.', needs: 'curator' });
  assert.deepEqual((await tools.call('cortex_recall', { needs: 'curator' })).observations.map(item => item.id), ['channel-q']);
});

test('a flag is not settled by the agent that raised it, and a rewritten flag is open again', async () => {
  const { dir, cortex, person } = await fresh();
  const curator = openCortex(dir, { actor: 'curator' });
  const open = async () => (await cortex.observations({ needs: 'curator' })).observations.map(item => item.id);
  // An agent cannot settle its own flag; a curator subagent shares its name, so the person settles it.
  const flag = await cortex.observe({ id: 'own-q', text: 'This channel may belong under another.', needs: 'curator' });
  await assert.rejects(cortex.observe({ id: 'own-a', text: 'Settled by me.', settles: ['own-q'] }), refused('PersonOnly'));
  // A settle written by hand under the flag's own author does not count either.
  await writeFile(join(dir, 'observations', 'forged.md'), `---\nat: "2026-11-23T00:00:00.000Z"\nby: "test-agent"\nsettles:\n  - "own-q@${flag.version}"\n---\nSettled.\n`);
  assert.deepEqual(await open(), ['own-q']);
  await person.observe({ id: 'you-1', text: 'Keep it where it is.', settles: ['own-q'] });
  assert.deepEqual(await open(), []);
  // Rewritten with a new question, the flag is open again; its author withdraws it with needs: null.
  const read = await cortex.readObservation('own-q');
  const rewritten = await cortex.observe({ id: 'own-q', text: 'Now it may belong in two channels.', replaces: read.version });
  assert.deepEqual(await open(), ['own-q']);
  await cortex.observe({ id: 'own-q', text: 'Now it may belong in two channels.', needs: null, replaces: rewritten.version });
  assert.deepEqual(await open(), []);
  assert.equal((await cortex.readObservation('own-q')).observation.needs, undefined);
  // Once a settled flag is gone, the curator can still retry and rewrite its own answer.
  await cortex.observe({ id: 'gone-q', text: 'Two blocks may be one.', needs: 'curator' });
  const answer = await curator.observe({ id: 'gone-a', text: 'The person kept both.', settles: ['gone-q'] });
  await cortex.removeObservation('gone-q', { replaces: (await cortex.readObservation('gone-q')).version });
  assert.equal((await curator.observe({ id: 'gone-a', text: 'The person kept both.', settles: ['gone-q'] })).unchanged, true);
  await curator.observe({ id: 'gone-a', text: 'The person kept both blocks.', settles: ['gone-q'], replaces: answer.version });
  assert.deepEqual((await cortex.readObservation('gone-a')).observation.settles, ['gone-q']);
});

test('an agent changes only its own observations as it left them; the person changes any', async () => {
  const { dir, cortex, person } = await fresh();
  const codex = openCortex(dir, { actor: 'codex' });
  const mine = await cortex.observe({ id: 'tables', text: 'Prefers tables to lists.' });
  // Another agent cannot rewrite, remove or pin it.
  await assert.rejects(codex.observe({ id: 'tables', text: 'x', replaces: mine.version }), refused('PersonOnly'));
  await assert.rejects(codex.removeObservation('tables', { replaces: mine.version }), refused('PersonOnly'));
  await assert.rejects(cortex.observe({ id: 'pinned', text: 'x', pin: true }), refused('PersonOnly'));
  // Once the person has changed it, it is theirs.
  const edited = await person.observe({ id: 'tables', text: 'Prefers tables to lists, for comparisons.', replaces: mine.version, pin: true });
  await assert.rejects(cortex.observe({ id: 'tables', text: 'x', replaces: edited.version }), refused('PersonOnly'));
  await assert.rejects(cortex.removeObservation('tables', { replaces: edited.version }), refused('PersonOnly'));
  // An edit by hand counts the same: the file is no longer as the agent left it.
  const second = await cortex.observe({ id: 'mornings', text: 'Writes in the morning.' });
  await writeFile(join(dir, 'observations', 'mornings.md'), (await readFile(join(dir, 'observations', 'mornings.md'), 'utf8')).replace('morning', 'early morning'));
  const now = (await cortex.readObservation('mornings')).version;
  assert.notEqual(now, second.version);
  await assert.rejects(cortex.observe({ id: 'mornings', text: 'x', replaces: now }), refused('PersonOnly'));
  // The person writes their own, and they are named as theirs.
  await person.observe({ id: 'own', text: 'I draft on paper first.' });
  assert.equal((await cortex.readObservation('own')).observation.by, 'you');
  // An agent's own, untouched, it may remove; it is kept, and can be restored.
  const third = await cortex.observe({ id: 'wrong', text: 'Dislikes footnotes.' });
  const removed = await cortex.removeObservation('wrong', { replaces: third.version, reason: 'They use footnotes' });
  assert.equal(removed.op, 'remove');
  assert.equal((await cortex.readObservation('wrong', { version: third.version })).observation.text, 'Dislikes footnotes.');
  await cortex.restore({ node: 'observation/wrong', version: third.version });
  assert.equal((await cortex.readObservation('wrong')).observation.text, 'Dislikes footnotes.');
});

test('a file the person edited by hand is what the agent is given', async () => {
  const { dir, cortex } = await fresh();
  await writeFile(join(dir, 'profile.md'), '---\naccount: "sam.example.com"\n---\n## Preferences\n\n- Never use exclamation marks\n');
  await writeFile(join(dir, 'observations', 'by-hand.md'), '---\nat: "2026-11-01T00:00:00.000Z"\nby: "you"\npin: true\n---\nI file receipts by month.\n');
  const start = await cortex.start();
  assert.match(start.profile.text, /Never use exclamation marks/);
  assert.equal(start.profile.account, 'sam.example.com');
  assert.deepEqual(start.observations.map(item => [item.id, item.by, item.pin, item.text]), [['by-hand', 'you', true, 'I file receipts by month.']]);
});

test('pinned observations come first, then the newest thirty; recall finds the rest by words, by what they are about, or by ID', async () => {
  const { dir, person } = await fresh();
  for (let n = 0; n < 35; n++) await openCortex(dir, { actor: 'codex', now: () => new Date(Date.UTC(2026, 10, 1, 0, n)) }).observe({ id: `seen-${n}`, text: `Noticed thing number ${n}.` });
  await person.observe({ id: 'harbour', text: 'Walks to the harbour before writing.', pin: true });
  const start = await openCortex(dir, { actor: 'claude-code' }).start();
  assert.equal(start.observations[0].id, 'harbour');
  assert.deepEqual(start.observations.slice(1, 3).map(item => item.id), ['seen-34', 'seen-33']);
  assert.equal(start.observations.length, 31);
  assert.equal(start.moreObservations, 5);
  const tools = createTools(openCortex(dir, { actor: 'claude-code' }));
  const found = await tools.call('cortex_recall', { query: 'noticed', limit: 2 });
  assert.deepEqual([found.observations.length, found.more], [2, 33]);
  assert.deepEqual((await tools.call('cortex_recall', { query: 'harbour writing' })).observations.map(item => item.id), ['harbour']);
  const one = await tools.call('cortex_recall', { id: 'seen-0', history: true });
  assert.deepEqual([one.observation.text, one.earlier], ['Noticed thing number 0.', []]);
  await assert.rejects(tools.call('cortex_recall', { id: 'seen-0', query: 'x' }), refused('InvalidRequest'));
  await assert.rejects(tools.call('cortex_recall', { query: 'x', history: true }), refused('InvalidRequest'));
});

test('the profile is the person\'s: an agent proposes a line, and only the person accepts it', async () => {
  const { dir, cortex, person } = await fresh();
  assert.equal(TOOLS.some(tool => /profile/.test(tool.name) && tool.name !== 'cortex_propose_profile'), false);
  await assert.rejects(cortex.writeProfile('## Preferences\n- Anything\n'), refused('PersonOnly'));
  await assert.rejects(cortex.setAccount('did:plc:example0x'), refused('PersonOnly'));
  const proposed = await createTools(cortex).call('cortex_propose_profile', { heading: 'Goals', line: 'Finish the tides essay by spring', quote: 'I want the tides essay done by spring' });
  assert.equal(proposed.waiting, true);
  assert.equal((await cortex.proposeProfile({ heading: 'goals', line: 'Finish the tides essay  by spring' })).unchanged, true, 'the same line, asked twice, waits once');
  assert.deepEqual((await cortex.start()).waiting.profile.map(item => [item.heading, item.line, item.by]), [['Goals', 'Finish the tides essay by spring', 'test-agent']]);
  await assert.rejects(cortex.acceptProfile(proposed.id), refused('PersonOnly'));
  const accepted = await person.acceptProfile(proposed.id);
  assert.equal(accepted.node, 'profile');
  assert.match(await readFile(join(dir, 'profile.md'), 'utf8'), /## Goals\n\n- Finish the tides essay by spring\n\n## Notes/);
  assert.equal((await cortex.proposeProfile({ heading: 'Goals', line: 'Finish the tides essay by spring' })).unchanged, true, 'a line already there is not proposed');
  // A heading the profile does not have yet is added at the end.
  const garden = await cortex.proposeProfile({ heading: 'Projects', line: 'The garden plan' });
  await person.acceptProfile(garden.id);
  assert.match(await readFile(join(dir, 'profile.md'), 'utf8'), /## Notes\n\n## Projects\n\n- The garden plan\n$/);
  // An agent never restores the profile, and the change names who proposed the line.
  const change = (await person.history({ node: 'profile' })).changes.at(-1);
  assert.deepEqual([change.actor.name, change.proposedBy], ['member', 'test-agent']);
  await assert.rejects(cortex.restore({ node: 'profile', version: change.before }), refused('PersonOnly'));
  // The person rewrites their part whole; the account stays.
  await person.setAccount('sam.example.com');
  const { version } = await person.profile();
  await person.writeProfile('## Preferences\n\n- Short paragraphs\n', { replaces: version });
  assert.deepEqual(await person.profile().then(({ account, sections }) => ({ account, sections })), { account: 'sam.example.com', sections: [{ heading: 'Preferences', lines: ['Short paragraphs'] }] });
  await assert.rejects(person.writeProfile('x', { replaces: version }), refused('Changed'));
  // From the command line.
  const asked = await cortex.proposeProfile({ heading: 'Preferences', line: 'British spelling' });
  assert.match(execFileSync('node', [cli, 'accept', asked.id, dir], { encoding: 'utf8' }), /Added under Preferences: British spelling/);
  assert.match(execFileSync('node', [cli, 'profile', dir], { encoding: 'utf8' }), /British spelling/);
});

test('a skill an agent wrote is not used until the person approves it', async () => {
  const { dir, cortex } = await fresh();
  const text = '---\nname: publish-an-essay\ndescription: The steps for publishing an essay\n---\n1. Check the title.\n';
  const proposed = await cortex.proposeSkill({ text, files: [{ path: 'checklist.md', text: 'Title, date.' }] });
  assert.equal(proposed.approved, false);
  assert.deepEqual(await readdir(join(dir, 'skills')), ['file-a-source']);
  await assert.rejects(cortex.getSkill('publish-an-essay'), refused('SkillNotApproved'));
  const start = await cortex.start();
  assert.deepEqual([start.skills.map(skill => skill.name), start.waiting.skills], [['file-a-source'], ['publish-an-essay']]);
  await assert.rejects(cortex.proposeSkill({ text, files: [{ path: '../outside.md', text: 'x' }] }), refused('InvalidSkill'));
  await assert.rejects(cortex.approveSkill('publish-an-essay'), refused('PersonOnly'));
  await openCortex(dir, { actor: 'member' }).approveSkill('publish-an-essay');
  const read = await cortex.getSkill('publish-an-essay');
  assert.equal(read.skill.text, text);
  assert.deepEqual(read.skill.files, [{ path: 'checklist.md', text: 'Title, date.' }]);
  assert.deepEqual((await cortex.start()).skills.map(skill => skill.name), ['file-a-source', 'publish-an-essay']);
});

test('an agent can ask for a tool, and cannot add one or switch one on', async () => {
  const { dir, cortex } = await fresh();
  await cortex.proposeTool({ name: 'calendar', description: 'Read the calendar', inputs: 'A date', outputs: 'Events' });
  assert.deepEqual((await cortex.start()).tools, []);
  assert.deepEqual(await readdir(join(dir, 'tools')), []);
  assert.deepEqual((await cortex.start()).waiting.tools, ['calendar']);
  assert.equal(TOOLS.some(tool => /approve|enable|put_tool/.test(tool.name)), false);
  await writeFile(join(dir, 'tools', 'calendar.md'), '---\nname: calendar\ndescription: Read the calendar\non: true\n---\n');
  await writeFile(join(dir, 'tools', 'mail.md'), '---\nname: mail\ndescription: Send mail\non: false\n---\n');
  assert.deepEqual((await cortex.start()).tools, [{ name: 'calendar', description: 'Read the calendar' }]);
  await assert.rejects(cortex.proposeTool({ name: 'calendar', description: 'x', inputs: 'x', outputs: 'x' }), refused('NameTaken'));
});

test('an agent keeps a cortex through the tools alone', async () => {
  const { cortex } = await fresh({ actor: 'claude-code' });
  let seen;
  const handle = createServer({ tools: createTools(cortex), list: TOOLS, instructions: INSTRUCTIONS, onClient: name => { seen = name; } });
  const ask = async (name, args = {}) => {
    const { result } = await handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
    return { ...result, value: result.isError ? result.content[0].text : JSON.parse(result.content[0].text) };
  };
  const hello = await handle({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-06-18', clientInfo: { name: 'claude-code' } } });
  assert.match(hello.result.instructions, /cortex_start before anything else/);
  assert.equal(seen, 'claude-code');
  const offered = (await handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).result.tools.map(tool => tool.name);
  assert.deepEqual(offered, ['cortex_start', 'cortex_observe', 'cortex_recall', 'cortex_propose_profile', 'cortex_skill', 'cortex_propose_skill', 'cortex_propose_tool', 'cortex_file_advice', 'cortex_history', 'cortex_as_of', 'cortex_save', 'cortex_restore', 'cortex_revert', 'cortex_session']);

  assert.match((await ask('cortex_start')).value.rules, /What you may not do/);
  const saved = (await ask('cortex_observe', { id: 'titles', text: 'Rewrote my title to be shorter.', session: 's1' })).value;
  assert.equal((await ask('cortex_history', { node: 'observation/titles' })).value.changes[0].id, saved.change);
  assert.equal((await ask('cortex_recall', { id: 'titles' })).value.observation.by, 'claude-code');
  const clash = await ask('cortex_observe', { id: 'titles', text: 'Different.' });
  assert.equal(clash.isError, true);
  assert.equal(JSON.parse(clash.value).current, saved.version);
  assert.equal((await ask('cortex_observe', { id: 'titles', remove: true })).isError, true, 'a removal names the version');
  assert.equal((await ask('cortex_observe', { id: 'titles', remove: true, version: saved.version })).value.removed, true);
  assert.equal((await ask('cortex_recall', { id: 'titles' })).isError, true);
});
