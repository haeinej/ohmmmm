import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { adviseFiling } from '../src/filing.mjs';
import { initCortex, openCortex } from '../src/folder.mjs';
import { createTools, TOOLS } from '../src/tools.mjs';
import { checkVault, folderVault } from '../src/vault.mjs';

// Every person and block here is invented.
const template = fileURLToPath(new URL('../template', import.meta.url));
const refused = code => problem => problem.code === code;
// What a channel is for is an observation about it.
const describe = (cortex, channel, said) => cortex.observe({ id: `channel-${channel.replace(/\//g, '-')}`, text: said, about: [`channel:${channel}`] });
const writeBlock = async (root, path, { id, title, body = '' }) => {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), `---\nid: ${id}\ntitle: ${title}\n---\n${body}`);
};

async function setup() {
  const base = await mkdtemp(join(tmpdir(), 'cortex-filing-'));
  const vault = join(base, 'vault');
  await writeBlock(vault, 'meetings/harbour-board.md', { id: 'm1', title: 'Harbour board, March', body: 'We talked about the ferry timetable and the harbour wall.' });
  await writeBlock(vault, 'meetings/garden-group.md', { id: 'm2', title: 'Garden group, April', body: 'Seeds, the shed roof.' });
  await writeBlock(vault, 'essays/on-tides.md', { id: 'e1', title: 'On tides', body: 'The harbour empties twice a day.' });
  await writeBlock(vault, 'notes/reading/atlas.md', { id: 'r1', title: 'Reading: an atlas of islands', body: 'Maps of every island.' });
  for (const n of [1, 2, 3, 4, 5, 6]) await writeBlock(vault, `notes/harbour-${n}.md`, { id: `h${n}`, title: `Harbour note ${n}`, body: 'The ferry was late.' });
  const dir = join(base, 'cortex');
  await initCortex(dir, template);
  const person = openCortex(dir, { actor: 'member' });
  await person.connectVault({ kind: 'folder', path: vault });
  const agent = openCortex(dir, { actor: 'claude-code' });
  await agent.start();
  await describe(person, 'meetings', 'Transcripts of meetings I was in, one per meeting. Titled by the group and the month, such as "Harbour board, March"');
  await describe(person, 'essays', 'Finished long-form writing, one idea each. Titles start with "On"');
  await describe(person, 'notes/reading', 'Notes on books and articles I read. Titles start with "Reading:"');
  return { base, vault, dir, person, agent, tools: createTools(agent) };
}

