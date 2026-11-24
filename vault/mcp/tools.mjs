// What an agent can do in a person's vault. Each tool is one thing an agent would decide to do,
// and each is a thin call onto the vault service (service/CAPABILITIES.md): nothing a tool does
// lives only here, so a post saved by an agent is exactly a post saved in the editor.
//
// Reading is free. Anything that changes a post other people are meant to see, or removes one,
// takes two calls: the first says exactly what would happen and returns a `confirm` value, and
// only a second call carrying that value does it. The person sees the first answer before the
// second is made.
import { createHmac, randomBytes } from 'node:crypto';
import { carryOut } from '../service/public/vault/publish.js';
import { VISIBILITIES, VaultProblem } from '../vault/core.mjs';
import { isPostId, postFile } from '../vault/file.mjs';
import { whyNot } from '../vault/visibility.mjs';
import { readNode } from '../vault/node.mjs';

const refuse = message => { throw new VaultProblem(message); };
const text = { type: 'string' };
const which = { type: 'string', description: "The post's slug, or its ID." };
const sharedLayers = ['public', 'friends'];
const isShared = post => sharedLayers.includes(post?.visibility);
const fields = (properties, required = []) => ({ type: 'object', properties, required });
const block = fields({ id: text, path: text, text }, ['id', 'path', 'text']);
const publicRemovals = status => status.remove.map(({ key }) => ({ key, why: 'The published record will be taken down.' }));

