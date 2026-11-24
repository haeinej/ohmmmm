import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { initCortex, openCortex } from '../src/folder.mjs';

// What the person does from the app: edit and remove skills, switch tools, turn down proposals.
// Every person here is invented.
const template = fileURLToPath(new URL('../template', import.meta.url));
const fresh = async () => {
  const dir = join(await mkdtemp(join(tmpdir(), 'cortex-')), 'cortex');
  await initCortex(dir, template);
  return { dir, agent: openCortex(dir, { actor: 'test-agent' }), person: openCortex(dir, { actor: 'member' }) };
};
const refused = code => problem => problem.code === code;
const tool = (on = false) => `---\nname: "vault-search"\ndescription: "Searches the vault"\non: ${on}\n---\n\nSearches the vault by text.\n`;

test('the person edits a skill\'s instructions; its properties and files stay, and the change is theirs', async () => {
  const { dir, agent, person } = await fresh();
  const read = await person.readSkill('file-a-source');
  assert.match(read.text, /^---\nname: file-a-source/);
  const done = await person.writeSkill('file-a-source', { body: '# Filing a source\n\nAsk once, then file.', replaces: read.version });
  const now = await readFile(join(dir, 'skills', 'file-a-source', 'SKILL.md'), 'utf8');
  assert.equal(now, `${read.text.slice(0, read.text.length - read.body.length)}# Filing a source\n\nAsk once, then file.\n`);
  const [line] = (await person.history({ node: 'skill/file-a-source' })).changes;
  assert.deepEqual([line.op, line.actor, line.before, line.after], ['update', { kind: 'human', name: 'member' }, read.version, done.version]);
  // The version before is kept, and can be read back.
  assert.equal(await person.textAt('skill/file-a-source', read.version), read.text);
  await assert.rejects(person.writeSkill('file-a-source', { body: 'again', replaces: read.version }), refused('Changed'));
  await assert.rejects(agent.writeSkill('file-a-source', { body: 'mine' }), refused('PersonOnly'));
  await assert.rejects(agent.removeSkill('file-a-source'), refused('PersonOnly'));
});

test('the person removes a skill, and it can be restored', async () => {
  const { person } = await fresh();
  const read = await person.readSkill('file-a-source');
  const done = await person.removeSkill('file-a-source', { replaces: read.version });
  assert.equal(done.removed, true);
  assert.deepEqual(await person.listSkills(), []);
  await person.restore({ node: 'skill/file-a-source', version: read.version });
  assert.equal((await person.readSkill('file-a-source')).text, read.text);
});

test('the person turns down a proposed skill, and it is moved aside, not lost', async () => {
  const { dir, agent, person } = await fresh();
  await agent.proposeSkill({ text: '---\nname: short-titles\ndescription: Keep titles short\n---\nThree words.\n' });
  const [waiting] = await person.proposedSkills();
  assert.deepEqual([waiting.name, waiting.by, waiting.files], ['short-titles', 'test-agent', []]);
  await assert.rejects(agent.declineSkill('short-titles'), refused('PersonOnly'));
  await person.declineSkill('short-titles');
  assert.deepEqual(await person.proposedSkills(), []);
  assert.equal((await readdir(join(dir, '.cortex', 'declined', 'skills')))[0].startsWith('short-titles_'), true);
  await assert.rejects(person.declineSkill('short-titles'), refused('NotFound'));
});

test('the person switches a tool on and off; an agent cannot', async () => {
  const { dir, agent, person } = await fresh();
  await writeFile(join(dir, 'tools', 'vault-search.md'), tool(false));
  const read = await person.readTool('vault-search');
  assert.deepEqual([read.on, read.description], [false, 'Searches the vault']);
  await assert.rejects(agent.writeTool('vault-search', { on: true }), refused('PersonOnly'));
  const on = await person.writeTool('vault-search', { on: true, replaces: read.version });
  assert.equal((await person.readTool('vault-search')).on, true);
  assert.deepEqual((await person.start()).tools, [{ name: 'vault-search', description: 'Searches the vault' }]);
  const [line] = (await person.history({ node: 'tool/vault-search' })).changes;
  assert.deepEqual([line.reason, line.actor.kind, line.after], ['switched on', 'human', on.version]);
  // What it says changes apart from whether it is on.
  await person.writeTool('vault-search', { body: 'Searches by words.', replaces: on.version });
  const now = await person.readTool('vault-search');
  assert.deepEqual([now.on, now.body.trim()], [true, 'Searches by words.']);
  await assert.rejects(person.writeTool('vault-search', { on: false, replaces: on.version }), refused('Changed'));
});

test('tools agents asked for are listed for the person', async () => {
  const { agent, person } = await fresh();
  await agent.proposeTool({ name: 'send-mail', description: 'Sends a mail', inputs: 'to, text', outputs: 'sent' });
  const [asked] = await person.proposedTools();
  assert.deepEqual([asked.name, asked.description, asked.by], ['send-mail', 'Sends a mail', 'test-agent']);
});
