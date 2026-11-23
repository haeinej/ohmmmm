import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFile, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { initCortex, openCortex } from '../src/folder.mjs';

// Every person here is invented.
const template = fileURLToPath(new URL('../template', import.meta.url));
const cli = fileURLToPath(new URL('../bin/cortex.mjs', import.meta.url));
const fresh = async () => {
  const dir = join(await mkdtemp(join(tmpdir(), 'cortex-')), 'cortex');
  await initCortex(dir, template);
  return dir;
};
// Speaks to `cortex mcp` the way a client does, one JSON message a line, and returns the answers by ID.
const session = (dir, requests, client = 'claude-code') => {
  const lines = [{ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-06-18', clientInfo: { name: client } } }, ...requests.map((request, index) => ({ jsonrpc: '2.0', id: index + 1, ...request }))];
  const output = execFileSync('node', [cli, 'mcp', dir], { input: `${lines.map(line => JSON.stringify(line)).join('\n')}\n`, encoding: 'utf8' });
  return Object.fromEntries(output.trim().split('\n').map(line => JSON.parse(line)).map(message => [message.id, message]));
};
test('a client is told to start with cortex_start, in under 512 characters, and gets the playbook from it', async () => {
  const dir = await fresh();
  await appendFile(join(dir, 'agents', 'AGENTS.md'), '\n- Always answer me in Portuguese.\n');
  const answers = session(dir, [{ method: 'tools/call', params: { name: 'cortex_start', arguments: {} } }]);
  const { instructions, capabilities } = answers[0].result;
  assert.deepEqual(Object.keys(capabilities).sort(), ['prompts', 'resources', 'tools']);
  assert.ok(instructions.length <= 512, `${instructions.length} characters`);
  assert.match(instructions, /Call cortex_start before anything else/);
  assert.match(instructions, /Record what you learn with cortex_observe/);
  const rules = JSON.parse(answers[1].result.content[0].text).rules;
  assert.match(rules, /# How to keep this cortex/);
  assert.match(rules, /Always answer me in Portuguese/);
});

test('the person can pick a prompt to start with their cortex', async () => {
  const dir = await fresh();
  const answers = session(dir, [
    { method: 'prompts/list' },
    { method: 'prompts/get', params: { name: 'start' } },
    { method: 'prompts/get', params: { name: 'nothing' } },
  ]);
  assert.deepEqual(answers[1].result.prompts.map(prompt => prompt.name), ['start']);
  const [message] = answers[2].result.messages;
  assert.equal(message.role, 'user');
  assert.match(message.content.text, /Call cortex_start now/);
  assert.equal(answers[3].error.code, -32602);
});

test('a client can read the cortex as resources, and never a secret', async () => {
  const dir = await fresh();
  await writeFile(join(dir, 'agents', 'secrets', 'calendar.key'), 'not-a-real-key');
  const person = openCortex(dir, { actor: 'member' });
  await person.setAccount('did:plc:example0alice');
  await person.writeProfile('## Preferences\n\n- Titles are four words or fewer\n');
  await openCortex(dir, { actor: 'claude-code' }).observe({ id: 'titles', text: 'Shortens titles to three words.' });
  const answers = session(dir, [
    { method: 'resources/list' },
    { method: 'resources/read', params: { uri: 'cortex://agents/AGENTS.md' } },
    { method: 'resources/read', params: { uri: 'cortex://profile' } },
    { method: 'resources/read', params: { uri: 'cortex://observations' } },
    { method: 'resources/read', params: { uri: 'cortex://observations/titles' } },
    { method: 'resources/read', params: { uri: 'cortex://agents/secrets/calendar.key' } },
    { method: 'resources/read', params: { uri: 'cortex://observations/../agents/secrets/calendar.key' } },
  ]);
  const uris = answers[1].result.resources.map(resource => resource.uri);
  assert.deepEqual(uris.slice(0, 4), ['cortex://agents/AGENTS.md', 'cortex://profile', 'cortex://observations', 'cortex://tools']);
  assert.equal(uris.some(uri => /secret/.test(uri)), false);
  assert.match(answers[2].result.contents[0].text, /# How to keep this cortex/);
  const profile = JSON.parse(answers[3].result.contents[0].text);
  assert.equal(profile.account, 'did:plc:example0alice');
  assert.deepEqual(profile.sections, [{ heading: 'Preferences', lines: ['Titles are four words or fewer'] }]);
  assert.equal(JSON.parse(answers[4].result.contents[0].text)[0].id, 'titles');
  assert.match(answers[5].result.contents[0].text, /three words/);
  assert.equal(answers[6].error.code, -32002);
  assert.equal(answers[7].error.code, -32002);
  assert.doesNotMatch(JSON.stringify(answers), /not-a-real-key/);
});
