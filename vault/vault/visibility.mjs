// Who can see a block, changed in the home folder (vault/plans/standard-site.md, step 2, as the owner
// decided it on 24 November 2026). In the folder a block's layer is its `visibility` property, so a
// move between Only you and Friends rewrites that property, once the person approves; the stores on
// the vault service catch up when syncing is built. Public is reached, and left, only through Publish.
//
// Agents never change it themselves: they ask (`vault_request_visibility`), and each request waits in
// .vault/requests.json until the person approves or declines it in the app (`ohmmmm serve`).
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { VaultProblem } from './core.mjs';
import { setProperty } from './file.mjs';
import { readNode } from './node.mjs';

export const LAYERS = ['private', 'friends', 'public'];
export const REQUESTS = '.vault/requests.json';
export const THROUGH_PUBLISH = 'Making a block public, or taking a public one back, goes through Publish (ohm publish), which shows the plan and has the person sign at their own PDS.';

const refuse = message => { throw new VaultProblem(message); };

/** The layer a file is in: its block's visibility (private when it says none), or null for anything but a block. */
export function layerOf(path, text) {
  const node = text === undefined ? null : readNode(path, text)?.node;
  return node?.type === 'block' ? node.visibility ?? 'private' : null;
}

/**
 * The block's file in another layer, between private and friends: `visibility` written (left out for
 * private, the default), and `kind` written when the property alone would make a plain note read as
 * a post. Public, either way, is refused: that is Publish.
 */
export function withVisibility(path, text, to) {
  const read = readNode(path, text);
  if (read?.node?.type !== 'block') refuse('Only a block has a visibility.');
  const node = read.node;
  if (!LAYERS.includes(to)) refuse(`A visibility is one of: ${LAYERS.join(', ')}.`);
  if (to === 'public' || node.visibility === 'public' || node.kind === 'post') refuse(THROUGH_PUBLISH);
  if ((node.visibility ?? 'private') === to) return text;
  let next = node.kindGiven ? text : setProperty(text, 'kind', node.kind);
  next = setProperty(next, 'visibility', to === 'private' ? undefined : to);
  const after = readNode(path, next)?.node;
  if (after?.type !== 'block' || after.kind !== node.kind || (after.visibility ?? 'private') !== to) refuse('The block would not read as the same block in its new layer.');
  return next;
}

// ---- Requests from agents ----

async function load(vault) {
  const text = await readFile(join(vault, REQUESTS), 'utf8').catch(problem => { if (problem.code !== 'ENOENT') throw problem; });
  if (text === undefined) return [];
  try {
    const value = JSON.parse(text);
    return Array.isArray(value?.requests) ? value.requests : [];
  } catch {
    refuse(`${REQUESTS} is not JSON. Fix or remove it.`);
  }
}
async function save(vault, requests) {
  const file = join(vault, REQUESTS);
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  await writeFile(temp, `${JSON.stringify({ requests }, null, 2)}\n`);
  await rename(temp, file);
}

/** Every request, oldest first. Call under the collect lock when changing them. */
export const readRequests = load;

/**
 * An agent asks for a block to move to another layer: `{ by, path, to, why? }`. Kept as waiting
 * until the person decides. Asking again for the same block and layer while one waits returns it.
 */
export async function requestVisibility(vault, { by, path, from, to, why, now = new Date() }) {
  if (!LAYERS.includes(to)) refuse(`A visibility is one of: ${LAYERS.join(', ')}.`);
  if (to === 'public' || from === 'public') refuse(THROUGH_PUBLISH);
  if (why !== undefined && (typeof why !== 'string' || why.length > 500 || why.includes('\n'))) refuse('Say why in one line of at most 500 characters.');
  const requests = await load(vault);
  const held = requests.find(each => each.status === 'waiting' && each.path === path && each.to === to);
  if (held) return held;
  const request = { id: randomUUID(), at: now.toISOString(), by, path, from, to, ...(why ? { why } : {}), status: 'waiting' };
  await save(vault, [...requests, request].slice(-500));
  return request;
}

/** The person's decision on a waiting request: `approved` or `declined`, with when, and why it could not be done. */
export async function decideRequest(vault, id, decision, { note, now = new Date() } = {}) {
  const requests = await load(vault);
  const request = requests.find(each => each.id === id);
  if (!request) refuse('There is no such request.');
  if (request.status !== 'waiting') refuse(`That request was ${request.status} already.`);
  Object.assign(request, { status: decision, decided: now.toISOString(), ...(note ? { note } : {}) });
  await save(vault, requests);
  return request;
}
