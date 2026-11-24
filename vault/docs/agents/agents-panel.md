# Agents panel: agent reference

Human guide: [your agents in ohm](../agents-panel.md). Code: [service/src/agents.mjs](../../service/src/agents.mjs), [capabilities/agents.mjs](../../service/src/capabilities/agents.mjs), [mcp/tools.mjs](../../mcp/tools.mjs) (`twoSteps`, `call`), cockpit [AgentsPanel.tsx](../../../app/src/workspace/AgentsPanel.tsx), flow [app/flows/agents.md](../../../app/flows/agents.md). Tests: `test/mcp.test.mjs` (agents), `app/test/agents.test.ts`. Requests: [CAPABILITIES.md › Agents](../../service/CAPABILITIES.md#agents). Migration [0010_agents.sql](../../service/migrations/0010_agents.sql).

## Contract

- **Check-in:** `createTools().call(name)` calls `agentCheckIn {agent: by, tool: name}` before every tool. The service upserts `agents (did, agent)`, appends to `agent_activity` (keeps the last 200 per member), and refuses:
  - `AgentPaused` (409) when the agent is paused;
  - `AgentDisconnected` (403) when it is disconnected.
- **Two steps through ohm:** `twoSteps(args, plan, willHappen, act, { inOhm = true })`.
  1. The first call runs `askApproval {agent, tool: plan.tool, plan, shown: willHappen}` and returns `{done: false, willHappen, confirm: <approval id a+32 hex>, waitingFor, next}`. The same plan, asked again while waiting or approved, returns the same approval; the partial unique index `agent_approvals_one_open` (`did, agent, tool, plan` where `state IN ('waiting', 'approved')`) and `ON CONFLICT DO NOTHING` keep it one when asks arrive at once.
  2. The second call runs `getApproval` and polls every `poll` ms (default 1 s) for up to `wait` ms (default 25 s; tests pass 0). The result depends on the approval:
     - still waiting: `{done: false, …}` again;
     - `declined`: it is refused;
     - another tool's or agent's approval: refused as changed;
     - otherwise `useApproval {id, agent, tool, plan}` sets `state = 'used'`, but only if it was `approved` with exactly this plan. Then `act()` runs.
  - A mismatched plan gives `NotApproved` and is reported as "has changed since it was shown". An approval can be used once. A retry of the same agent, tool and plan within `RETRY` (15 minutes) of its use, after `act()` failed or its answer was lost, answers `{id, used: true, unchanged: true}` and `act()` runs again; each action is guarded by the versions in its plan (`replaces`, `from`), so it changes nothing that changed since. Later, it is `NotApproved` ("used already").
- **Move requests skip the panel:** `vault_set_visibility` keeps the local HMAC confirm (`inOhm: false`) when the move becomes a move request, since that request already waits in ohm. A granted hide goes through the panel.
- **`vault_mail_ask {to[], cc?[], subject, body}`:** it calls no service request beyond control. Once used, it returns `{approved, send: draft, next}`. ohm never sends mail; the agent sends exactly `send`.
- **Cockpit only** (`asks: 'ohm'`):
  - `answerApproval {id, approve}`: `waiting` becomes `approved` or `declined`; otherwise `Answered`.
  - `setAgentState {agent, state: active|paused|disconnected}`: `disconnected` also declines the agent's `waiting` and `approved` approvals.
- **Lists** (`asks: 'member'`):
  - `listAgents` gives agent, state, firstSeen, lastSeen, lastTool, waiting, and the last 10 calls.
  - `listApprovals {state?}` gives approvals oldest first, each with `shown` and never `plan`.
- **Limits:**
  - `plan` and `shown` are each at most 20,000 characters of JSON;
  - at most 100 approvals waiting per member (`TooManyWaiting`);
  - agent names are `agent:[A-Za-z0-9._-]{1,64}`.

## Boundary

A PDS token doesn't say which agent holds it, so the service can't tell an agent's direct requests from the command line's. Pause, disconnect and approval are enforced in ohm's MCP tools, the same limit as "agents only ask" (handoff, open questions). Real per-agent enforcement needs a key the person gives one agent and can take back, which CAPABILITIES.md lists as not here yet.