// Every file under a folder, with its size, time and a hash of what it holds.
async function listing(root) {
  const found = [];
  async function walk(folder) {
    for (const entry of (await readdir(join(root, folder), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) { found.push(`${path}/`); await walk(path); continue; }
      const { size, mtimeMs } = await stat(join(root, path));
      found.push(`${path} ${size} ${mtimeMs} ${createHash('sha256').update(await readFile(join(root, path))).digest('hex')}`);
    }
  }
  await walk('');
  return found;
}

const transcript = { kind: 'meeting transcript', title: 'Harbour board, May', text: 'Chair: the harbour wall is repaired. The ferry timetable changes in June. Harbour fees stay the same.' };

test('the advice names a channel with what was observed about it, and up to five related blocks', async () => {
  const { tools } = await setup();
  const advice = await tools.call('cortex_file_advice', transcript);
  assert.deepEqual(advice.vault, { connected: true });
  assert.equal(advice.channels[0].channel, 'meetings');
  assert.equal(advice.channels[0].observed, 'Transcripts of meetings I was in, one per meeting. Titled by the group and the month, such as "Harbour board, March"');
  assert.equal(advice.channels[0].blocks, 2);
  assert.match(advice.channels[0].why, /meeting/);
  assert.ok(advice.channels.length <= 3);
  assert.equal(advice.related.length, 5);
  assert.deepEqual(advice.related[0], { id: 'm1', title: 'Harbour board, March', channel: 'meetings' });
  assert.ok(advice.related.every(block => block.id && block.title && block.channel));
  assert.match(advice.ask, /^Shall I file this in meetings, titled the way blocks there are \(Transcripts of meetings/);
  assert.match(advice.ask, /"Harbour board, March"/);

  // A reading note goes elsewhere, matched by the words of its kind against what was observed about the channel.
  const reading = await tools.call('cortex_file_advice', { kind: 'reading note', title: 'A book about islands' });
  assert.equal(reading.channels[0].channel, 'notes/reading');
  assert.match(reading.channels[0].observed, /Titles start with "Reading:"/);
  assert.deepEqual(reading.related.map(block => block.id), ['r1']);
});

test('with no vault connected, the advice says so instead of guessing', async () => {
  const base = await mkdtemp(join(tmpdir(), 'cortex-filing-'));
  const dir = join(base, 'cortex');
  await initCortex(dir, template);
  const advice = await createTools(openCortex(dir, { actor: 'codex' })).call('cortex_file_advice', transcript);
  assert.deepEqual(advice.vault, { connected: false });
  assert.deepEqual([advice.channels, advice.related], [[], []]);
  assert.match(advice.ask, /No vault is connected/);

  // A vault that cannot be read is said to be unreadable, and nothing is guessed either.
  const gone = await adviseFiling(openCortex(dir, { vault: folderVault(join(base, 'missing')) }), transcript);
  assert.equal(gone.vault.reachable, false);
  assert.deepEqual(gone.channels, []);
  assert.match(gone.ask, /cannot be read/);
});

test('a vault without search still answers, with no related blocks', async () => {
  const { dir, vault } = await setup();
  const { search, ...rest } = folderVault(vault);
  assert.equal(typeof search, 'function');
  const without = checkVault(rest);
  assert.throws(() => checkVault({ ...rest, search: 'not an operation' }), refused('InvalidVault'));
  const advice = await adviseFiling(openCortex(dir, { vault: without }), transcript);
  assert.equal(advice.channels[0].channel, 'meetings');
  assert.deepEqual(advice.related, []);
  assert.match(advice.ask, /^Shall I file this in meetings/);
});

test('asking for advice changes no file in the cortex or the vault', async () => {
  const { dir, vault, tools, agent } = await setup();
  await agent.start();
  const before = [await listing(dir), await listing(vault)];
  await tools.call('cortex_file_advice', transcript);
  await tools.call('cortex_file_advice', { kind: 'link', title: 'A page about ferries', text: 'https://example.invalid/ferries' });
  await tools.call('cortex_file_advice', { kind: 'voice memo' });
  assert.deepEqual([await listing(dir), await listing(vault)], before);
  assert.equal(TOOLS.find(tool => tool.name === 'cortex_file_advice').annotations.readOnlyHint, true);
});

test('an approved skill whose description fits the kind is named, and an unapproved one is not', async () => {
  const { dir, tools, agent } = await setup();
  const person = openCortex(dir, { actor: 'member' });
  await agent.proposeSkill({ text: '---\nname: meeting-minutes\ndescription: Turning a meeting transcript into minutes\n---\n1. List who spoke.\n' });
  await agent.proposeSkill({ text: '---\nname: file-a-voice-memo\ndescription: Filing a voice memo with its date\n---\n1. Note the date.\n' });
  await person.approveSkill('meeting-minutes');

  assert.deepEqual((await tools.call('cortex_file_advice', transcript)).skill, { name: 'meeting-minutes', description: 'Turning a meeting transcript into minutes' });
  // The voice memo skill is still waiting for the person, so it is not named.
  assert.equal((await tools.call('cortex_file_advice', { kind: 'voice memo' })).skill, null);
  await person.approveSkill('file-a-voice-memo');
  assert.equal((await tools.call('cortex_file_advice', { kind: 'voice memo' })).skill.name, 'file-a-voice-memo');
  // The filing skill the template ships fits any of the kinds it names.
  assert.equal((await tools.call('cortex_file_advice', { kind: 'link' })).skill.name, 'file-a-source');
});

test('a source must say what it is', async () => {
  const { tools } = await setup();
  await assert.rejects(tools.call('cortex_file_advice', { title: 'Untitled' }), /Give kind/);
  await assert.rejects(tools.call('cortex_file_advice', { kind: '  ' }), /InvalidRequest/);
  await assert.rejects(tools.call('cortex_file_advice', { kind: 'link', url: 'https://example.invalid' }), /takes only/);
});

test('a folder vault searches titles and bodies, title first', async () => {
  const { vault } = await setup();
  const folder = folderVault(vault);
  const found = await folder.search('harbour ferry', 3);
  assert.equal(found.length, 3);
  assert.deepEqual(found[0], { id: 'm1', title: 'Harbour board, March', channel: 'meetings' });
  assert.deepEqual((await folder.search(['islands'])).map(block => block.id), ['r1']);
  assert.deepEqual((await folder.search(['atlas'], 10))[0], { id: 'r1', title: 'Reading: an atlas of islands', channel: 'notes/reading' });
  assert.deepEqual(await folder.search('nothing-here-at-all'), []);
  assert.deepEqual(await folder.search(''), []);
});

test('a new cortex ships the filing skill, and the rulebook says how to file', async () => {
  const { agent } = await setup();
  const start = await agent.start();
  assert.ok(start.skills.some(skill => skill.name === 'file-a-source'));
  const { skill } = await agent.getSkill('file-a-source');
  assert.match(skill.text, /cortex_file_advice/);
  assert.match(start.rules, /## Filing\n/);
  assert.match(start.rules, /File only what they hand over/);
  assert.match(start.rules, /Never write a block or a fact of your own/);
  assert.equal(start.rules.match(/File only what/g).length, 1, 'the filing lines are moved, not repeated');
});

test('a specific approved skill is named before the general filing skill, and the more exact one wins a tie', async () => {
  const { dir, agent, tools } = await setup();
  const person = openCortex(dir, { actor: 'member' });
  for (const [name, description] of [['save-a-link', 'Saving a link'], ['meeting-notes', 'Notes from a meeting transcript'], ['link-roundup', 'Gathering every link from a week of reading into one long post']]) {
    await agent.proposeSkill({ text: `---\nname: ${name}\ndescription: ${description}\n---\n1. Do it.\n` });
    await person.approveSkill(name);
  }
  const skillFor = async kind => (await tools.call('cortex_file_advice', { kind })).skill?.name;
  assert.equal(await skillFor('link'), 'save-a-link', 'link-roundup shares as many words, but fewer of its own');
  assert.equal(await skillFor('meeting transcript'), 'meeting-notes');
  assert.equal(await skillFor('note'), 'meeting-notes');
  // Only when nothing more specific fits is the general skill named.
  assert.equal(await skillFor('upload'), undefined);
  assert.equal(await skillFor('source'), 'file-a-source');
});

test('search and advice match Korean and Japanese, where words are not spaced', async () => {
  const { dir, vault, agent, tools } = await setup();
  await writeBlock(vault, 'meetings/harbour-ko.md', { id: 'k1', title: '항구 위원회 회의록', body: '방파제 수리를 논의했다.' });
  await writeBlock(vault, 'notes/reading/book-ko.md', { id: 'k2', title: '읽은 것', body: '책 한 권을 다 읽었다.' });
  await writeBlock(vault, 'meetings/harbour-ja.md', { id: 'j1', title: '港の会議', body: 'フェリーの時刻表について話した。' });
  const folder = folderVault(vault);
  const ids = async words => (await folder.search(words)).map(block => block.id);
  assert.deepEqual(await ids('회의'), ['k1']);
  assert.deepEqual(await ids('회의를'), ['k1'], 'a particle after the word still matches');
  assert.deepEqual(await ids('책'), ['k2'], 'a one-character word is kept');
  assert.deepEqual(await ids('会議'), ['j1']);
  assert.deepEqual(await ids('フェリー'), ['j1']);
  // English stop words and plurals still apply to English only.
  assert.deepEqual(await ids('the'), []);
  assert.ok((await ids('harbours')).includes('m1'), 'an English plural matches the singular');

  await agent.start();
  await openCortex(dir, { actor: 'member' }).syncVault();
  const advice = await tools.call('cortex_file_advice', { kind: '회의록', title: '항구 위원회 회의', text: '방파제' });
  assert.deepEqual(advice.related.map(block => block.id), ['k1']);
});

test('one piece of advice reads each block once, and search still sees a block that changed', async () => {
  const { dir, vault } = await setup();
  const read = [];
  const counted = folderVault(vault, { readText: path => { read.push(path); return readFile(path, 'utf8'); } });
  await adviseFiling(openCortex(dir, { vault: counted }), transcript);
  assert.equal(read.length, 10, 'ten blocks, each read once for shape and search together');
  assert.equal(new Set(read).size, read.length);

  read.length = 0;
  await writeBlock(vault, 'essays/on-tides.md', { id: 'e1', title: 'On tides and lighthouses', body: 'A lighthouse at the end of the wall.' });
  assert.deepEqual((await counted.search('lighthouse')).map(block => block.id), ['e1']);
  assert.equal(read.length, 1, 'only the changed block is read again');
});

test('a channel and its own sub-channel are not both offered', async () => {
  const { vault, dir, tools } = await setup();
  await writeBlock(vault, 'notes/daily/monday.md', { id: 'd1', title: 'Monday', body: '' });
  await openCortex(dir, { actor: 'member' }).syncVault();
  await describe(openCortex(dir, { actor: 'member' }), 'notes', 'Short notes of every kind');
  await describe(openCortex(dir, { actor: 'member' }), 'notes/daily', 'A note for each day');
  const advice = await tools.call('cortex_file_advice', { kind: 'reading note' });
  const channels = advice.channels.map(channel => channel.channel);
  assert.equal(channels[0], 'notes/reading');
  assert.equal(channels.includes('notes'), false, channels.join(', '));
  assert.ok(channels.includes('notes/daily'));
});
