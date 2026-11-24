// Write the reference for what the vault can do, from the same tables the service and the tools
// run on (service/src/capabilities/ and mcp/tools.mjs), so the page cannot say anything they do not.
//
//   node scripts/capabilities.mjs            prints the page
//   node scripts/capabilities.mjs --write    writes service/CAPABILITIES.md
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { TOOLS } from '../mcp/tools.mjs';
import { CAPABILITIES, REQUESTS } from '../service/src/capabilities/index.mjs';

export const PAGE = fileURLToPath(new URL('../service/CAPABILITIES.md', import.meta.url));

// Who may ask a request: what to call them, and how they are known.
const ASKS = {
  nobody: ['Anyone', 'Nothing is checked. Everything such a request answers with is already public'],
  token: ['Whoever holds a token from a PDS', 'A token the PDS issued for this one request and no other, signed with the key the account\'s own DID document names'],
  member: ['The member', 'Such a token from their own PDS, as the command line and an agent\'s tools send; or their ohm session, as the editor sends, which is worth exactly the one account it was connected to'],
  ohm: ['The member, signed in to ohm', 'Their ohm session only. A request that changes something must also come from ohm\'s own pages'],
  viewer: ['Anyone, about the member `did` names', 'Nothing is needed for what the member published. A viewer token (`Authorization: Bearer`, from `content.view`) says who is looking; if the member put them on their friend list, the answer also holds the friends layer. Never the private layer'],
};
const FILES = Object.fromEntries(Object.entries({
  Posts: 'posts', Friends: 'friends', Private: 'private', Visibility: 'visibility', Channels: 'channels', Cortex: 'cortex', Media: 'media', Structure: 'structure', Search: 'search', Mirror: 'mirror', Publish: 'publish', Export: 'export', Content: 'content', Agents: 'agents', Account: 'account', Identity: 'identity',
}).map(([name, file]) => [name, `src/capabilities/${file}.mjs`]));

// Every way the service says no. The same words go to a person in the editor and to an agent.
export const REFUSALS = {
  SignInRequired: [401, 'The request rides on an ohm session, and there is none'],
  AccountChanged: [409, 'The authenticated DID differs from X-Ohm-Did, the member displayed by the editor. Reopen before reading or changing content'],
  AuthRequired: [401, 'The token is missing, cannot be read, was issued for another request or service, has run out, or its signature does not match'],
  NotAMember: [403, 'The account has not been let in yet'],
  WrongOrigin: [403, 'A request that changes something came with a session but not from ohm\'s own pages'],
  NotConnected: [409, 'The ohm account has no AT Protocol account connected yet'],
  AlreadyConnected: [409, 'The ohm account already works in another AT Protocol account'],
  ConnectedElsewhere: [409, 'The AT Protocol account is already connected to another ohm account'],
  SignInUnavailable: [503, 'ohm\'s sign-in could not be reached to check a session'],
  MethodNotFound: [404, 'There is no such request'],
  WrongMethod: [405, 'The request is the other of GET and POST'],
  InvalidRequest: [400, 'The request is not JSON, or something it says is not what that request takes'],
  InvalidPost: [400, 'The post is not one the vault can hold. The message lists every reason'],
  InvalidBlock: [400, 'The block is not one the layer can hold: for the friends layer, it is private or public, a post, or its file has problems; for the private layer, it is not a sealed file under an opaque ID. The message says why'],
  InvalidChannel: [400, 'The channel is not one the service can hold: its path is not a channel\'s path, it is private, or its file has problems. The message says why'],
  InvalidCursor: [400, '`since` is not a value an earlier list returned'],
  NotFound: [404, 'There is no such post, block or saved version, or nothing there is shared with the asker'],
  Changed: [409, 'The post, block, channel or private block has changed since the version the request names. The answer carries the current version'],
  SlugTaken: [409, 'Another post in the vault already has that slug'],
  PathTaken: [409, 'Another block in the friends layer, or another channel, is already at that path'],
  NotEmpty: [409, 'A block or post is filed in the channel, or a channel is inside it. Move them first'],
  HasPosts: [409, 'Published posts are filed in the channel. Their addresses come from their label, which changes through Publish'],
  OlderKey: [409, 'The private block is sealed under an older master key than the member is rotating, or rotated, to'],
  NoRotation: [409, 'No rotation to that generation is under way'],
  RotationAhead: [409, 'The member already rotated to a later master key than the one asked for'],
  RotationRemaining: [409, 'A rotation cannot finish while some kept versions or journal entries are still sealed under the older key. The answer says how many'],
  TooLarge: [413, 'The post or block is more than 600 KB of text, a channel file is more than 200 KB, media is empty or more than 25 MB, a sealed private block is more than 1 MB, or a file it places is empty or larger than 25 MB'],
  FileUnreachable: [502, 'A file a post places could not be fetched from where the post says it is'],
  AccountNotFound: [404, 'No AT Protocol account answers to that handle or DID'],
  NoRepository: [400, 'The account\'s DID document does not say where its repository is kept'],
  RepositoryUnreachable: [502, 'The account\'s PDS would not answer'],
  MediaUnavailable: [503, 'The media cache is not set up on this service'],
  ViewerTokenInvalid: [401, 'The viewer token is not one this service made, is for another member, or has run out'],
  ViewersUnavailable: [503, 'Viewer tokens, and so Friends reads for sites, are not set up on this service'],
  NotFriendsOnly: [409, 'Only a friends-only block or post is hidden on its way to private'],
  Answered: [409, 'The move request or agent action has been approved or declined already'],
  NotThisMove: [409, 'The move recorded is not the one the request asked for'],
  InvalidMove: [400, 'The layer named is not public, friends or private, or the block is in it already'],
  NotTheirSite: [400, 'The return address is not on one of the member\'s sites'],
  AgentPaused: [409, 'The member paused this agent in the cockpit\'s Agents panel'],
  AgentDisconnected: [403, 'The member disconnected this agent in the cockpit\'s Agents panel'],
  NotApproved: [409, 'The action waits for the member, was declined, was carried out already, or is not the one the member approved'],
  TooManyWaiting: [409, 'A hundred agent actions wait for the member already'],
  InternalError: [500, 'Something went wrong in the service itself'],
};

