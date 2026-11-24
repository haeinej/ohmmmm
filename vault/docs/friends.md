# Friends

Your friends see your Friends layer, but only the channels you let them see. Friends are approved the way a private network approves devices: someone asks, you see exactly who they are, and you choose what they get. Exact contracts: [the agent reference](agents/friends.md).

## How someone becomes a friend

1. **They ask**, signed in to ohm with their AT Protocol account connected (their DID *is* their ohm account): in **Connections → Make friends**, by the email of your ohm account. Their list says *waiting* until you let them in, and ohm never says whether an email is on ohm. If they aren't on ohm yet, the request reaches them when they join.
2. **You see the request** under **Notifications → Agent**, with their name and email from their ohm account, their DID, and their message.
3. **You choose**: **Every channel**, or only some, such as `walks` but not `kitchen`. A channel covers the channels inside it. Then **Approve**, or **Decline** (they aren't told).

An approval lasts until you remove them. You can change their channels at any time.

## What a friend sees

A friends-only block is visible to a friend when it is filed in a channel they may see: its home channel, or any channel it's collected into. The same rule holds everywhere they read: in ohm, on your site, and through **their own agents**, which work for them with their access, no more.

Only you let people in or change what they see, signed in to ohm. Your agents can't add a friend or widen what one sees.

## Seeing your people

**Connections** in the rack shows everyone around you, as a list or a graph: friends you let in, people who let you in, and who you asked. Click someone who shares with you to read what they share; it opens to read, never to edit. **Stop sharing** takes someone you let in out.

## Before this

Friends added earlier, by DID, see every channel, as before.
