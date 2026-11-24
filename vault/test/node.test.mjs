import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { filePost, postFile } from '../vault/file.mjs';
import {
  BLOCK_FIELDS, BLOCK_KINDS, CHANNEL_FIELDS, CHANNEL_KINDS, ENTITY_FIELDS, ENTITY_KINDS, evidence, inferKind, newNodeId,
  nodeFile, nodeKey, originKind, readNode, readVault, RETAIN, SOURCE_FIELDS, SOURCE_KINDS, VISIBILITIES,
} from '../vault/node.mjs';

const lexicon = async name => JSON.parse(await readFile(new URL(`../lexicons/com/ohmmmm/vault/${name}.json`, import.meta.url), 'utf8'));
const ID = { a: '3mzocqfoc22if', b: '3mzocqfoczc72', c: '3mzocqfodyk7n', s: '3mzocqfoexsai', e: '3mzocqfofx2k3', ch: '3mzocqfogwcum' };

test('each vault lexicon declares exactly the fields its file holds, with the same known values', async () => {
  const block = (await lexicon('block')).defs;
  assert.equal(block.main.key, 'tid');
  assert.deepEqual(Object.keys(block.main.record.properties).sort(), [...BLOCK_FIELDS.filter(field => field !== 'slug'), 'body'].sort());
  assert.deepEqual(block.main.record.properties.kind.knownValues, BLOCK_KINDS);
  assert.deepEqual(block.main.record.properties.visibility.knownValues, VISIBILITIES);
  const channel = (await lexicon('channel')).defs.main.record.properties;
  assert.deepEqual(Object.keys(channel).sort(), [...CHANNEL_FIELDS, 'description'].sort());
  assert.deepEqual(channel.kind.knownValues, CHANNEL_KINDS);
  const entity = (await lexicon('entity')).defs.main.record.properties;
  assert.deepEqual(Object.keys(entity).sort(), [...ENTITY_FIELDS, 'kind', 'body'].sort());
  assert.deepEqual(entity.kind.knownValues, ENTITY_KINDS);
  const source = (await lexicon('source')).defs.main.record.properties;
  assert.deepEqual(Object.keys(source).sort(), [...SOURCE_FIELDS].sort());
  assert.deepEqual(source.kind.knownValues, SOURCE_KINDS);
  assert.deepEqual(source.retain.knownValues, RETAIN);
  for (const name of ['block', 'channel', 'entity', 'source']) assert.equal((await lexicon(name)).id, `com.ohmmmm.vault.${name}`);
});

test('a block is read from its content when its kind is not given', () => {
  assert.equal(inferKind('Some thoughts.'), 'text');
  assert.equal(inferKind('```sql\nselect 1;\n```'), 'code');
  assert.equal(inferKind('```sql\nselect 1;\n```\n\nand a note'), 'text');
  assert.equal(inferKind('![[churn.sql]]'), 'file');
  assert.equal(inferKind('![[photo.jpg|a caption]]'), 'media');
  assert.equal(inferKind('https://example.com/page'), 'link');
});

test('an origin is a local path, a Google Drive path, an address or an AT URI', () => {
  assert.equal(originKind('~/work/queries/churn.sql'), 'local');
  assert.equal(originKind('/Users/example/notes/a.md'), 'local');
  assert.equal(originKind('gdrive:My Drive/Research/paper.pdf'), 'drive');
  assert.equal(originKind('/Users/example/Library/CloudStorage/GoogleDrive-example@example.com/My Drive/a.pdf'), 'drive');
  assert.equal(originKind('https://example.com/a'), 'web');
  assert.equal(originKind('at://did:plc:example/com.ohmmmm.post/abc'), 'atproto');
  assert.equal(originKind('queries/churn.sql'), null);
  assert.equal(readNode('a/b.md', '---\norigin: churn.sql\n---\n\nx').problems.length, 1);
});

