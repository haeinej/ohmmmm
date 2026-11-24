# Your agents in ohm

When a coding agent works with your vault through ohm's tools (Claude Code, Codex, or any agent with the `ohm-vault` MCP server), you see it in ohm and decide what it may do there. Exact contracts: [the agent reference](agents/agents-panel.md).

## Why

An agent used to show you what it was about to do in its own chat and go ahead when you typed yes. That's easy to approve without looking, and anything that can type in that chat could say yes. Now every action that changes what other people see waits for you in ohm, where it says exactly what will happen. Your agent can't approve its own action.

## What you see

**Agents** in the rack (a dot means something is waiting) lists each agent that has used ohm's tools:

- **its state:** connected, paused or disconnected, with the last tool it used and when;
- **a card for each action it waits on,** closed to what it is and when. Click it to open the whole action (red when it removes something for good), for example **Send an email** (to, subject and body), **Ask someone to be your friend**, **Publish**, **Change a post** or **Remove a post for good**. Each card has **Approve** and **Decline**;
- **Recent:** its last calls.

When you approve, the agent's next call carries out exactly what the card showed, once. If anything changed, it asks again. When you decline, it's told, and nothing happens.

## Email

Your agent sends email with its own mail tool, from your own address. ohm never sends it and never sees your mailbox. Before sending, the agent puts the draft in Agents. Approve it, and the agent sends exactly that draft.

## Pausing and disconnecting

- **Pause** stops an agent until you **Resume** it. ohm's tools refuse every call from it in the meantime.
- **Disconnect** cuts it off, and declines whatever it was waiting for. **Allow again** brings it back.

You talk to your agent in its own chat, not in ohm.

## What this needs

- Your agent has ohm's tools connected (the `ohm-vault` MCP server).
- The vault service has migration `0010_agents` applied.

These checks are made by ohm's tools. An agent that called the vault service directly with your app password could get past them, the same as the command line can. Keep your app password with the agents you trust.
