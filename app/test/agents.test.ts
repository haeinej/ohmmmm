// Agents: the coding agents connected to ohm's tools, and the actions they wait for the member to approve.
import assert from "node:assert/strict"
import test from "node:test"
import { describe, summaryOf } from "../src/workspace/AgentsPanel"
import { answerAgent, loadAgents, setAgentState, setSource, waitingAgentActions } from "../src/workspace/store"
import { createFixtureSource } from "./fixtures/fixture-source"

test("an agent's action waits in Agents until the member approves or declines it", async () => {
  const fixture = createFixtureSource()
  await setSource(fixture)
  try {
    assert.deepEqual(await loadAgents(), { agents: [], approvals: [] })
    const mail = fixture.agentAsks("agent:claude", "vault_mail_ask", { to: ["sam@example.test"], subject: "The walk", body: "Saturday at nine?", warning: "Once you approve, your agent sends exactly this. ohm does not send it." })
    const ask = fixture.agentAsks("agent:claude", "vault_friends_ask", { email: "sam@example.test" })
    const loaded = await loadAgents()
    assert.deepEqual(loaded.agents.map(agent => [agent.agent, agent.state, agent.lastTool, agent.waiting]), [["agent:claude", "active", "vault_friends_ask", 2]])
    assert.equal(waitingAgentActions(), 2)
    // Each card says what the action is, in the person's words.
    assert.deepEqual([describe(loaded.approvals[0]).title, describe(loaded.approvals[0]).lines, describe(loaded.approvals[0]).body], ["Send an email", [["To", "sam@example.test"], ["Subject", "The walk"]], "Saturday at nine?"])
    assert.equal(describe(loaded.approvals[1]).title, "Ask someone to be your friend")
    // A closed card says what it is about in one line.
    assert.equal(summaryOf(loaded.approvals[0]), "sam@example.test · The walk")
    assert.deepEqual(await answerAgent(mail.id, true), { id: mail.id, state: "approved" })
    await assert.rejects(answerAgent(mail.id, false), { name: "InvalidStateError" })
    assert.deepEqual(await answerAgent(ask.id, false), { id: ask.id, state: "declined" })
    assert.equal((await loadAgents()).approvals.length, 0)
    assert.equal(waitingAgentActions(), 0)
  } finally {
    await setSource(null)
  }
})

test("the member pauses, disconnects and allows again an agent; disconnecting declines what it waited for", async () => {
  const fixture = createFixtureSource()
  await setSource(fixture)
  try {
    const waiting = fixture.agentAsks("agent:codex", "vault_publish", { changes: 2 })
    await assert.rejects(setAgentState("codex", "paused"), { name: "DataError" })
    await assert.rejects(setAgentState("agent:codex", "gone" as never), { name: "DataError" })
    await setAgentState("agent:codex", "paused")
    assert.equal((await loadAgents()).agents[0].state, "paused")
    await setAgentState("agent:codex", "disconnected")
    assert.equal(waiting.state, "declined")
    await setAgentState("agent:codex", "active")
    assert.equal((await loadAgents()).agents[0].state, "active")
  } finally {
    await setSource(null)
  }
})