test('a block, a channel, an entity and a source each read back from their file as the same node', () => {
  const block = readNode('analytics/churn-query.md', [
    '---', 'kind: code', 'title: Q3 churn query', 'channels: [sql-snippets, analytics]', 'origin: ~/work/queries/churn.sql',
    `from: ${ID.s}`, 'excerpt: {"quote": "joins on account_id", "position": 12}', 'tags: [retention, "#board"]', 'by: agent:claude',
    'status: kept', 'visibility: friends', 'created: 2026-11-19', 'mood: tired', `id: ${ID.a}`, '---', '',
    'What I used for the board review.', '', '```sql', 'select 1;', '```', '', '![[churn.sql]]',
  ].join('\n'));
  assert.deepEqual(block.problems, []);
  const node = block.node;
  assert.equal(node.kind, 'code');
  assert.equal(node.home, 'analytics');
  assert.equal(node.slug, 'churn-query');
  // The home channel is not repeated in channels.
  assert.deepEqual(node.channels, ['sql-snippets']);
  assert.deepEqual(node.tags, ['retention', 'board']);
  assert.deepEqual(node.properties, { mood: 'tired' });
  assert.equal(node.visibility, 'friends');
  const again = nodeFile(node);
  assert.equal(again.path, 'analytics/churn-query.md');
  assert.deepEqual(readNode(again.path, again.text).node, node);

  // A block whose kind is what its content shows does not write it, and one that does not say is private.
  const plain = readNode('ideas/seed.md', 'An idea.\n').node;
  assert.equal(plain.kind, 'text');
  assert.equal(plain.visibility, 'private');
  assert.doesNotMatch(nodeFile(plain).text, /kind/);
  assert.equal(nodeFile(plain).text, 'An idea.\n');
  // A file named in words keeps its name, and its slug is made from it.
  const named = readNode('ideas/Trap of Independency.md', 'x').node;
  assert.equal(named.slug, 'trap-of-independency');
  assert.deepEqual(readNode(nodeFile(named).path, nodeFile(named).text).node, named);

  const channel = readNode('writing/collisions/_channel.md', `---\ntitle: Collisions\nkind: concept\norder: [ep-02, ep-01]\nsite: {"label": "Writings", "sublabel": "Collisions"}\nid: ${ID.ch}\n---\n\nWhere two ideas meet.\n`);
  assert.deepEqual(channel.problems, []);
  assert.equal(channel.node.path, 'writing/collisions');
  assert.equal(nodeFile(channel.node).path, 'writing/collisions/_channel.md');
  assert.deepEqual(readNode('writing/collisions/_channel.md', nodeFile(channel.node).text).node, channel.node);

  const entity = readNode('_entities/person/ada-lovelace.md', `---\nname: Ada Lovelace\naliases: [ada, "@ada.example.com"]\nuri: https://www.wikidata.org/wiki/Q7259\nid: ${ID.e}\n---\n\nWrote the first program.\n`);
  assert.deepEqual(entity.problems, []);
  assert.deepEqual(readNode(nodeFile(entity.node).path, nodeFile(entity.node).text).node, entity.node);

  const source = readNode(`_sources/${ID.s}/source.json`, JSON.stringify({ kind: 'page', uri: 'https://example.com/a', platform: 'website', capturedAt: '2026-11-19T00:00:00.000Z', retain: 'text', meta: { lang: 'en' } }));
  assert.deepEqual(source.problems, []);
  assert.equal(nodeFile(source.node).path, `_sources/${ID.s}/source.json`);
  assert.deepEqual(readNode(nodeFile(source.node).path, nodeFile(source.node).text).node, source.node);
  assert.match(readNode(`_sources/${ID.s}/source.json`, '{"kind":"page","uri":"x","capturedAt":"2026-11-19","extra":1}').problems.join(), /under meta: extra/);
});

test('files that are not nodes are left alone', () => {
  for (const path of ['.obsidian/app.json', 'analytics/churn.sql', '_channel.md', '_attachments/a.md', 'a/.hidden/b.md', `_sources/${ID.s}/extracted.md`, 'notes/_draft.md']) {
    assert.equal(readNode(path, 'x'), null, path);
  }
});

