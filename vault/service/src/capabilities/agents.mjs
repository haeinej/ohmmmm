// Agents: the member's coding agents, as the cockpit's Agents panel shows them, and the actions they
// wait for the member to approve there. ohm's agent tools call the first four on their own; the
// member answers and controls them from the cockpit, signed in to ohm.
export default {
  name: 'Agents',
  about: 'The member\'s coding agents: each one that used ohm\'s tools, what it did lately, whether the member paused or disconnected it, and the actions it waits for the member to approve in the cockpit. An agent never approves its own action.',
  requests: {
    'com.ohmmmm.vault.agentCheckIn': {
      verb: 'POST', asks: 'member', changes: true,
      about: 'ohm\'s agent tools call this before every tool call: the agent is seen, its call is kept among its recent ones, and it is refused when the member paused or disconnected it.',
      takes: { agent: 'agent:<name>', tool: 'the tool being called' },
      gives: '`state` (active)',
      run: async ({ body, agentsOf, did }) => agentsOf.checkIn(did, await body()),
    },
    'com.ohmmmm.vault.askApproval': {
      verb: 'POST', asks: 'member', changes: true,
      about: 'An agent\'s tool asks the member to approve one exact plan. It waits in the cockpit\'s Agents panel, showing `shown`. The same plan asked again while it waits or is approved gives the same approval, even when asked at the same moment.',
      takes: { agent: 'agent:<name>', tool: 'the tool', plan: 'the exact plan, as JSON', shown: 'what the member is shown, as JSON' },
      gives: '`approval` (id, agent, tool, shown, state, asked), and `unchanged` when it was waiting already',
      run: async ({ body, agentsOf, did }) => agentsOf.ask(did, await body()),
    },
    'com.ohmmmm.vault.getApproval': {
      verb: 'GET', asks: 'member', changes: false,
      about: 'One approval and how it stands: waiting, approved, declined or used.',
      takes: { id: 'the approval\'s ID' },
      gives: '`approval`',
      run: ({ url, agentsOf, did }) => agentsOf.get(did, url.searchParams.get('id')),
    },
    'com.ohmmmm.vault.useApproval': {
      verb: 'POST', asks: 'member', changes: true,
      about: 'An agent\'s tool uses an approval to carry out its plan: once, and only when the member approved exactly that plan. The same agent, tool and plan sent again within 15 minutes, because the action failed or its answer was lost, answers the same with `unchanged`. Otherwise it is refused with NotApproved, saying why.',
      takes: { id: 'the approval\'s ID', agent: 'agent:<name>', tool: 'the tool', plan: 'the plan, as JSON' },
      gives: '`id`, `used`, and `unchanged` when it was a retry',
      run: async ({ body, agentsOf, did }) => agentsOf.use(did, await body()),
    },
    'com.ohmmmm.vault.listApprovals': {
      verb: 'GET', asks: 'member', changes: false,
      about: 'Agents\' actions, oldest first: waiting (the default), approved, declined or used.',
      takes: { state: 'optional: waiting, approved, declined or used' },
      gives: '`approvals`',
      run: ({ url, agentsOf, did }) => agentsOf.list(did, { state: url.searchParams.get('state') ?? undefined }),
    },
    'com.ohmmmm.vault.answerApproval': {
      verb: 'POST', asks: 'ohm', changes: true,
      about: 'The member approves or declines an agent\'s action, in the cockpit. Only the member, signed in to ohm; never an agent.',
      takes: { id: 'the approval\'s ID', approve: 'true or false' },
      gives: '`id`, `state`',
      run: async ({ body, agentsOf, did }) => agentsOf.answer(did, await body()),
    },
    'com.ohmmmm.vault.listAgents': {
      verb: 'GET', asks: 'member', changes: false,
      about: 'Every agent that used ohm\'s tools, newest seen first: its state, when it was last seen and with which tool, how many of its actions wait, and its last ten calls.',
      takes: {},
      gives: '`agents` (agent, state, firstSeen, lastSeen, lastTool, waiting, recent)',
      run: ({ agentsOf, did }) => agentsOf.agents(did),
    },
    'com.ohmmmm.vault.setAgentState': {
      verb: 'POST', asks: 'ohm', changes: true,
      about: 'The member pauses, resumes, disconnects or allows again one agent. Disconnecting also declines what it was waiting for. Only the member, signed in to ohm.',
      takes: { agent: 'agent:<name>', state: 'active, paused or disconnected' },
      gives: '`agent`, `state`',
      run: async ({ body, agentsOf, did }) => agentsOf.setState(did, await body()),
    },
  },
};
