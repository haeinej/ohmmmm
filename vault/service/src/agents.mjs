// The member's coding agents, as the cockpit's Agents panel shows them: each agent that called ohm's
// tools, what it did lately, whether the member paused or disconnected it, and the actions it waits
// for the member to approve.
//
// An approval holds a tool's exact plan. The agent's tool asks for one, the member approves or
// declines it in the cockpit, and the tool may then carry out that plan, and only it, once. A yes
// typed in the agent's chat does not approve anything.
//
// Pause and disconnect are kept here and checked by ohm's agent tools on every call. A PDS token
// does not say which agent holds it, so the service cannot tell one agent's requests from the
// command line's; the tools are where this is enforced (docs/agents/agents.md).
// `db` has the shape of a Cloudflare D1 database.
import { Refused } from './store.mjs';

const AGENT = /^agent:[A-Za-z0-9._-]{1,64}$/;
const TOOL = /^[a-z][a-z0-9_]{0,63}$/;
const STATES = ['active', 'paused', 'disconnected'];
const ANSWERS = ['waiting', 'approved', 'declined', 'used'];
const LIMIT = 20_000;
const KEPT = 200;
const WAITING = 100;

const refuse = message => { throw new Refused(400, 'InvalidRequest', message); };
const agentOf = value => (typeof value === 'string' && AGENT.test(value) ? value : refuse('Name the agent as agent: and its name'));
const toolOf = value => (typeof value === 'string' && TOOL.test(value) ? value : refuse('Name the tool'));
const jsonOf = (value, what) => {
  const text = JSON.stringify(value ?? null);
  if (value === undefined || text.length > LIMIT) refuse(`Give the ${what}, at most ${LIMIT} characters as JSON`);
  return text;
};
const approval = row => ({
  id: row.id, agent: row.agent, tool: row.tool, shown: JSON.parse(row.shown), state: row.state,
  asked: row.asked_at, ...(row.answered_at ? { answered: row.answered_at } : {}), ...(row.used_at ? { used: row.used_at } : {}),
});

