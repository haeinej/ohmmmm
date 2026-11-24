// Visibility moves: the rules, in one place, for the cockpit, the vault service and the agent tools.
// A move between layers is a move between stores, never an edit of a field, and every way in asks
// these rules what a move does and who may finish it (vault/plans/standard-site.md, step 2).
//
//   private → friends   share     the device opens the sealed copy and writes the shared one
//   friends → private   seal      the device seals it, then removes the shared copy. An agent with a
//                                 write grant may start it: the shared copy is hidden from friends at
//                                 once and sealed on the device when it is next unlocked
//   any → public        publish   through Publish: a preview of the one document, then the person
//                                 signs at their own PDS. A block with no title waits for one
//   public → any        takedown  through Publish: the record is taken down, then kept in the new place
//
// Showing a block to more people is the member's move and no one else's. An agent that wants one
// asks, and the request waits in the cockpit until the member answers it.
//
// Who may see a block is its layer today. A block shown to a few named people would be a further
// audience here, with its own move; the rules below are written so one can be added.

export const LAYERS = ['private', 'friends', 'public'];
const RANK = Object.fromEntries(LAYERS.map((layer, index) => [layer, index]));

const MOVES = {
  'private>friends': {
    action: 'share', undoable: false,
    warning: 'The vault service and your friends can read the shared copy, and may keep it.',
  },
  'friends>private': {
    action: 'seal', undoable: false,
    warning: 'Friends stop reading it. Copies they or a backup already made may remain.',
  },
  'private>public': {
    action: 'publish', undoable: false,
    warning: 'Publishing makes a public record on your PDS that anyone can read and copy. It is public the moment it is written.',
  },
  'friends>public': {
    action: 'publish', undoable: false,
    warning: 'Publishing makes a public record on your PDS that anyone can read and copy. It is public the moment it is written.',
  },
  'public>friends': {
    action: 'takedown', undoable: false,
    warning: 'Publish takes the record down. Copies others already made are not recalled.',
  },
  'public>private': {
    action: 'takedown', undoable: false,
    warning: 'Publish takes the record down. Copies others already made are not recalled.',
  },
};

export class MoveProblem extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// What moving a block from one layer to another does. `title` is the block's title, when known.
export function planMove({ from, to, title } = {}) {
  if (!LAYERS.includes(from) || !LAYERS.includes(to)) throw new MoveProblem('InvalidMove', `A layer is one of: ${LAYERS.join(', ')}`);
  if (from === to) throw new MoveProblem('InvalidMove', `It is already ${to}.`);
  const move = MOVES[`${from}>${to}`];
  const widens = RANK[to] > RANK[from];
  const needs = move.action === 'publish' && !(typeof title === 'string' && title.trim()) ? ['title'] : [];
  return {
    from, to, action: move.action, widens, undoable: move.undoable, warning: move.warning,
    // Who may finish it. `member` is the person; a granted agent may only start a seal.
    finishes: move.action === 'seal' ? 'member-or-granted-agent' : 'member',
    via: move.action === 'publish' || move.action === 'takedown' ? 'publish' : move.action === 'share' || move.action === 'seal' ? 'device' : 'service',
    ...(needs.length ? { needs } : {}),
  };
}

// Whether `actor` (`me`, or `agent:<name>`) may finish a planned move now. `granted` says whether the
// agent holds a write grant covering the block. Returns null when it may, or why not, in words an
// agent can pass on: it then asks the member instead.
export function whyNot(plan, { actor, granted = false }) {
  if (plan.needs?.length) return `It needs a ${plan.needs.join(' and a ')} before it can be published.`;
  if (actor === 'me') return null;
  if (plan.finishes === 'member-or-granted-agent' && granted) return null;
  if (plan.widens) return 'Only the person shows a block to more people. Ask them: the request waits in their cockpit.';
  if (plan.action === 'takedown') return 'Only the person takes a published block down, through Publish. Ask them.';
  return 'You have no write grant on this block\'s channel. Ask the person, or for the grant.';
}

// A block that is not a post, as the post it becomes when it is moved to public. Every block is the
// same record (a standard.site document); a post is one with an address. The address comes from the
// block's home channel: its first folder is the label, its second the sublabel. `id` is the block's
// vault ID (a TID). The slug is the block's, made safe for an address; the title is required.
export function blockAsPost(node, { id, slugOf }) {
  if (!node || node.type !== 'block') throw new MoveProblem('InvalidMove', 'Only a block can become a post.');
  if (node.post) return { ...node.post, visibility: 'public' };
  const title = typeof node.title === 'string' ? node.title.trim() : '';
  if (!title) throw new MoveProblem('InvalidMove', 'It needs a title before it can be published.');
  const [label = 'other', sublabel = ''] = String(node.home ?? '').split('/').filter(Boolean);
  const slug = slugOf(node.slug || title) || slugOf(title);
  const tags = Array.isArray(node.tags) ? node.tags.filter(tag => typeof tag === 'string' && tag.trim()) : [];
  return {
    id, slug, label, sublabel, visibility: 'public', title,
    body: String(node.body ?? '').trim(),
    ...(node.created ? { date: String(node.created).slice(0, 10) } : {}),
    properties: tags.length ? { tags } : {},
  };
}
