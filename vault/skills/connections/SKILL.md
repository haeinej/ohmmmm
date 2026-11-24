---
name: connections
description: Bring the people a person already writes with into their ohm Connections, and email a friend for them, using your own mail tools (a Gmail or Outlook connector, a mail MCP server). Use when asked to find friends from their inbox, invite people to ohm, sync contacts into Connections, or write to a friend.
---

# Connections and mail

ohm keeps who a person's people are: their **Connections**. That means the friends they let in, the people who let them in, and everyone they asked. Mail stays in the person's own mailbox, and you reach it with the mail tools you already have. ohm holds no mailbox, no mail tokens and no copy of their mail. When you send, the mail goes from the person's own address, through their own mail tool.

Two ohm-vault tools cover what ohm does:

| Tool | What it does |
| --- | --- |
| `vault_mail_ask` | Gets an email approved before you send it. The draft waits in the person's Agents panel in ohm. Once they approve, the second call returns the exact draft, and you send that with your own mail tool. |
| `vault_connections` | Reads only. Returns `friends` (name, email, channels), `friendOf` (who let the person in) and `asked` (each email with `waiting` or `friends`). |
| `vault_friends_ask` | Asks one person by email. It takes two calls: the first puts it in the person's Agents panel in ohm, and the second, with `confirm`, asks once they approve it there. ohm emails them one invite from "<the person> via ohm", and replies go to the person's own email. A person can send at most 20 invites a day. |

Only the person **approves** a friend, in ohm. You cannot let anyone read their friends layer. You can only ask.

## Bringing people in from the inbox

1. **Read `vault_connections` first.** Anyone already a friend, already letting them in, or already asked is not suggested again.
2. **Look through the person's mail with your own mail tool.** Search sent mail first, because people they write *to* are the best sign. Look at about the last 90 days unless they say otherwise.
   - Leave out:
     - their own addresses;
     - no-reply, notification, newsletter, mailing-list and support addresses;
     - receipts;
     - anyone who only ever wrote to them and never got a reply.
   - Read headers (who, when, how often). Don't read bodies unless the person asks you to.
3. **Show a short list and let the person choose.** For each person give:
   - the name and address;
   - one plain reason, such as "you wrote to them 6 times since September".

   Rank by how often and how recently they wrote. Suggest no more than 20 at once. Ask who to invite. Nobody is asked unless the person picked them.
4. **Ask each person they picked.** Call `vault_friends_ask` with the email, and a `message` only if the person gave one in their own words. Each ask waits in the person's Agents panel in ohm. Tell them so, then call again with `confirm` once they've approved. A yes in your chat doesn't count.
5. **Say what happened.** Tell them who was asked, and that each person is now waiting in Connections. Each becomes a friend only when that person lets them in, or when the person approves their request in ohm.

The only thing that reaches ohm is the addresses the person picked, and any line they wrote. Nothing else from the mailbox goes to ohm: no subjects, bodies, other addresses or counts.

## Writing to a friend

1. **Find them with `vault_connections`**, by name or email. If they aren't there, ask the person for the address. Don't guess one.
2. **Draft the email in the person's voice.** Leave out anything from their private vault unless they ask for it in this email.
3. **Get it approved in ohm.** Call `vault_mail_ask` with `to`, `subject` and `body`. The draft waits in the person's Agents panel. Tell them, then call again with `confirm`.
4. **Send exactly the approved draft,** from their own address, with your mail tool. A changed draft needs approving again. If they declined, don't send. Never send on your own initiative, and never to anyone they didn't name.
5. **If you have no mail tool,** say so and give them the draft to send themselves. Don't send through ohm: `vault_friends_ask` invites someone, and it is not a way to mail them.

## When it goes wrong

- The answer says it is still waiting: the person hasn't answered in ohm yet. Wait, and call again later with the same `confirm`.
- "The person declined this in ohm": don't do it, and don't ask again unless they tell you to.
- "paused this agent" or "disconnected this agent": stop and tell the person. Only they can resume you or allow you again, in ohm.
- `NotConnected` from `vault_friends_ask`: the person's account hasn't signed in to ohm yet, so the people they ask couldn't see who is asking. Ask them to sign in to ohm once, then try again.
- An invite isn't emailed: either that address was already invited, or the person reached 20 invites today. The ask is still kept. Tell them; don't retry.
