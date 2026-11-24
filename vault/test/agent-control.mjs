// ohm's agent tools check in and wait for the person's approval in ohm (service/src/agents.mjs).
// Tests about something else stand in for the person: each action is approved as soon as it is
// asked, through the same store the cockpit answers with.
import { agentStore } from '../service/src/agents.mjs';

export const CONTROL = ['agentCheckIn', 'askApproval', 'getApproval', 'useApproval'];

// `call(name, { query, body })` asks the service as the member.
export function agentControl(call, { db, did, approve = true }) {
  return {
    checkIn: checked => call('agentCheckIn', { body: checked }),
    async askApproval(asked) {
      const answer = await call('askApproval', { body: asked });
      if (approve && answer.approval.state === 'waiting') await agentStore(db).answer(did, { id: answer.approval.id, approve: true });
      return answer;
    },
    getApproval: id => call('getApproval', { query: { id } }),
    useApproval: used => call('useApproval', { body: used }),
  };
}
