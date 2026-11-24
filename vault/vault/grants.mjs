// What each agent may change in the vault, as the person wrote it in `.vault/grants.json`. Nothing
// here touches a disk: it checks the grants and answers whether one agent may do one thing to one
// path. Only the person changes the file, with `ohm vault grant` and `ohm vault revoke`; no agent
// tool writes it, and every tool refuses paths under `.vault/`.
//
//   { "agents": {
//       "claude-code": { "write": ["notes", "projects/ohm"], "link": ["*"] } } }
//
//   write  make, replace, remove and restore blocks, channels and entities under these folders
//   link   add a link from a block under these folders to another node (write includes it)
//
// A scope is a channel's path, and covers that folder and every folder inside it. `*` is the whole
// vault. With no grant an agent may read, search and collect, and nothing else.
import { isChannelPath } from './node.mjs';

export const GRANTS = '.vault/grants.json';
export const RIGHTS = ['write', 'link'];
export const EVERYWHERE = '*';
const AGENT = /^[A-Za-z0-9._-]+$/;

const scopeProblem = scope => (scope === EVERYWHERE || isChannelPath(scope) || /^_entities(?:\/[a-z]+)?$/.test(scope) ? null
  : `"${scope}" is not a scope: give a channel's path, _entities, or ${EVERYWHERE} for the whole vault`);

// The grants checked: { agents: { name: { write: [...], link: [...] } }, problems }. A bad entry is
// dropped with a problem, so one mistake does not take the other grants with it.
export function readGrants(value) {
  const problems = [];
  const agents = {};
  if (value === undefined || value === null) return { agents, problems };
  if (typeof value !== 'object' || Array.isArray(value) || (value.agents !== undefined && (typeof value.agents !== 'object' || Array.isArray(value.agents)))) {
    return { agents, problems: [`${GRANTS} holds one object, with an "agents" object`] };
  }
  for (const [name, given] of Object.entries(value.agents ?? {})) {
    if (!AGENT.test(name)) { problems.push(`"${name}" is not an agent's name`); continue; }
    if (!given || typeof given !== 'object' || Array.isArray(given)) { problems.push(`The grant for ${name} is not an object`); continue; }
    const grant = {};
    for (const [right, scopes] of Object.entries(given)) {
      if (!RIGHTS.includes(right)) { problems.push(`${name} has "${right}"; a right is one of: ${RIGHTS.join(', ')}`); continue; }
      if (!Array.isArray(scopes)) { problems.push(`${name}'s ${right} is a list of scopes`); continue; }
      const kept = [];
      for (const scope of scopes) {
        const problem = typeof scope === 'string' ? scopeProblem(scope) : 'A scope is text';
        if (problem) problems.push(`${name}: ${problem}`);
        else if (!kept.includes(scope)) kept.push(scope);
      }
      grant[right] = kept;
    }
    agents[name] = grant;
  }
  return { agents, problems };
}

const covers = (scope, path) => scope === EVERYWHERE || path === scope || path.startsWith(`${scope}/`);

// The scope that lets `agent` do `right` to the file at `path`, or null. Write includes link.
export function allowed(grants, agent, right, path) {
  const grant = grants.agents[agent];
  if (!grant) return null;
  const rights = right === 'link' ? ['write', 'link'] : [right];
  for (const each of rights) {
    const scope = (grant[each] ?? []).find(scope => covers(scope, path));
    if (scope) return scope;
  }
  return null;
}

// The grants after the person gives or takes back one right on one scope. Returns the plain object
// to write. Revoking `*` with no right takes everything from that agent.
export function changeGrants(value, { agent, right, scope, give }) {
  if (!AGENT.test(agent ?? '')) throw new Error('Name the agent with letters, digits, dots, underscores or hyphens.');
  if (right !== undefined && !RIGHTS.includes(right)) throw new Error(`A right is one of: ${RIGHTS.join(', ')}.`);
  const problem = scope === undefined ? null : scopeProblem(scope);
  if (problem) throw new Error(`${problem}.`);
  const { agents, problems } = readGrants(value);
  if (problems.length) throw new Error(`Fix ${GRANTS} first: ${problems.join('; ')}.`);
  const grant = { ...(agents[agent] ?? {}) };
  if (give) {
    if (!right || !scope) throw new Error('Give a right and a scope.');
    grant[right] = [...new Set([...(grant[right] ?? []), scope])];
  } else if (!right) {
    delete agents[agent];
    return { agents };
  } else {
    grant[right] = (grant[right] ?? []).filter(each => scope === undefined ? false : each !== scope);
    if (!grant[right].length) delete grant[right];
  }
  if (Object.keys(grant).length) agents[agent] = grant;
  else delete agents[agent];
  return { agents };
}
