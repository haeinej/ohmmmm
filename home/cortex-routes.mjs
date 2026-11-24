// The person's cortex, through the bridge (docs/serve.md): what the app reads of it and changes in
// it. Built only from the cortex's own folder operations (cortex/src/folder.mjs), opened as the
// person (`member`), so every change is kept in .cortex/history/ and journaled as theirs. An
// observation an agent in the page wrote, once the person approved it there, is written as that
// agent's, saying so. Nothing here touches the vault.
//
//   GET    /cortex/parts                     the profile, observations, skills and tools, and what waits for the person
//   PUT    /cortex/profile                   the person's part of the profile, whole (If-Match)
//   POST   /cortex/profile/<id>              { accept }: a proposed profile line accepted or declined
//   PUT    /cortex/observation?id=           { text, about?, pin?, agent?, why? } (If-Match, or If-None-Match: * for a new one)
//   DELETE /cortex/observation?id=           forgets one (If-Match)
//   PUT    /cortex/skill?name=               a skill's instructions, its body (If-Match)
//   DELETE /cortex/skill?name=               removes a skill (If-Match)
//   POST   /cortex/skills/<name>             { approve }: a proposed skill approved or declined
//   PUT    /cortex/tool?name=                { body?, on? } (If-Match)
//   GET    /cortex/journal?limit=            the cortex's changes and sessions, with the text of every version they name
import { agentName, openCortex } from '../cortex/src/folder.mjs';
import { openJournal } from '../cortex/src/journal.mjs';
import { Refused } from '../cortex/src/core.mjs';