export function agentStore(db) {
  const one = (did, id) => db.prepare('SELECT * FROM agent_approvals WHERE did = ?1 AND id = ?2').bind(did, id).first();

  return {
    // Every call an agent's tools make starts here: it is seen, and refused if paused or disconnected.
    async checkIn(did, { agent, tool, now = new Date() }) {
      agent = agentOf(agent); tool = toolOf(tool);
      const at = now.toISOString();
      const held = await db.prepare('SELECT state FROM agents WHERE did = ?1 AND agent = ?2').bind(did, agent).first();
      if (held?.state === 'disconnected') throw new Refused(403, 'AgentDisconnected', 'The person disconnected this agent in ohm. They can allow it again from the Agents panel.');
      if (held?.state === 'paused') throw new Refused(409, 'AgentPaused', 'The person paused this agent in ohm. Wait until they resume it from the Agents panel.');
      await db.batch([
        db.prepare(`INSERT INTO agents (did, agent, state, first_seen, last_seen, last_tool) VALUES (?1, ?2, 'active', ?3, ?3, ?4)
          ON CONFLICT (did, agent) DO UPDATE SET last_seen = ?3, last_tool = ?4`).bind(did, agent, at, tool),
        db.prepare('INSERT INTO agent_activity (did, seq, agent, at, tool) VALUES (?1, (SELECT COALESCE(MAX(seq), 0) + 1 FROM agent_activity WHERE did = ?1), ?2, ?3, ?4)').bind(did, agent, at, tool),
        db.prepare('DELETE FROM agent_activity WHERE did = ?1 AND seq <= (SELECT MAX(seq) FROM agent_activity WHERE did = ?1) - ?2').bind(did, KEPT),
      ]);
      return { state: 'active' };
    },

    // A tool asks to carry out a plan. The same plan, asked again while it waits or is approved,
    // gives the same approval.
    async ask(did, { agent, tool, plan, shown, now = new Date() }) {
      agent = agentOf(agent); tool = toolOf(tool);
      const planned = jsonOf(plan, 'plan');
      const showing = jsonOf(shown, 'preview');
      const same = await db.prepare("SELECT * FROM agent_approvals WHERE did = ?1 AND agent = ?2 AND tool = ?3 AND plan = ?4 AND state IN ('waiting', 'approved')").bind(did, agent, tool, planned).first();
      if (same) return { approval: approval(same), unchanged: true };
      const { count } = await db.prepare("SELECT COUNT(*) AS count FROM agent_approvals WHERE did = ?1 AND state = 'waiting'").bind(did).first();
      if (count >= WAITING) throw new Refused(409, 'TooManyWaiting', `${WAITING} actions are waiting for the person already. Ask them to answer some in ohm first.`);
      const id = `a${crypto.randomUUID().replaceAll('-', '')}`;
      await db.prepare("INSERT INTO agent_approvals (did, id, agent, tool, plan, shown, state, asked_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'waiting', ?7)")
        .bind(did, id, agent, tool, planned, showing, now.toISOString()).run();
      return { approval: approval(await one(did, id)) };
    },

    async get(did, id) {
      const row = typeof id === 'string' ? await one(did, id) : null;
      if (!row) throw new Refused(404, 'NotFound', 'There is no such approval');
      return { approval: approval(row) };
    },

    async list(did, { state = 'waiting' } = {}) {
      if (!ANSWERS.includes(state)) refuse(`state is one of ${ANSWERS.join(', ')}`);
      const { results } = await db.prepare('SELECT * FROM agent_approvals WHERE did = ?1 AND state = ?2 ORDER BY asked_at LIMIT 200').bind(did, state).all();
      return { approvals: results.map(approval) };
    },

    // The member, in the cockpit, answers.
    async answer(did, { id, approve, now = new Date() }) {
      if (typeof approve !== 'boolean') refuse('Say approve: true or false');
      const state = approve ? 'approved' : 'declined';
      const done = await db.prepare("UPDATE agent_approvals SET state = ?3, answered_at = ?4 WHERE did = ?1 AND id = ?2 AND state = 'waiting'").bind(did, id, state, now.toISOString()).run();
      if (!done.meta.changes) {
        await this.get(did, id);
        throw new Refused(409, 'Answered', 'This action has been answered already');
      }
      return { id, state };
    },

    // The tool carries out what was approved, once, and only the exact plan.
    async use(did, { id, agent, tool, plan, now = new Date() }) {
      agent = agentOf(agent); tool = toolOf(tool);
      const planned = jsonOf(plan, 'plan');
      const done = await db.prepare("UPDATE agent_approvals SET state = 'used', used_at = ?6 WHERE did = ?1 AND id = ?2 AND agent = ?3 AND tool = ?4 AND plan = ?5 AND state = 'approved'")
        .bind(did, id, agent, tool, planned, now.toISOString()).run();
      if (done.meta.changes) return { id, used: true };
      const { approval: held } = await this.get(did, id);
      const why = held.state === 'waiting' ? 'The person has not approved this in ohm yet'
        : held.state === 'declined' ? 'The person declined this in ohm'
        : held.state === 'used' ? 'This approval was used already. Ask again'
        : 'The action has changed since the person approved it. Ask again';
      throw new Refused(409, 'NotApproved', why);
    },

    // The Agents panel: every agent, newest seen first, with what it did lately and what waits.
    async agents(did) {
      const { results } = await db.prepare('SELECT * FROM agents WHERE did = ?1 ORDER BY last_seen DESC').bind(did).all();
      const { results: recent } = await db.prepare('SELECT agent, at, tool FROM agent_activity WHERE did = ?1 ORDER BY seq DESC LIMIT ?2').bind(did, KEPT).all();
      const { results: waiting } = await db.prepare("SELECT agent, COUNT(*) AS count FROM agent_approvals WHERE did = ?1 AND state = 'waiting' GROUP BY agent").bind(did).all();
      return {
        agents: results.map(row => ({
          agent: row.agent, state: row.state, firstSeen: row.first_seen, lastSeen: row.last_seen,
          ...(row.last_tool ? { lastTool: row.last_tool } : {}),
          waiting: waiting.find(each => each.agent === row.agent)?.count ?? 0,
          recent: recent.filter(each => each.agent === row.agent).slice(0, 10).map(each => ({ at: each.at, tool: each.tool })),
        })),
      };
    },

    // The member pauses, resumes, disconnects or allows again an agent. Disconnecting also declines
    // what it was waiting for.
    async setState(did, { agent, state, now = new Date() }) {
      agent = agentOf(agent);
      if (!STATES.includes(state)) refuse(`state is one of ${STATES.join(', ')}`);
      const at = now.toISOString();
      const done = await db.prepare('UPDATE agents SET state = ?3 WHERE did = ?1 AND agent = ?2').bind(did, agent, state).run();
      if (!done.meta.changes) throw new Refused(404, 'NotFound', 'No such agent has used ohm');
      if (state === 'disconnected') {
        await db.prepare("UPDATE agent_approvals SET state = 'declined', answered_at = ?3 WHERE did = ?1 AND agent = ?2 AND state IN ('waiting', 'approved')").bind(did, agent, at).run();
      }
      return { agent, state };
    },
  };
}