const short = name => name.split('.').at(-1);
const cell = text => String(text).replaceAll('|', '\\|');

export function capabilitiesPage() {
  const used = new Set(TOOLS.flatMap(tool => tool.requests));
  const without = Object.values(REQUESTS).filter(request => !used.has(request.name)
    && !(request.name.startsWith('com.ohmmmm.vault.') && used.has(short(request.name))));
  const lines = [
    '# What the vault can do',
    '',
    '<!-- Written by scripts/capabilities.mjs from service/src/capabilities/ and mcp/tools.mjs. Change those, then run `node scripts/capabilities.mjs --write`. -->',
    '',
    'The vault service does a small number of things, and each is kept apart from the others. A **capability** is one of those things: a few requests that belong together, in one file. A **request** is one question or one change. A **tool** is something an agent can decide to do, and every tool is made of requests and nothing else.',
    '',
    'This page is the whole list. It is written from the same tables the service and the tools run on, so it cannot say anything they do not do.',
    '',
    '## The capabilities',
    '',
    '| Capability | What it is for | Requests | Where |',
    '| --- | --- | --- | --- |',
    ...CAPABILITIES.map(capability => `| **${capability.name}** | ${cell(capability.about)} | ${Object.keys(capability.requests).map(name => `\`${short(name)}\``).join(', ')} | [${FILES[capability.name].split('/').at(-1)}](${FILES[capability.name]}) |`),
    '',
    'The service never writes to anyone\'s repository. Saving a post, whatever it says about who may see it, changes only the vault\'s own copy. Publishing is worked out here and carried out by the member, signed in at their own PDS ([public/vault/publish.js](public/vault/publish.js)).',
    '',
    '## Asking',
    '',
    'A request is sent to `/xrpc/` and its full name, such as `/xrpc/com.ohmmmm.vault.getTree`, at the service\'s own address or under `/vault` on the app\'s. One that only reads is a `GET` with what it takes in the address. One that changes something is a `POST` with what it takes as JSON. Every answer is JSON.',
    '',
    'Who may ask is one of four things, and each request says which:',
    '',
    '| Who | How they are known |',
    '| --- | --- |',
    ...Object.values(ASKS).map(([who, how]) => `| ${cell(who)} | ${cell(how)} |`),
    '',
    'A member\'s posts and blocks are served to that member. Their friends-only posts and blocks are also served to the DIDs on their friend list, and to nobody else. Who is asking is settled before any store is looked at. Private blocks are never kept by the service in readable form.',
    '',
    'The editor sends `X-Ohm-Did` for the member it displays. If the authenticated account differs, the service refuses with `409 AccountChanged` before running the request. This optional precondition binds stale tabs to their displayed member; it cannot select an account or replace authentication.',
    '',
  ];
  for (const capability of CAPABILITIES) {
    lines.push(`## ${capability.name}`, '', capability.about, '');
    for (const [name, request] of Object.entries(capability.requests)) {
      lines.push(`### \`${name}\``, '', request.about, '',
        '| | |', '| --- | --- |',
        `| Reads or changes | ${request.changes ? 'Changes' : 'Reads only'} (\`${request.verb}\`) |`,
        `| Who may ask | ${cell(ASKS[request.asks][0])} |`,
        `| Takes | ${Object.keys(request.takes).length ? Object.entries(request.takes).map(([field, what]) => `\`${field}\`: ${cell(what)}`).join('<br>') : 'Nothing'} |`,
        `| Gives | ${cell(request.gives)} |`,
        '');
    }
  }
  lines.push(
    '## When the answer is no',
    '',
    'A refusal is JSON with an `error`, which is one of the names below, and a `message` in plain words. The message is written to be shown to a person as it is.',
    '',
    '| Error | Status | When |',
    '| --- | --- | --- |',
    ...Object.entries(REFUSALS).map(([name, [status, when]]) => `| \`${name}\` | ${status} | ${cell(when)} |`),
    '',
    '## The tools an agent has',
    '',
    'The tools are in [../mcp/tools.mjs](../mcp/tools.mjs), and reach the service as the person, with a token from the person\'s own PDS for each request ([../scripts/vault-client.mjs](../scripts/vault-client.mjs)). A tool adds no ability of its own: it is a way of asking for the requests beside it.',
    '',
    '| Tool | Reads or changes | Made of | What it does |',
    '| --- | --- | --- | --- |',
    ...TOOLS.map(tool => `| \`${tool.name}\` | ${tool.annotations?.readOnlyHint ? 'Reads only' : 'Changes'} | ${tool.requests.map(name => `\`${name}\``).join(', ')} | ${cell(tool.description)} |`),
    '',
    'Three rules hold for every tool that changes something:',
    '',
    '1. Create private blocks on the person\'s device. Service-backed tools expose only the public and friends layers.',
    '2. Changing a post, publishing, bringing posts in from the PDS, saving or removing a friends block, asking someone to be a friend, approving a mail draft and removing a friend each take two calls. The first puts the action in the cockpit\'s Agents panel and gives its approval ID as `confirm`; the second carries it out only once the member approved exactly that action there.',
    '3. A post or friends block is changed from the version that was read. If it has changed since, the tool refuses the write.',
    '',
    '### Requests with no tool',
    '',
    'These requests have no MCP tool. They serve the editor, command line, adapters or sign-in.',
    '',
    '| Request | Capability | Why it has no tool |',
    '| --- | --- | --- |',
    ...without.map(request => `| \`${short(request.name)}\` | ${request.capability} | ${NO_TOOL[request.name] ?? NO_TOOL[request.capability]} |`),
    '',
    '## Not here yet',
    '',
    'Attachments held by the vault, earlier versions of a post and bringing a removed one back, and a key a person can give an agent and take away again. Until there is such a key, an agent signs in with an app password from the person\'s PDS.',
    '',
  );
  return lines.join('\n');
}

