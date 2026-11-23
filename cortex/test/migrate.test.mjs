import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { initCortex, openCortex } from '../src/folder.mjs';

// Every person here is invented. The files are written the way a cortex from before docs/model.md wrote them.
const template = fileURLToPath(new URL('../template', import.meta.url));
const cli = fileURLToPath(new URL('../bin/cortex.mjs', import.meta.url));
const refused = code => problem => problem.code === code;

async function oldCortex() {
  const dir = join(await mkdtemp(join(tmpdir(), 'cortex-')), 'cortex');
  await initCortex(dir, template);
  await rm(join(dir, 'profile.md'));
  await writeFile(join(dir, 'identity.md'), '---\naccount: "did:plc:example0sam"\nname: "Sam Rivera"\nlanguages: ["en","pt"]\nemails: [{"label":"main","address":"sam@example.com"}]\n---\nI write about harbours.\n');
  await mkdir(join(dir, 'memory'));
  await writeFile(join(dir, 'memory', 'MEMORY.md'), '<!-- Generated -->\n- [short-titles](short-titles.md) — Titles of four words or fewer\n');
  await writeFile(join(dir, 'memory', 'short-titles.md'), '---\nname: "short-titles"\ndescription: "Titles of four words or fewer"\nkind: "preference"\nstated: true\nalways: true\nwrittenBy: "codex"\n---\nKeep every title short.');
  await writeFile(join(dir, 'memory', 'maps-and-tides.md'), '---\nname: "maps-and-tides"\ndescription: "The map essay and the tide essay share a walk"\nkind: "reference"\nstated: false\nblocks: ["p1","p2"]\nwrittenBy: "claude-code"\n---\nBoth start at the harbour wall.');
  await writeFile(join(dir, 'vault.md'), '# How to read the vault\n\n## essays\n2 blocks.\nMeaning: Finished long-form writing\nConventions: Titles start with "On"\n\n## notes\n0 blocks.\n');
  await mkdir(join(dir, '.cortex', 'working'), { recursive: true });
  await writeFile(join(dir, '.cortex', 'working', 'codex.md'), 'Open: the reading list.');
  const at = '2026-11-18T10:00:00.000Z';
  const codex = { kind: 'agent', name: 'codex' };
  await writeFile(join(dir, '.cortex', 'journal.jsonl'), [
    { seq: 1, id: 'l1', at, actor: codex, session: 's1', type: 'observation', observation: 'o-waiting', text: 'Drafts on paper first', source: 'codex' },
    { seq: 2, id: 'l2', at, actor: codex, session: 's1', type: 'observation', observation: 'o-settled', text: 'Filed on a Friday', source: 'codex' },
    { seq: 3, id: 'l3', at, actor: codex, type: 'settled', observation: 'o-settled', outcome: 'dropped' },
  ].map(line => JSON.stringify(line)).join('\n') + '\n');
  return dir;
}

test('cortex migrate brings an old cortex to profile and observations, once, keeping everything in history', async () => {
  const dir = await oldCortex();
  await assert.rejects(openCortex(dir, { actor: 'codex' }).migrate(), refused('PersonOnly'));
  const done = JSON.parse(execFileSync('node', [cli, 'migrate', dir], { encoding: 'utf8' }));
  assert.equal(done.profile, true);
  assert.deepEqual(done.observations.sort(), ['channel-essays', 'memory-maps-and-tides', 'memory-short-titles', 'o-waiting']);
  assert.deepEqual(done.removed.sort(), ['identity', 'memory/maps-and-tides', 'memory/short-titles', 'vault.md', 'working/codex']);

  const person = openCortex(dir, { actor: 'member' });
  // identity.md: the account stays the account, and every other field is a line under Notes.
  const profile = await person.profile();
  assert.equal(profile.account, 'did:plc:example0sam');
  assert.deepEqual(profile.sections.find(section => section.heading === 'Notes').lines, ['name: Sam Rivera', 'languages: en, pt', 'emails: sam@example.com', 'I write about harbours.']);
  // A preference they stated waits for them to put it in their profile.
  assert.deepEqual((await person.profileProposals()).map(item => [item.heading, item.line]), [['Preferences', 'Titles of four words or fewer']]);
  // Memories are observations: who wrote them, the blocks they were about, and pinned if they were always shown.
  const observations = Object.fromEntries((await person.observations()).observations.map(item => [item.id, item]));
  assert.deepEqual([observations['memory-short-titles'].by, observations['memory-short-titles'].pin, observations['memory-short-titles'].text], ['codex', true, 'Titles of four words or fewer\n\nKeep every title short.']);
  assert.deepEqual(observations['memory-maps-and-tides'].about, ['p1', 'p2']);
  // What waited in the journal, never settled, is an observation; what was settled is not.
  assert.deepEqual([observations['o-waiting'].by, observations['o-waiting'].text], ['codex', 'Drafts on paper first']);
  assert.equal(observations['o-settled'], undefined);
  // vault.md's words are an observation about the channel.
  assert.deepEqual([observations['channel-essays'].about, observations['channel-essays'].text], [['channel:essays'], 'Means: Finished long-form writing Filed: Titles start with "On"']);
  // The old files are gone from view, and kept.
  assert.deepEqual((await readdir(dir)).filter(name => !name.startsWith('.')).sort(), ['agents', 'memory', 'observations', 'profile.md', 'skills', 'tools']);
  assert.deepEqual(await readdir(join(dir, 'memory')), []);
  assert.ok((await readdir(join(dir, '.cortex', 'history', 'identity', 'identity'))).length);
  assert.match(await readFile(join(dir, '.cortex', 'history', 'memory', 'short-titles', (await readdir(join(dir, '.cortex', 'history', 'memory', 'short-titles')))[0]), 'utf8'), /Keep every title short/);
  // Every step is the person's change.
  assert.ok((await person.history({ limit: 500 })).changes.every(line => line.actor.name === 'member'));

  // Run again, it finds nothing left to do.
  const again = JSON.parse(execFileSync('node', [cli, 'migrate', dir], { encoding: 'utf8' }));
  assert.deepEqual(again, { profile: false, observations: [], proposals: [], removed: [] });
});