test('a file that is a post is read as a post block, and written back exactly as a post', () => {
  const post = { id: ID.b, slug: 'trap-of-independency', label: 'writing', sublabel: '', visibility: 'public', title: 'Trap', date: '2026-11-01', body: 'The words.', properties: {} };
  const file = postFile(post);
  const read = readNode(file.path, file.text);
  assert.deepEqual(read.problems, []);
  assert.equal(read.node.kind, 'post');
  assert.equal(read.node.id, ID.b);
  assert.equal(read.node.home, 'writing');
  assert.deepEqual(read.node.channels, []);
  assert.equal(nodeFile(read.node).text, file.text);
  // Adding it to a second channel keeps it a post the post reader still understands.
  const placed = nodeFile({ ...read.node, channels: ['independence'] });
  assert.match(placed.text, /channels:\n {2}- independence/);
  assert.deepEqual(filePost(placed.path, placed.text).problems, []);
  assert.deepEqual(readNode(placed.path, placed.text).node.channels, ['independence']);
});

test('visibility says which layer a block is in, and a post file is still told from a block', () => {
  // A post file as the post code writes one: visibility, no kind, nothing only a block has.
  const post = readNode('writing/old.md', '---\ntitle: Old\nvisibility: friends\nmood: calm\n---\n\nWords.');
  assert.equal(post.node.kind, 'post');
  assert.equal(post.node.visibility, 'friends');
  // The same with something only a block has is a block, and keeps its layer.
  const block = readNode('writing/new.md', '---\ntitle: New\nvisibility: friends\norigin: ~/notes/new.md\n---\n\nWords.');
  assert.equal(block.node.kind, 'text');
  assert.equal(block.node.visibility, 'friends');
  assert.deepEqual(readNode(nodeFile(block.node).path, nodeFile(block.node).text).node, block.node);
  // A block that says kind is never a post file, whatever else it has.
  assert.equal(readNode('a/b.md', '---\nkind: text\nvisibility: public\n---\n\nx').node.kind, 'text');
  // Made in code, a friends-only block with nothing else says its kind, so it reads back as a block.
  const made = nodeFile({ type: 'block', kind: 'text', home: 'notes', slug: 'shared', title: 'Shared', channels: [], visibility: 'friends', body: 'For friends.', properties: {} });
  assert.match(made.text, /kind: text/);
  assert.equal(readNode(made.path, made.text).node.kind, 'text');
  assert.equal(readNode(made.path, made.text).node.visibility, 'friends');
  // A private block does not write what is already the default.
  assert.doesNotMatch(nodeFile({ type: 'block', kind: 'text', home: 'notes', slug: 'mine', channels: [], visibility: 'private', body: 'Mine.', properties: {} }).text, /visibility|kind/);
  // A layer that does not exist is named, and the block is kept private.
  const odd = readNode('a/c.md', '---\nvisibility: everyone\norigin: ~/c.md\n---\n\nx');
  assert.equal(odd.node.visibility, 'private');
  assert.match(odd.problems.join(), /visibility is one of: public, friends, private/);
  assert.throws(() => nodeFile({ ...block.node, visibility: 'everyone' }), /visibility is one of/);
});