const NO_TOOL = {
  'com.ohmmmm.vault.listPosts': 'It is for keeping a copy in step: every post\'s version, and what changed since. The tools read the structure instead',
  Export: 'The command line and the editor write the vault out. An agent reads posts one at a time',
  'com.ohmmmm.vault.addFriend': 'Only the member can widen who can read the friends layer, through their ohm session',
  'com.ohmmmm.vault.listFriendRequests': 'The member answers requests in the cockpit. An agent never lets anyone in',
  'com.ohmmmm.vault.approveFriend': 'Only the member can widen who can read the friends layer, through their ohm session',
  'com.ohmmmm.vault.declineFriend': 'The member answers requests in the cockpit',
  'com.ohmmmm.vault.setFriendChannels': 'Only the member changes what a friend sees, through their ohm session',
  Private: 'Private contents never reach the service readable. Agents read them only on the person\'s device, after unlock',
  Agents: 'Every tool calls agentCheckIn, and every two-step tool askApproval, getApproval and useApproval, on its own. Answering and controlling agents is the member\'s, in the cockpit\'s Agents panel',
  Account: 'It rides on an ohm session, which an agent does not have',
  Identity: 'It is part of signing in',
  Channels: 'The cockpit arranges channels. An agent files and orders blocks in the local vault, with vault_collect and vault_write',
  Visibility: 'Answering a request and recording a move are the member\'s, in the cockpit, signed in to ohm. An agent asks with vault_set_visibility',
  Media: 'The cockpit sends and shows media. An agent works with the media blocks in the local vault',
  'com.ohmmmm.vault.getAgenda': 'The cockpit shows it. An agent counts the same things in the local vault with vault_lint',
  Cortex: 'The cortex is sealed. An agent reads and writes it on the person\'s device, through the cortex\'s own tools',
  Content: 'It is for sites: a site\'s content loader reads it, for whoever is looking at the site. The member\'s own agent reads their vault through the other tools',
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const page = capabilitiesPage();
  if (process.argv.includes('--write')) {
    await writeFile(PAGE, page);
    console.error(`Wrote ${PAGE}`);
  } else {
    process.stdout.write(page);
  }
}
