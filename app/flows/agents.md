# Agents

The member sees each coding agent that uses ohm's tools, and decides in ohm, never in the agent's chat, whether each action it waits on goes ahead.

- **Flow id:** `agents`. It prefixes every tool name.
- **Starts from:** the rack's **Agents** button, which shows a dot while any action waits.
- **Ends in:** an action approved (the agent's next call carries it out, once), declined (nothing done), or an agent paused, resumed, disconnected or allowed again.

## Why it is in ohm

An agent's MCP tools (`vault/mcp/tools.mjs`) used to finish an action on a second call carrying a `confirm` value, after the agent showed the person the preview in its own chat. Now that second call works only once the person has approved exactly that plan here (`vault/service/src/agents.mjs`). The agent can't approve its own action, and anything typed in chat doesn't count. A move request already waits for the person in the bell (F3), so it isn't asked for twice. Talking to an agent stays in its own chat.

## Steps

| # | Step | Screen (ohm-ui) | Primary action (forest) | Tool | Annotations | Approval |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | See agents | side panel (`SidePanelFrame`), a section per agent, `Empty` when none | none | none | none | none |
| 2 | Answer an action | a row per action, closed to its title, one line and when; clicking opens it in place as ohm-ui's `ApprovalCard` (`@ohm/elements-approval-card`): the whole action, **Approve** and Decline, then its receipt | **Approve** | `agents.answer` | `consequentialHint` | `ApprovalCard`; an agent in the page goes through a `Dialog` |
| 3 | Control an agent | ghost icon `Button`s: pause, disconnect; **Resume** / **Allow again** | none | none | none | disconnect asks in a `Dialog` |

Only one card is open at a time, so the panel shows one **Approve**, on the action being read. The card is ohm-ui's `ApprovalCard`:

- An action that removes something for good (`vault_delete`, `vault_friends_delete`, `vault_friends_remove`) uses its `destructive` variant, so its icon and Approve are red.
- After an answer, it shows its receipt ("Approved. <agent> can go ahead." or "Declined. Nothing was done.") for a moment, before the list reads again.
- `src/theme.css` gives it the card radius, keeps a message's line breaks, and makes its Approve forest (the view's one primary action) instead of ohm-ui's ink, all by slot rules; the installed copy is unchanged.

## Tools

### `agents.answer`

- **title:** Approve
- **description:** Approves or declines one action a coding agent waits on, after the person confirms it in the page. Returns the action's new state.
- **inputSchema:**

```json
{ "type": "object", "properties": { "id": { "type": "string" }, "approve": { "type": "boolean" } }, "required": ["id", "approve"] }
```

- **outputSchema:** `{ "id": ..., "state": "approved" | "declined" }`
- **Handler:** `src/workspace/store.ts#answerAgent`, the same one the card's buttons call
- **Errors:** `DataError` when the action isn't waiting; `NotAllowedError` when the person cancels the dialog; `AbortError` when cancelled

Pausing and disconnecting have no tool. Only the person controls their agents, by hand.

## Cards

`describe()` in [AgentsPanel.tsx](../src/workspace/AgentsPanel.tsx) turns each tool's preview into a title and lines:

- **Send an email:** To, Cc, Subject, and the body. The agent sends it from your own address.
- **Ask someone to be your friend:** their email, and the line for them.
- **Change a post:** what changes and who sees it.
- **Hide a block from friends:** the block, and the layer it moves from and to.
- **Publish**, **Bring in what you published**, **Remove a post for good**.
- **Change a block friends read**, **Remove a block friends read**, **Stop sharing with someone**.

Any other tool shows its preview as key and value.

## States

| Situation | What the person sees |
| --- | --- |
| Loading | blank |
| Waiting | the rack's dot; the panel reads again every 4 seconds, the rack every 15 |
| Done | `notify()` naming the action and the agent |
| Declined | `notify()`; the agent is told on its next call |
| Failed | `notify()` (error) with the service's reason |
| Empty | `Empty`: no agents yet |

## Cross-origin

None.

## Checked

- [x] By tests: `test/agents.test.ts` (store handlers, card wording), `vault/test/mcp.test.mjs` (waiting, approval used once, decline, pause, disconnect)
- [x] By hand, against the test fixture (not a live service), in light and dark, on a phone (375 px) and a desktop: cards open and close, Approve, Pause, and the Disconnect dialog
- [ ] By tools: `getTools()` lists `agents.answer` while the panel is open
