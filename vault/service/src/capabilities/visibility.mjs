// Visibility: moving a block between layers (../visibility.mjs and the shared rules in
// ../../../vault/visibility.mjs). The service never makes a move inside the private layer: it
// previews, hides a block on its way to private, keeps agents' requests, and journals every move.
export default {
  name: 'Visibility',
  about: 'Moves between the public, friends and private layers, by one set of rules the cockpit and the agent tools share. Every move is previewed first and journalled with who asked, who approved and why; the journal names a block by its ID only. Showing a block to more people is the member\'s move: an agent asks, and its request waits in the cockpit until the member answers. An agent with a write grant may start a move to private, which hides the block from friends at once; the member\'s device seals it when next unlocked. Public is reached only through Publish.',
  requests: {
    'com.ohmmmm.vault.previewMove': {
      verb: 'GET', asks: 'member', changes: false,
      about: 'What moving one block to another layer would do: the action, whether it shows the block to more people, the warning, who may finish it, what it still needs (a title, to be published), and any request already waiting. A private block is named by its opaque ID with `from=private`.',
      takes: { id: 'the block\'s or post\'s ID', to: 'public, friends or private', from: 'optional: `private` for a sealed block' },
      gives: '`id`, `from`, `to`, `action`, `widens`, `warning`, `finishes`, `via`, `needs`, `store`, `version`, `leaving`, `waiting`',
      run: ({ url, moves, did }) => moves.preview(did, { id: url.searchParams.get('id'), from: url.searchParams.get('from') ?? undefined, to: url.searchParams.get('to') }),
    },
    'com.ohmmmm.vault.hideBlock': {
      verb: 'POST', asks: 'member', changes: true,
      about: 'Starts a move to private for a friends-only block or post: from now on no friend and no site reads it, and the member\'s device seals it into the private layer when next unlocked. The agent tools call it only with the agent\'s write grant on the block\'s channel. Sent twice, it changes nothing more.',
      takes: { id: 'the block\'s or post\'s ID', replaces: 'the version read', by: 'me, or agent:<name>', reason: 'optional: why' },
      gives: '`id`, `hidden` (when), and `unchanged` when it was hidden already',
      run: async ({ body, moves, did }) => moves.hide(did, await body()),
    },
    'com.ohmmmm.vault.requestMove': {
      verb: 'POST', asks: 'member', changes: true,
      about: 'An agent asks the member for a move it may not finish, such as showing a block to more people. The request waits in the cockpit until the member approves or declines it; nothing moves until then. One request waits per block and layer.',
      takes: { block: 'the block\'s ID (opaque for a private block)', store: 'block, post or sealed', from: 'its layer now', to: 'the layer asked for', version: 'optional: the version read', by: 'agent:<name>', reason: 'optional: why, shown to the member' },
      gives: '`request` (id, block, store, from, to, version, askedBy, reason, asked, state), and `unchanged` when one was waiting already',
      run: async ({ body, moves, did }) => moves.request(did, await body()),
    },
    'com.ohmmmm.vault.listMoveRequests': {
      verb: 'GET', asks: 'member', changes: false,
      about: 'Agents\' requests for moves, oldest first: those waiting, or those approved or declined.',
      takes: { state: 'optional: waiting (the default), approved or declined' },
      gives: '`requests`',
      run: ({ url, moves, did }) => moves.requests(did, { state: url.searchParams.get('state') ?? undefined }),
    },
    'com.ohmmmm.vault.declineMoveRequest': {
      verb: 'POST', asks: 'ohm', changes: true,
      about: 'The member declines an agent\'s request. Nothing moves. Only the member, signed in to ohm, answers a request.',
      takes: { id: 'the request\'s ID', reason: 'optional: why' },
      gives: '`id`, `declined`',
      run: async ({ body, moves, did }) => moves.decline(did, await body()),
    },
    'com.ohmmmm.vault.recordMove': {
      verb: 'POST', asks: 'ohm', changes: true,
      about: 'The member\'s cockpit records a move it made, after the member approved it: a request it answers, a hidden block it sealed, or a move to or from public it handed to Publish. Only the member, signed in to ohm, records a move.',
      takes: { block: 'the block\'s ID before the move', from: 'its layer before', to: 'its layer after', request: 'optional: the request this answers', sealedAs: 'optional: its opaque ID in the private layer', cleanupPending: 'optional: true when the old copy could not be removed', reason: 'optional: why' },
      gives: '`block`, `from`, `to`, `state` (done, cleanup-pending, or previewed for Publish), and `approved` with the request',
      run: async ({ body, moves, did }) => moves.record(did, await body()),
    },
    'com.ohmmmm.vault.listMoves': {
      verb: 'GET', asks: 'member', changes: false,
      about: 'The journal of visibility moves, newest first: each block by its ID, from and to which layer, the action, how it stands, who asked, who approved and why. No titles or text.',
      takes: { since: 'optional: a `seq`, for only what came after it', limit: 'optional: up to 500' },
      gives: '`moves` (seq, at, block, from, to, action, state, askedBy, approvedBy, reason, request)',
      run: ({ url, moves, did }) => moves.moves(did, { since: url.searchParams.get('since') ?? undefined, limit: url.searchParams.get('limit') ?? undefined }),
    },
  },
};
