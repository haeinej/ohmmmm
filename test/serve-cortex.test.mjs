// The person's cortex through the bridge (home/cortex-routes.mjs, docs/serve.md): read whole, changed
// only over the version read, every change kept and journaled as the person's, an agent in the page's
// observation written as that agent's. Every person here is invented.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { initHome } from '../bin/ohmmmm.mjs';
import { addAgent, homeBridge, listenHome, pairApp } from '../home/serve.mjs';
import { openCortex } from '../cortex/src/folder.mjs';
import { newNodeId } from '../vault/vault/node.mjs';

async function setUp(t) {
  const parent = await mkdtemp(join(tmpdir(), 'ohmmmm-cortex-'));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const layout = await initHome(parent, 'mira.example.com');
  const walk = newNodeId();
  await mkdir(join(layout.vault, 'notes'), { recursive: true });
  await writeFile(join(layout.vault, 'notes/walk.md'), `---\nid: ${walk}\ntitle: Slow walk\n---\n\nYanaka, lanterns, cats.\n`);
  const token = await pairApp(layout.home);
  const agent = await addAgent(layout.home, 'helper');
  const server = await listenHome(homeBridge({ layout, DatabaseSync }), { port: 0 });
  t.after(() => new Promise(done => { server.closeAllConnections(); server.close(done); }));
  const port = server.address().port;
  const call = (method, path, { headers = {}, body } = {}) => new Promise((done, fail) => {
    const req = request({ host: '127.0.0.1', port, method, path, headers: { Host: `127.0.0.1:${port}`, Authorization: `Bearer ${token}`, ...headers } }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        done({ status: res.statusCode, json: /json/.test(res.headers['content-type'] ?? '') ? JSON.parse(raw) : undefined });
      });
    });
    req.on('error', fail);
    req.end(body);
  });
  const asJson = (version, value) => ({ headers: { 'Content-Type': 'application/json', ...(version === null ? { 'If-None-Match': '*' } : version ? { 'If-Match': `"${version}"` } : {}) }, body: JSON.stringify(value) });
  const journal = async () => (await readFile(join(layout.cortex, '.cortex', 'journal.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  return { layout, walk, call, asJson, journal, agent };
}

test('the app reads the cortex whole: profile, observations, skills, tools, and what waits', async t => {
  const { layout, call, agent: agentKeyText } = await setUp(t);
  const agent = openCortex(layout.cortex, { actor: 'claude-code' });
  await agent.observe({ id: 'titles-short', text: 'Keeps titles to three words.' });
  await agent.proposeProfile({ heading: 'Preferences', line: 'Titles stay short.' });
  await agent.proposeSkill({ text: '---\nname: short-titles\ndescription: Keep titles short\n---\nThree words.\n' });
  await writeFile(join(layout.cortex, 'tools', 'vault-search.md'), '---\nname: "vault-search"\ndescription: "Searches the vault"\non: false\n---\n\nSearches by text.\n');
  const { status, json } = await call('GET', '/cortex/parts');
  assert.equal(status, 200);
  assert.match(json.profile.text, /## Preferences/);
  assert.match(json.profile.version, /^c[0-9a-f]{64}$/);
  assert.deepEqual(json.observations.map(each => [each.id, each.by, each.text]), [['titles-short', 'claude-code', 'Keeps titles to three words.']]);
  assert.deepEqual(json.proposals.map(each => [each.heading, each.line, each.by]), [['Preferences', 'Titles stay short.', 'claude-code']]);
  assert.deepEqual(json.skills.map(each => each.name), ['file-a-source']);
  assert.deepEqual(json.proposedSkills.map(each => [each.name, each.by]), [['short-titles', 'claude-code']]);
  assert.deepEqual(json.tools.map(each => [each.name, each.on]), [['vault-search', false]]);
  // Without a key, nothing; with an agent's key, not the person's cortex routes either.
  assert.equal((await call('GET', '/cortex/parts', { headers: { Authorization: 'Bearer wrong' } })).status, 401);
  assert.equal((await call('GET', '/cortex/parts', { headers: { Authorization: `Bearer ${agentKeyText}` } })).status, 403);
  assert.equal((await call('PUT', '/cortex/profile', { headers: { Authorization: `Bearer ${agentKeyText}`, 'If-Match': `"${json.profile.version}"` }, body: 'An agent\'s profile' })).status, 403);
});

test('the person edits the profile only over the version read, and accepts or declines a line', async t => {
  const { layout, call, journal } = await setUp(t);
  const { json: parts } = await call('GET', '/cortex/parts');
  assert.equal((await call('PUT', '/cortex/profile', { body: '## Preferences\n\n- Short paragraphs.' })).status, 428);
  const done = await call('PUT', '/cortex/profile', { headers: { 'If-Match': `"${parts.profile.version}"` }, body: '## Preferences\n\n- Short paragraphs.' });
  assert.equal(done.status, 200);
  assert.match(await readFile(join(layout.cortex, 'profile.md'), 'utf8'), /- Short paragraphs\.\n$/);
  const stale = await call('PUT', '/cortex/profile', { headers: { 'If-Match': `"${parts.profile.version}"` }, body: 'Over it' });
  assert.deepEqual([stale.status, stale.json.version], [412, done.json.version]);
  const last = (await journal()).at(-1);
  assert.deepEqual([last.node, last.actor, last.before, last.after], ['profile', { kind: 'human', name: 'member' }, parts.profile.version, done.json.version]);

  const agent = openCortex(layout.cortex, { actor: 'codex' });
  const { id } = await agent.proposeProfile({ heading: 'Goals', line: 'Ship the workspace.' });
  const accepted = await call('POST', `/cortex/profile/${id}`, { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accept: true }) });
  assert.equal(accepted.json.accepted, true);
  assert.match(await readFile(join(layout.cortex, 'profile.md'), 'utf8'), /## Goals\n\n- Ship the workspace\./);
  const { id: other } = await agent.proposeProfile({ heading: 'Notes', line: 'Likes rain.' });
  await call('POST', `/cortex/profile/${other}`, { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accept: false }) });
  assert.deepEqual((await call('GET', '/cortex/parts')).json.proposals, []);
  assert.equal((await call('POST', `/cortex/profile/${other}`, { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accept: true }) })).status, 404);
});