const PERSON = 'member';
const MAX_TEXT = 128 * 1024;
const STATUS = { Changed: 412, NotFound: 404, PersonOnly: 403, InvalidRequest: 400, InvalidSkill: 400, SkillNotApproved: 409, NameTaken: 409, AlreadyDeclined: 409 };
const versionIn = header => String(header).replace(/^W\//, '').replace(/^"|"$/g, '');

/** Everything the app shows of the cortex, read through its folder operations. */
export async function cortexParts(dir) {
  const cortex = openCortex(dir, { actor: PERSON });
  const { observations } = await cortex.observations({ limit: 500 });
  return {
    profile: await cortex.profile(),
    proposals: (await cortex.profileProposals()).map(({ id, heading, line, quote, by, when }) => ({ id, heading, line, ...(quote ? { quote } : {}), by, when })),
    observations,
    skills: await Promise.all((await cortex.listSkills()).map(skill => cortex.readSkill(skill.name))),
    proposedSkills: await cortex.proposedSkills(),
    tools: await Promise.all((await cortex.listTools()).map(tool => cortex.readTool(tool.name))),
    proposedTools: await cortex.proposedTools(),
  };
}

/** The cortex's recent changes and sessions, oldest first, and the text of each version they name. */
export async function cortexHistory(dir, { limit = 500 } = {}) {
  const cortex = openCortex(dir, { actor: PERSON });
  const { changes } = await cortex.history({ limit });
  const from = changes[0]?.seq ?? Infinity;
  const sessions = (await openJournal(dir).read())
    .filter(line => line.type === 'session' && (line.seq >= from || !changes.length))
    .map(({ seq, id, at, actor, summary, outcome, made, deadEnds }) => ({ seq, id, at, actor, summary, outcome, made: made ?? [], deadEnds: deadEnds ?? [] }));
  const texts = {};
  for (const change of changes) {
    for (const version of [change.before, change.after]) {
      if (typeof version !== 'string' || version in texts) continue;
      try { texts[version] = await cortex.textAt(change.node, version); } catch { texts[version] = null; }
    }
  }
  return { changes, sessions, texts };
}

/**
 * The cortex's routes for the bridge. `handle(req, res, url)` answers one and returns true, or returns
 * false when the path is not one of them. `send`, `said` and `body` are the bridge's own.
 */
export function cortexRoutes({ dir, send, said, body }) {
  const json = async req => {
    try { return JSON.parse((await body(req, MAX_TEXT)).toString('utf8')); } catch { return undefined; }
  };
  const text = async req => (await body(req, MAX_TEXT)).toString('utf8');
  // The version the app read: If-Match, or none for something new (If-None-Match: *). Undefined when neither is said.
  const read = req => (req.headers['if-match'] !== undefined ? versionIn(req.headers['if-match']) : req.headers['if-none-match'] === '*' ? null : undefined);
  const person = () => openCortex(dir, { actor: PERSON });

  async function route(req, res, url) {
    const { pathname } = url;
    const method = req.method;
    const needVersion = () => said(res, 428, 'Say which version you read: If-Match: "<version>"');

    if (pathname === '/cortex/parts' && method === 'GET') return send(res, 200, await cortexParts(dir));
    if (pathname === '/cortex/journal' && method === 'GET') {
      const limit = Number(url.searchParams.get('limit') ?? 500);
      if (!Number.isInteger(limit) || limit < 1 || limit > 500) return said(res, 400, 'limit is a whole number from 1 to 500');
      return send(res, 200, await cortexHistory(dir, { limit }));
    }
    if (pathname === '/cortex/profile' && method === 'PUT') {
      const replaces = read(req);
      if (replaces === undefined) return needVersion();
      return send(res, 200, await person().writeProfile(await text(req), { replaces }));
    }
    const line = /^\/cortex\/profile\/([A-Za-z0-9_-]{1,64})$/.exec(pathname);
    if (line && method === 'POST') {
      const answer = await json(req);
      if (typeof answer?.accept !== 'boolean') return said(res, 400, 'Send { accept: true } or { accept: false }');
      return send(res, 200, answer.accept ? await person().acceptProfile(line[1]) : await person().declineProfile(line[1]));
    }
    if (pathname === '/cortex/observation' && (method === 'PUT' || method === 'DELETE')) {
      const id = url.searchParams.get('id') ?? '';
      const replaces = read(req);
      if (replaces === undefined) return said(res, 428, 'Say which version you read: If-Match: "<version>", or If-None-Match: * for a new observation');
      if (method === 'DELETE') {
        if (replaces === null) return needVersion();
        return send(res, 200, await person().removeObservation(id, { replaces }));
      }
      const given = await json(req);
      if (!given || typeof given !== 'object' || typeof given.text !== 'string') return said(res, 400, 'An observation is { text, about?, pin? }');
      if (given.agent !== undefined) {
        // An agent in the page wrote it and the person approved it there: it is the agent's, and new.
        if (typeof given.agent !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(given.agent)) return said(res, 400, 'agent names the agent in the page: letters, digits, ., _ and -');
        if (replaces !== null || given.pin !== undefined) return said(res, 400, 'An agent in the page only writes a new observation, unpinned');
        const why = typeof given.why === 'string' && given.why.trim() ? given.why.replace(/\s+/g, ' ').trim().slice(0, 400) : undefined;
        const agent = openCortex(dir, { actor: agentName(given.agent) });
        return send(res, 201, await agent.observe({ id, text: given.text, about: given.about, session: 'app', reason: `approved by the person in the app${why ? `: ${why}` : ''}` }));
      }
      const done = await person().observe({ id, text: given.text, about: given.about, pin: given.pin, replaces });
      return send(res, replaces === null ? 201 : 200, done);
    }
    if (pathname === '/cortex/skill' && (method === 'PUT' || method === 'DELETE')) {
      const name = url.searchParams.get('name') ?? '';
      const replaces = read(req);
      if (!replaces) return needVersion();
      if (method === 'DELETE') return send(res, 200, await person().removeSkill(name, { replaces }));
      return send(res, 200, await person().writeSkill(name, { body: await text(req), replaces }));
    }
    const proposed = /^\/cortex\/skills\/([a-z]+(?:-[a-z]+)*)$/.exec(pathname);
    if (proposed && method === 'POST') {
      const answer = await json(req);
      if (typeof answer?.approve !== 'boolean') return said(res, 400, 'Send { approve: true } or { approve: false }');
      return send(res, 200, answer.approve ? await person().approveSkill(proposed[1]) : await person().declineSkill(proposed[1]));
    }
    if (pathname === '/cortex/tool' && method === 'PUT') {
      const replaces = read(req);
      if (!replaces) return needVersion();
      const given = await json(req);
      if (!given || typeof given !== 'object' || (given.body !== undefined && typeof given.body !== 'string') || (given.on !== undefined && typeof given.on !== 'boolean')) return said(res, 400, 'A tool change is { body?, on? }');
      return send(res, 200, await person().writeTool(url.searchParams.get('name') ?? '', { body: given.body, on: given.on, replaces }));
    }
    return false;
  }

  return async function handle(req, res, url) {
    if (!url.pathname.startsWith('/cortex/') || url.pathname === '/cortex/mcp') return false;
    try {
      const answered = await route(req, res, url);
      return answered !== false;
    } catch (problem) {
      if (problem?.tooLarge) { said(res, 413, 'That is too large for the cortex'); return true; }
      if (!(problem instanceof Refused)) throw problem;
      send(res, STATUS[problem.code] ?? 409, { error: problem.message, code: problem.code, ...(problem.extra?.current !== undefined ? { version: problem.extra.current } : {}) });
      return true;
    }
  };
}