test('reading a whole vault finds every channel, orders its items and names what does not fit', () => {
  const vault = readVault([
    { path: 'writing/_channel.md', text: `---\norder: [second]\nid: ${ID.ch}\n---\n` },
    { path: 'writing/first.md', text: `---\ncreated: 2026-11-01\nid: ${ID.a}\n---\n\none` },
    { path: 'writing/second.md', text: `---\ncreated: 2026-10-01\nid: ${ID.b}\n---\n\ntwo` },
    { path: 'writing/essays/third.md', text: '---\nchannels: [writing, nowhere]\n---\n\nthree' },
    { path: 'other/first.md', text: `---\nfrom: ${ID.s}\nid: ${ID.a}\n---\n\nsame id, same slug` },
    { path: 'analytics/churn.sql', text: 'select 1;' },
  ]);
  assert.deepEqual(vault.channels.map(channel => [channel.path, Boolean(channel.implicit)]),
    [['other', true], ['writing', false], ['writing/essays', true]]);
  // Listed first, then the rest newest first; a channel inside it counts as an item.
  assert.deepEqual(vault.items('writing').map(node => node.slug ?? node.path), ['second', 'first', 'third', 'writing/essays']);
  const said = Object.fromEntries(vault.problems.map(({ path, problems }) => [path, problems.join(' | ')]));
  assert.match(said['writing/essays/third.md'], /"nowhere", which is not a folder/);
  assert.match(said['other/first.md'], /same id as writing\/first\.md/);
  assert.match(said['other/first.md'], /slug "first" is also/);
  assert.match(said['other/first.md'], /not in _sources/);
});

test('evidence is only what the content shows, and says where each edge was read (body lines count from after the properties)', () => {
  const vault = readVault([
    { path: 'writing/_channel.md', text: `---\nid: ${ID.ch}\n---\n` },
    { path: 'writing/essay.md', text: [
      `---\nchannels: [reading]\nid: ${ID.a}\n---`, '',
      'Builds on [[note]] and [[Missing Thing|this]], with @ada and an address [a page](https://example.com/p).',
      '![[chart.png]]', '![[note]]', 'Email me at me@example.com.', '',
      '```md', '[[note]] in code is not a link, nor is @ada', '```', 'Inline `[[note]]` neither.',
    ].join('\n') },
    { path: 'reading/note.md', text: `---\nfrom: ${ID.s}\nexcerpt: {"quote": "the words"}\nid: ${ID.b}\n---\n\nKept.` },
    { path: '_entities/person/ada.md', text: `---\naliases: ["@ada"]\nid: ${ID.e}\n---\n` },
    { path: `_sources/${ID.s}/source.json`, text: JSON.stringify({ kind: 'page', uri: 'https://example.com/s', capturedAt: '2026-11-19' }) },
  ]);
  assert.deepEqual(vault.problems, []);
  const edges = evidence(vault).map(({ kind, from, to, at }) => `${kind} ${from} -> ${to} @${at}`);
  assert.deepEqual(edges.sort(), [
    `contains channel:${ID.ch} -> block:${ID.a} @folder`,
    `contains channel:reading -> block:${ID.a} @channels`,
    `contains channel:reading -> block:${ID.b} @folder`,
    `embeds block:${ID.a} -> block:${ID.b} @3`,
    `embeds block:${ID.a} -> file:chart.png @2`,
    `links block:${ID.a} -> block:${ID.b} @1`,
    `links block:${ID.a} -> missing:Missing Thing @1`,
    `links block:${ID.a} -> url:https://example.com/p @1`,
    `mentions block:${ID.a} -> entity:${ID.e} @1`,
    `quotes block:${ID.b} -> source:${ID.s} @excerpt`,
  ].sort());
  assert.equal(nodeKey({ type: 'block', path: 'a/b.md' }), 'block:a/b.md');
  assert.match(newNodeId(), /^[234567a-j][2-7a-z]{12}$/);
});

test('words the inbox used read as if absent: a proposed block is an ordinary block, an inbox channel a collection', () => {
  const block = readNode('notes/idea.md', '---\nby: agent:helper\nstatus: proposed\n---\n\nAn idea.');
  assert.deepEqual(block.problems, []);
  assert.equal(block.node.status, undefined);
  assert.equal(block.node.by, 'agent:helper');
  assert.equal(block.node.visibility, 'private');
  const channel = readNode('inbox/_channel.md', '---\ntitle: Inbox\nkind: inbox\n---\n\nOld.');
  assert.deepEqual(channel.problems, []);
  assert.equal(channel.node.kind, undefined);
});