test('the person writes, edits, pins and forgets observations; what they are about must be in the vault', async t => {
  const { layout, walk, call, asJson, journal } = await setUp(t);
  const made = await call('PUT', '/cortex/observation?id=you-walks', asJson(null, { text: 'Walks before writing.', about: [walk] }));
  assert.equal(made.status, 201);
  const file = await readFile(join(layout.cortex, 'observations', 'you-walks.md'), 'utf8');
  assert.match(file, /by: "you"/);
  assert.match(file, new RegExp(`about: \\["${walk}"\\]`));
  assert.equal((await call('PUT', '/cortex/observation?id=you-gone', asJson(null, { text: 'About nothing there.', about: [newNodeId()] }))).status, 404);
  assert.equal((await call('PUT', '/cortex/observation?id=you-walks', { body: '{}' })).status, 428);
  const pinned = await call('PUT', '/cortex/observation?id=you-walks', asJson(made.json.version, { text: 'Walks before writing, most mornings.', about: [walk], pin: true }));
  assert.equal(pinned.status, 200);
  assert.equal((await call('PUT', '/cortex/observation?id=you-walks', asJson(made.json.version, { text: 'Stale.' }))).status, 412);
  const forgot = await call('DELETE', '/cortex/observation?id=you-walks', { headers: { 'If-Match': `"${pinned.json.version}"` } });
  assert.equal(forgot.json.removed, true);
  assert.deepEqual((await journal()).filter(line => line.node !== 'profile').map(line => [line.node, line.op, line.actor.name]), [['observation/you-walks', 'create', 'member'], ['observation/you-walks', 'update', 'member'], ['observation/you-walks', 'remove', 'member']]);
  // Kept, and its earlier versions read back through the journal route.
  const { json: history } = await call('GET', '/cortex/journal');
  assert.match(history.texts[pinned.json.version], /most mornings/);
});

