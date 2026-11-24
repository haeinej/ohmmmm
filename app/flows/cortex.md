# Your cortex

The person reads and changes what their agents know about them: their profile, the observations agents made, their skills and their tools. An agent in the page may ask to keep an observation about the open block. When it is done, the change is in the cortex, as the person's or, for an approved observation, as the agent's.

- **Flow id:** `cortex`. It prefixes every tool name.
- **Starts from:** a cortex part opened from the tree, the graph or search; Settings › Cortex; a block's toolbar (Write observation).
- **Ends in:** saved; answered (accepted, approved, declined); approved or declined by the person (an agent's observation); cancelled; failed (the home refused, such as a file changed on disk since it was read).

On the home on this computer ([docs/serve.md](../../docs/serve.md)) every change goes through the bridge's cortex routes, built only from the cortex's own folder operations: the version before is kept in `.cortex/history/`, and the change is a line in `.cortex/journal.jsonl` naming who made it. In the sample, the same handlers change the sample until reload.

## Steps

| # | Step | Screen (ohm-ui) | Primary action (forest) | Tool | Annotations | Approval |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Edit a part | the editor; the part's actions in the toolbar (`Button` ghost, `Switch`) | none: saved as you type | none | — | none: the person's own change |
| 2 | Forget or remove | `Dialog` | Forget / Remove (`destructive`) | none | — | the dialog |
| 3 | Answer what waits | Settings › Cortex, `Row`s with `Button` | Accept / Approve (`secondary`; the page has no single primary) | none | — | the person's own answer |
| 4 | Write observation | `Popover` with `Textarea` | Write observation | `cortex.observe` | `consequentialHint` | `Dialog` with Approve / Decline, for an agent |

Pinning, switching tools and answering proposals are the person's alone ([cortex/docs/model.md](../../cortex/docs/model.md), "Who may change what"), so no tool does them, and the cortex refuses them to an agent in code.

## Tools

### `cortex.observe`

- **title:** Write observation
- **description:** Asks the person to keep an observation about the open block in their cortex: something seen while working with them. Nothing is written until they approve it in the page. Say why in one line. Returns the observation's id.
- **inputSchema:**

```json
{ "type": "object", "properties": { "text": { "type": "string", "minLength": 1, "maxLength": 2000 }, "why": { "type": "string", "maxLength": 400 } }, "required": ["text"], "additionalProperties": false }
```

- **outputSchema:** `{ "id": "observation-<id>", "about": ["<block id>"], "next": "workspace.open" }`
- **Registered:** while a block is open in the editor (`ObserveButton`, src/editor/CortexActions.tsx), and offered in Settings › Agents.
- **Handler:** `src/workspace/store.ts#writeObservation`, the same one the popover's button calls. Run through `withAgent`, so the journal's actor is the agent, and the bridge writes it as that agent's (`agent`), with `why` in its reason.
- **Errors:** `DataError` when the text is empty or over 2,000 characters; `NotAllowedError` when the person declined; `AbortError` when cancelled; `NotSupportedError` when the home has no cortex.

## States

| Situation | What the person sees |
| --- | --- |
| Agent working | `AgentStatus`, then the approval `Dialog` with the observation and the agent's reason |
| Done | `notify()`: "Kept in your cortex, about this block"; the observation is in the tree and the block's connections card |
| Declined, cancelled | the block as it was, nothing written |
| Failed | `notify()` with the home's reason, such as "changed on disk since it was read" |
| Nothing waiting | Settings › Cortex says so |

## Cross-origin

None.

## Checked

- [x] By hand in Chromium (desktop, light) against a home served by `ohmmmm serve`: the profile edited, a line accepted, a skill approved, an observation pinned, a tool switched, an observation written by the person and one by the tool after approval; each was on disk and in `.cortex/journal.jsonl` as expected.
- [x] By tools: `getTools()` lists `cortex.observe` while a block is open; `executeTool` waits at the dialog, and Approve writes it as the agent's.
- [ ] Dark, and on a phone.
- [ ] Declining and aborting `cortex.observe` by hand (the code rejects with `NotAllowedError` and `AbortError` and writes nothing).