// Each tool, with the requests of the vault service it is made of.
export const TOOLS = [
  {
    name: 'vault_tree',
    description: "The structure of the person's vault: its labels, the sublabels inside them, and each post with who can see it. Start here to learn what the vault holds.",
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
    requests: ['getTree'],
  },
  {
    name: 'vault_list',
    description: 'List posts, newest first, optionally only those under a label or sublabel, at one visibility, or from one platform.',
    inputSchema: { type: 'object', properties: {
      label: text, sublabel: text, visibility: { type: 'string', enum: sharedLayers },
      platform: { type: 'string', description: 'Where a post first appeared, such as bluesky. "own" for posts that first appeared nowhere else.' },
      limit: { type: 'integer', minimum: 1, maximum: 200 },
    } },
    annotations: { readOnlyHint: true },
    requests: ['getTree'],
  },
  {
    name: 'vault_read',
    description: 'Read one post in full, with its version. The version is needed to save changes to it.',
    inputSchema: { type: 'object', properties: { key: which }, required: ['key'] },
    annotations: { readOnlyHint: true },
    requests: ['getTree', 'getPost'],
  },
  {
    name: 'vault_search',
    description: "Search the person's public and friends-only posts. Returns the best matches with a passage from each.",
    inputSchema: { type: 'object', properties: {
      query: text, visibility: { type: 'string', enum: sharedLayers }, limit: { type: 'integer', minimum: 1, maximum: 50 },
    }, required: ['query'] },
    annotations: { readOnlyHint: true },
    requests: ['searchPosts'],
  },
  {
    name: 'vault_save',
    description: 'Change an existing public or friends-only post. Pass the version vault_read gave. Fields left out stay as they are. Takes two calls. Use vault_capture to add a private block on the device.',
    inputSchema: { type: 'object', properties: {
      key: which,
      body: { type: 'string', description: 'Markdown. A picture or file is placed by its address: ![description](https://…).' },
      title: { type: 'string', description: 'Leave out for a post with no title. Pass an empty string to remove one.' },
      subtitle: text,
      label: { type: 'string', description: "The section of the person's site the post belongs to, in their own words." },
      sublabel: { type: 'string', description: 'A group inside the label, such as a series.' },
      slug: { type: 'string', description: 'A new slug for a post that exists. Changing it changes the post\'s address; it is still the same post.' },
      date: { type: 'string', description: 'When it was published, as a date. Now, if left out for a new post.' },
      connect: { type: 'array', items: text, description: 'What this post branches from: slugs of other posts, AT URIs, or web addresses.' },
      version: { type: 'string', description: 'The version being replaced. Required to change an existing post.' },
      confirm: text,
    }, required: ['key'] },
    requests: ['getTree', 'getPost', 'putPost'],
  },
  {
    name: 'vault_set_visibility',
    description: 'Move a post or friends-only block to another layer: public, friends or private. Takes two calls; the first says what the move does and who may finish it. Showing it to more people, or taking a published post down, is the person\'s move: the second call sends them a request, which waits in their cockpit. With a write grant on its channel, a move to private hides it from friends at once, and the person\'s device seals it.',
    inputSchema: { type: 'object', properties: { key: { type: 'string', description: "The post's slug or ID, or a friends-only block's ID." }, to: { type: 'string', enum: ['public', 'friends', 'private'] }, reason: { type: 'string', description: 'Why, in a sentence the person will read.' }, confirm: text }, required: ['key', 'to'] },
    requests: ['getTree', 'getPost', 'getBlock', 'previewMove', 'hideBlock', 'requestMove'],
  },
  {
    name: 'vault_status',
    description: "What publishing would change, without changing anything: the posts that would be published for the first time, replaced or taken down, the ones that cannot be published and why, and published records the vault knows nothing about. Use it to answer \"what is not published yet?\".",
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
    requests: ['getPublishPlan'],
  },
  {
    name: 'vault_publish',
    description: "Publish: make what is published in the person's own repository match their vault. Posts marked public are published or replaced, and published posts that are no longer public are taken down. Always takes two calls: the first says exactly what would change; the second, with the confirm value, changes it. Publishing is public the moment it is done, and taking a post down does not recall copies others already made.",
    inputSchema: { type: 'object', properties: { confirm: text } },
    requests: ['getPublishPlan', 'getAttachment'],
  },
  {
    name: 'vault_mirror',
    description: "Bring what the person has already published on their PDS into the vault. Always takes two calls: the first only looks, and says what is there, what would differ from what is published, and what could not be kept; the second, with the confirm value, brings the posts in. It only reads the PDS, never publishes, and never changes a post the person has since changed in the vault. Posts that come with no label land under \"other\" and want filing.",
    inputSchema: { type: 'object', properties: { confirm: text } },
    requests: ['importPublished'],
  },
  {
    name: 'vault_delete',
    description: 'Remove a post for good. Always takes two calls.',
    inputSchema: { type: 'object', properties: { key: which, confirm: text }, required: ['key'] },
    annotations: { destructiveHint: true },
    requests: ['getTree', 'getPost', 'deletePost'],
  },
  {
    name: 'vault_friends_list',
    description: 'List your friends-only blocks. Pass the previous cursor as since to continue or read changes and removals.',
    inputSchema: fields({ since: text }),
    annotations: { readOnlyHint: true },
    requests: ['listBlocks'],
  },
  {
    name: 'vault_friends_read',
    description: 'Read your friends-only block as a Markdown file with its version.',
    inputSchema: fields({ id: text }, ['id']),
    annotations: { readOnlyHint: true },
    requests: ['getBlock'],
  },
  {
    name: 'vault_friends_save',
    description: 'Save a friends-only block as a Markdown file with visibility: friends. Friends can read it as soon as it is saved. Preview, then confirm the exact file and version.',
    inputSchema: fields({ block, replaces: text, confirm: text }, ['block']),
    requests: ['putBlock'],
  },
  {
    name: 'vault_friends_delete',
    description: 'Remove a friends-only block for good. Preview, then confirm with the version being removed.',
    inputSchema: fields({ id: text, replaces: text, confirm: text }, ['id', 'replaces']),
    annotations: { destructiveHint: true },
    requests: ['deleteBlock'],
  },
  {
    name: 'vault_friends_who',
    description: 'List the DIDs that can read your friends layer.',
    inputSchema: fields({}),
    annotations: { readOnlyHint: true },
    requests: ['listFriends'],
  },
  {
    name: 'vault_friends_remove',
    description: 'Take away a DID’s access to your friends layer. Preview and confirm. Copies they already made remain with them.',
    inputSchema: fields({ did: text, confirm: text }, ['did']),
    annotations: { destructiveHint: true },
    requests: ['listFriends', 'removeFriend'],
  },
  {
    name: 'vault_shared_list',
    description: 'List the friends-only blocks and posts an owner shares with your signed-in DID.',
    inputSchema: fields({ owner: text }, ['owner']),
    annotations: { readOnlyHint: true },
    requests: ['listShared'],
  },
  {
    name: 'vault_shared_read',
    description: 'Read a friends-only block or post an owner shares with your signed-in DID.',
    inputSchema: fields({ owner: text, id: text }, ['owner', 'id']),
    annotations: { readOnlyHint: true },
    requests: ['getShared'],
  },
];