test('an agent in the page writes a new observation as its own, once the person approved it', async t => {
  const { call, asJson, journal } = await setUp(t);
  const done = await call('PUT', '/cortex/observation?id=page-1', asJson(null, { text: 'Prefers lists to tables.', agent: 'Muse', why: 'Asked for a list twice' }));
  assert.equal(done.status, 201);
  const last = (await journal()).at(-1);
  assert.deepEqual([last.actor, last.reason], [{ kind: 'agent', name: 'Muse' }, 'approved by the person in the app: Asked for a list twice']);
  // Never a rewrite, never a pin, and never under a person's name.
  assert.equal((await call('PUT', '/cortex/observation?id=page-1', asJson(done.json.version, { text: 'Rewritten.', agent: 'Muse' }))).status, 400);
  assert.equal((await call('PUT', '/cortex/observation?id=page-2', asJson(null, { text: 'Pinned.', agent: 'Muse', pin: true }))).status, 400);
  await call('PUT', '/cortex/observation?id=page-3', asJson(null, { text: 'As the person.', agent: 'member' }));
  assert.deepEqual((await journal()).at(-1).actor, { kind: 'agent', name: 'agent:member' });
});

test('the person edits, removes, approves and declines skills, and switches tools', async t => {
  const { layout, call, asJson, journal } = await setUp(t);
  const { json: parts } = await call('GET', '/cortex/parts');
  const skill = parts.skills[0];
  const edited = await call('PUT', '/cortex/skill?name=file-a-source', { headers: { 'If-Match': `"${skill.version}"` }, body: '# Filing\n\nAsk once.' });
  assert.equal(edited.status, 200);
  assert.match(await readFile(join(layout.cortex, 'skills', 'file-a-source', 'SKILL.md'), 'utf8'), /^---\nname: file-a-source[\s\S]*---\n# Filing\n\nAsk once\.\n$/);
  assert.equal((await call('DELETE', '/cortex/skill?name=file-a-source', { headers: { 'If-Match': `"${skill.version}"` } })).status, 412);
  assert.equal((await call('DELETE', '/cortex/skill?name=file-a-source', { headers: { 'If-Match': `"${edited.json.version}"` } })).json.removed, true);

  const agent = openCortex(layout.cortex, { actor: 'codex' });
  await agent.proposeSkill({ text: '---\nname: short-titles\ndescription: Keep titles short\n---\nThree words.\n' });
  await agent.proposeSkill({ text: '---\nname: long-titles\ndescription: Make titles long\n---\nTen words.\n' });
  assert.equal((await call('POST', '/cortex/skills/short-titles', asJson(undefined, { approve: true }))).json.approved, true);
  assert.equal((await call('POST', '/cortex/skills/long-titles', asJson(undefined, { approve: false }))).json.declined, true);
  const after = (await call('GET', '/cortex/parts')).json;
  assert.deepEqual([after.skills.map(each => each.name), after.proposedSkills], [['short-titles'], []]);

  await writeFile(join(layout.cortex, 'tools', 'vault-search.md'), '---\nname: "vault-search"\ndescription: "Searches the vault"\non: false\n---\n\nSearches by text.\n');
  const tool = (await call('GET', '/cortex/parts')).json.tools[0];
  const on = await call('PUT', '/cortex/tool?name=vault-search', asJson(tool.version, { on: true }));
  assert.equal(on.status, 200);
  assert.equal((await call('GET', '/cortex/parts')).json.tools[0].on, true);
  const lines = await journal();
  assert.deepEqual(lines.slice(-1).map(line => [line.node, line.reason, line.actor.name]), [['tool/vault-search', 'switched on', 'member']]);
  assert.equal(lines.filter(line => line.node === 'skill/short-titles' && line.reason === 'approved' && line.proposedBy === 'codex').length, 1);
});

test('the cortex journal route gives changes and sessions with the texts of their versions', async t => {
  const { layout, call } = await setUp(t);
  const agent = openCortex(layout.cortex, { actor: 'claude-code' });
  const made = await agent.observe({ id: 'rain', text: 'Writes more on rainy days.' });
  await agent.recordSession({ summary: 'Noted the rain', made: [made.change], deadEnds: [{ tried: 'Filing it under weather', why: 'There is no such channel' }] });
  const { json } = await call('GET', '/cortex/journal?limit=50');
  assert.deepEqual(json.changes.filter(line => line.node !== 'profile').map(line => [line.node, line.op, line.actor.name]), [['observation/rain', 'create', 'claude-code']]);
  assert.match(json.texts[made.version], /Writes more on rainy days\./);
  assert.deepEqual(json.sessions.map(line => [line.summary, line.made, line.deadEnds[0].tried]), [['Noted the rain', [made.change], 'Filing it under weather']]);
  assert.equal((await call('GET', '/cortex/journal?limit=0')).status, 400);
  assert.equal((await call('GET', '/cortex/nothing')).status, 404);
});