// The tools as an agent is told of them: everything above but the requests behind each.
export const OFFERED = TOOLS.map(({ requests, ...tool }) => tool);

// Who a post is for at each visibility. Nothing leaves the vault by being saved: a post marked
// for everyone is published only when the person publishes, which is a step of its own.
const audience = {
  public: 'It is marked for everyone. Saving does not publish it: it reaches the website and other applications only when the person publishes.',
  friends: 'The DIDs the person added to their friends list can read it.',
};

// `vault` reaches the vault service as the person: tree, search, get, put, remove
// (scripts/vault-client.mjs).
export function createTools(options) {
  // `by` is who the tools act as (agent:<name>). `grants`, when the tools run in a home, answers
  // whether the person's .vault/grants.json lets this agent write under a path.
  const { vault, by = 'agent:mcp', grants = null } = options;
  // Every post's line in the tree, each knowing its label and sublabel.
  const lines = async () => (await vault.tree()).labels.flatMap(folder => [
    ...folder.posts.filter(isShared).map(post => ({ ...post, label: folder.label, sublabel: '' })),
    ...folder.sublabels.flatMap(group => group.posts.filter(isShared).map(post => ({ ...post, label: folder.label, sublabel: group.sublabel }))),
  ]);
  const summary = (line, version) => ({
    id: line.id, slug: line.slug, visibility: line.visibility,
    ...(line.title ? { title: line.title } : {}),
    label: line.label, ...(line.sublabel ? { sublabel: line.sublabel } : {}),
    ...(line.form ? { form: line.form } : {}), ...(line.date ? { date: line.date } : {}),
    ...(line.platform ? { platform: line.platform } : {}),
    ...(line.problems?.length ? { cannotBePublishedYet: line.problems } : {}),
    ...(version ? { version } : {}),
  });
  // A post by its slug or its ID, in full, with its line in the tree.
  async function find(key) {
    const line = (await lines()).find(each => each.slug === key || each.id === key);
    if (!line) return null;
    const { post, version } = await vault.get(line.id);
    if (!isShared(post)) return null;
    return { line, post, version };
  }
  const there = async key => await find(key) ?? refuse(`No post uses "${key}".`);
  const saved = async id => {
    const { line, version } = await there(id);
    return summary(line, version);
  };
  // What the vault service refuses is said to the agent in the service's own words.
  const asking = async (act, changed = 'The post has changed since it was read. Read it again before saving.') => {
    try {
      return await act();
    } catch (problem) {
      if (problem instanceof VaultProblem || !problem?.code) throw problem;
      if (problem.code === 'Changed') refuse(changed);
      refuse(problem.message);
    }
  };
  const readSharedFile = async fetch => {
    const result = await asking(fetch);
    const file = result.block;
    if (!file || readNode(file.path, file.text)?.node?.visibility !== 'friends') refuse('There is no friends-only block at that ID.');
    return { block: file, version: result.version };
  };

  // The value a second call must carry: a name for exactly this request against exactly this post.
  const secret = randomBytes(32);
  const token = plan => `c${createHmac('sha256', secret).update(JSON.stringify(plan)).digest('hex').slice(0, 32)}`;
  async function twoSteps(args, plan, willHappen, act) {
    const expected = token(plan);
    if (args.confirm === undefined) return { done: false, willHappen, confirm: expected, next: 'Show this to the person. If they agree, call again with the same values and this confirm value.' };
    if (args.confirm !== expected) refuse('The request has changed since it was shown. Call again without confirm to see what would happen now.');
    return { done: true, ...await act() };
  }

  const calls = {
    async vault_tree() {
      const tree = await vault.tree();
      const labels = tree.labels.map(folder => ({
        label: folder.label, posts: folder.posts.filter(isShared),
        sublabels: folder.sublabels.map(group => ({ sublabel: group.sublabel, posts: group.posts.filter(isShared) }))
          .filter(group => group.posts.length),
      })).filter(folder => folder.posts.length || folder.sublabels.length);
      return { posts: tree.public + tree.friends, public: tree.public, friends: tree.friends, labels };
    },

    async vault_list({ label, sublabel, visibility, platform, limit = 50 }) {
      const same = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
      const found = (await lines()).filter(line => (!visibility || line.visibility === visibility)
        && (!label || same(line.label, label)) && (!sublabel || same(line.sublabel, sublabel))
        && (!platform || same(line.platform ?? 'own', platform)))
        .sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')) || a.slug.localeCompare(b.slug));
      return { found: found.length, posts: found.slice(0, limit).map(line => summary(line)) };
    },

    async vault_read({ key }) {
      const { line, post, version } = await there(key);
      return {
        ...summary(line, version),
        ...(post.subtitle ? { subtitle: post.subtitle } : {}),
        body: post.body,
        ...(post.address ? { address: post.address } : {}),
        ...(post.connect?.length ? { connect: post.connect } : {}),
        ...(post.source ? { source: post.source } : {}),
        ...(post.site ? { site: post.site } : {}),
        ...(Object.keys(post.properties ?? {}).length ? { properties: post.properties } : {}),
      };
    },

    async vault_search({ query, visibility, limit = 10 }) {
      if (!String(query ?? '').trim()) refuse('Give at least one word to search for');
      if (visibility !== undefined && !sharedLayers.includes(visibility)) refuse('Search the public or friends layer here.');
      const answered = await asking(() => vault.search({
        q: String(query), ...(visibility ? { visibility } : {}), excludePrivate: '1', limit: String(limit),
      }));
      const posts = answered.posts.filter(isShared);
      return { found: answered.visibilityScope === 'shared' ? answered.found : posts.length, posts };
    },

    async vault_save(args) {
      const { key } = args;
      const existing = await find(key);
      const given = name => args[name] !== undefined;
      if (!existing) refuse('No public or friends-only post uses that key. To add a private block, use vault_capture on the device.');

      const { line, post: before, version } = existing;
      if (!given('version')) refuse(`A ${before.visibility} post already uses "${key}". Read it with vault_read and pass its version to change it.`);
      if (args.version !== version) refuse(`"${key}" has changed since it was read. Read it again before saving.`);
      // Fields left out stay as they are; an empty title or subtitle removes it.
      const post = { ...before };
      for (const name of ['body', 'label', 'sublabel', 'slug', 'date', 'connect']) if (given(name)) post[name] = name === 'body' ? String(args.body).trim() : args[name];
      for (const name of ['title', 'subtitle']) {
        if (!given(name)) continue;
        if (args[name]) post[name] = args[name]; else delete post[name];
      }
      const changed = ['title', 'subtitle', 'body', 'label', 'sublabel', 'slug', 'date', 'connect'].filter(name => JSON.stringify(post[name]) !== JSON.stringify(before[name]));
      if (!changed.length) return { done: true, unchanged: true, ...summary(line, version) };
      const write = async () => {
        await asking(() => vault.put(post, version));
        return saved(post.id);
      };
      return twoSteps(args, { tool: 'vault_save', id: post.id, from: version, to: post }, {
        post: before.title ?? before.slug, visibility: before.visibility, audience: audience[before.visibility], changes: changed,
      }, write);
    },

    // A move is never made here. The shared rules (vault/visibility.mjs) say who may finish it: a
    // granted agent only starts a move to private; everything else goes to the person as a request.
    async vault_set_visibility(args) {
      const { key, to, reason } = args;
      if (!VISIBILITIES.includes(to)) refuse(`Visibility is one of: ${VISIBILITIES.join(', ')}`);
      if (reason !== undefined && (typeof reason !== 'string' || reason.length > 2000)) refuse('A reason is a sentence or two of text.');
      const found = await find(key);
      const block = found ? null : isPostId(key) ? await asking(() => vault.getBlock(key)).catch(() => null) : null;
      if (!found && !block) refuse(`No post uses "${key}", and no friends-only block has that ID.`);
      const id = found ? found.post.id : key;
      const from = found ? found.post.visibility : 'friends';
      const name = found ? found.post.title ?? found.post.slug : readNode(block.block.path, block.block.text)?.node?.title ?? block.block.path;
      if (from === to) return { done: true, unchanged: true, id, visibility: to };
      const preview = await asking(() => vault.previewMove(id, to));
      const path = found ? postFile(found.post).path : block.block.path;
      const granted = Boolean(await grants?.allowed('write', path));
      const why = whyNot(preview, { actor: by, granted });
      const willHappen = {
        block: name, from, to, action: preview.action, warning: preview.warning,
        ...(preview.needs ? { needs: preview.needs } : {}),
        outcome: why === null ? 'Friends stop reading it now; the person\'s device seals it into the private layer when next unlocked.' : `A request to the person, which waits in their cockpit. ${why}`,
        ...(preview.waiting?.length ? { alreadyAsked: preview.waiting.map(request => ({ id: request.id, to: request.to, asked: request.asked })) } : {}),
      };
      return twoSteps(args, { tool: 'vault_set_visibility', id, from: preview.version, to }, willHappen, async () => {
        if (why === null) {
          const hid = await asking(() => vault.hideBlock({ id, replaces: preview.version, by, ...(reason ? { reason } : {}) }));
          return { hidden: true, since: hid.hidden, next: 'The person\'s device seals it into the private layer when it is next unlocked.' };
        }
        const asked = await asking(() => vault.requestMove({ block: id, store: preview.store, from, to, version: preview.version, by, ...(reason ? { reason } : {}) }));
        return { requested: true, request: asked.request.id, waitsFor: 'the person, in their cockpit', ...(asked.unchanged ? { alreadyWaiting: true } : {}) };
      });
    },

    async vault_status() {
      const { writes, plan, ...status } = await asking(() => vault.publishPlan());
      return { ...status, remove: publicRemovals(status), ...(status.changes ? {} : { note: 'What is published matches the vault.' }) };
    },

    async vault_publish(args) {
      // What would change is worked out afresh on each call, and the confirm value stands for
      // exactly that list: if the vault or the repository changed in between, it is shown again.
      const plan = await asking(() => vault.publishPlan({ prepare: true }));
      const { writes, plan: name, ...status } = plan;
      status.remove = publicRemovals(status);
      if (!status.changes) return { done: true, nothingToPublish: true, ...status, note: 'What is published matches the vault. Nothing to publish.' };
      return twoSteps(args, { tool: 'vault_publish', plan: name }, {
        ...status,
        note: 'These changes are made in the person\'s own repository. A published post is public at once. Taking one down does not recall copies others already made.',
      }, async () => {
        if (plan.repository !== vault.repository) refuse('The vault is one account\'s and the sign-in at the PDS is another\'s. Nothing was published.');
        const made = await asking(() => carryOut(plan, {
          attachment: (write, item) => vault.attachment(write.rkey, item.id),
          upload: vault.upload, apply: vault.apply,
        }));
        return { published: made, ...(status.cannot.length ? { stillCannotBePublished: status.cannot } : {}) };
      });
    },

    async vault_mirror(args) {
      // Approval covers this displayed summary of the current repository. Clean content changes
      // with the same counts/caveats remain allowed; the apply checks its own read's summary.
      const looked = await asking(() => vault.mirror());
      const found = {
        from: looked.site, types: looked.types, records: looked.records, posts: looked.posts,
        ...(looked.differs.length ? { wouldDifferFromWhatIsPublished: looked.differs } : {}),
        ...(looked.lost.length ? { couldNotBeKept: looked.lost } : {}),
        ...(looked.cannotBePublishedYet.length ? { cannotBePublishedYet: looked.cannotBePublishedYet } : {}),
        ...(looked.skipped.length ? { skipped: looked.skipped } : {}),
      };
      return twoSteps(args, { tool: 'vault_mirror', found }, {
        ...found,
        note: 'Posts already in the vault and unchanged are left as they are. A post the person has changed in the vault since is never overwritten. Nothing is published.',
      }, async () => {
        const report = await asking(() => vault.mirror({ apply: true, expectedSummary: looked.summary }), 'What would be brought in changed. Call vault_mirror again without confirm to preview, then confirm the new summary.');
        return {
          broughtIn: report.saved, alreadyThere: report.unchanged.length,
          ...(report.changedThere.length ? { leftAloneBecauseChangedInTheVault: report.changedThere } : {}),
          ...(report.refused.length ? { refused: report.refused } : {}),
          ...(report.lost.length ? { couldNotBeKept: report.lost } : {}),
          next: 'Look at vault_tree. Posts that came with no label are under "other": ask the person where each belongs before filing it.',
        };
      });
    },

    async vault_delete(args) {
      const { line, post, version } = await there(args.key);
      return twoSteps(args, { tool: 'vault_delete', id: post.id, from: version }, {
        post: post.title ?? post.slug, visibility: post.visibility,
        warning: 'The post is removed from the vault for good and cannot be brought back from here.',
      }, async () => {
        await asking(() => vault.remove(post.id, version));
        return { removed: summary(line) };
      });
    },

    vault_friends_list: ({ since }) => asking(() => vault.listBlocks(since)),
    vault_friends_read: ({ id }) => readSharedFile(() => vault.getBlock(id)),

    async vault_friends_save(args) {
      const { block, replaces } = args;
      const parsed = block && typeof block.path === 'string' && typeof block.text === 'string'
        ? readNode(block.path, block.text) : null;
      if (!isPostId(block?.id) || parsed?.node?.type !== 'block' || parsed.node.kind === 'post'
        || parsed.node.visibility !== 'friends' || parsed.problems.length
        || (parsed.node.id && parsed.node.id !== block.id)) {
        refuse('Give a valid block file with its ID and visibility: friends.');
      }
      if (replaces !== undefined && (typeof replaces !== 'string' || !replaces)) refuse('Pass the version being replaced, or omit replaces for a new block.');
      const file = { id: block.id, path: block.path, text: block.text };
      return twoSteps(args, { tool: 'vault_friends_save', file, replaces }, {
        id: file.id, path: file.path, replaces, warning: 'Everyone on the friends list can read this file as soon as it is saved.',
      }, () => asking(() => vault.putBlock(file, replaces), 'The block has changed. Read it again before saving.'));
    },

    async vault_friends_delete(args) {
      const { id, replaces } = args;
      if (!isPostId(id) || typeof replaces !== 'string' || !replaces) refuse('Pass the block ID and the version being removed.');
      return twoSteps(args, { tool: 'vault_friends_delete', id, replaces }, {
        id, replaces, warning: 'This removes the block for good. It cannot recall copies people already made.',
      }, () => asking(() => vault.deleteBlock(id, replaces), 'The block has changed. Read it again before removing it.'));
    },

    vault_friends_who: () => asking(() => vault.listFriends()),

    async vault_friends_remove(args) {
      const { did } = args;
      const { friends } = await asking(() => vault.listFriends());
      const friend = friends.find(each => each.did === did);
      if (!friend) refuse('That DID is not on the friends list.');
      return twoSteps(args, { tool: 'vault_friends_remove', friend }, {
        did, warning: 'This removes access to the friends layer. It cannot recall copies the friend already made.',
      }, () => asking(() => vault.removeFriend(did)));
    },

    vault_shared_list: ({ owner }) => asking(() => vault.listShared(owner)),
    vault_shared_read: ({ owner, id }) => readSharedFile(() => vault.getShared(owner, id)),
  };

  return {
    list: OFFERED,
    async call(name, args = {}) {
      if (!Object.hasOwn(calls, name)) refuse(`There is no tool named ${name}`);
      return calls[name](args);
    },
  };
}
