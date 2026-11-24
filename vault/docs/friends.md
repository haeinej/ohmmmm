# Friends

Your friends see your Friends layer, but only the channels you let them see. Friends are approved the way a private network approves devices: someone asks, you see exactly who they are, and you choose what they get. Exact contracts: [the agent reference](agents/friends.md).

## How someone becomes a friend

1. **They ask**, signed in to ohm with their AT Protocol account connected (their DID *is* their ohm account): in **Connections → Make friends**, by the email of your ohm account. Their list says *waiting* until you let them in, and ohm never says whether an email is on ohm. They also get one email from ohm, with your name on it and your note, linking to ohm. If they reply, it comes to your own email. If they aren't on ohm yet, the request is waiting when they join.
2. **You see the request** under **Notifications → Agent**, with their name and email from their ohm account, their DID, and their message.
3. **You choose**: **Every channel**, or only some, such as `walks` but not `kitchen`. A channel covers the channels inside it. Then **Approve**, or **Decline** (they aren't told).

An approval lasts until you remove them. You can change their channels at any time in **Settings › Friends**, where each friend is listed with their name, email and what they see, and where **Stop sharing** removes them.

## What a friend sees

A friends-only block is visible to a friend when it is filed in a channel they may see: its home channel, or any channel it's collected into. The same rule holds everywhere they read: in ohm, on your site, and through **their own agents**, which work for them with their access, no more.

Only you let people in or change what they see, signed in to ohm. Your agents can't add a friend or widen what one sees.

## Seeing your people

**Connections** in the rack shows everyone around you, as a list or a graph: friends you let in, people who let you in, and who you asked. Click someone who shares with you to read what they share; it opens to read, never to edit. **Stop sharing** takes someone you let in out.

## Finding friends from your inbox

You probably write to the people you'd share with already. Ask your coding agent to "find friends from my inbox", using the [connections skill](../skills/connections/SKILL.md). It goes through your mail with its own mail tools, such as a Gmail connector, and shows you a short list of the people you write to. Nobody is asked until you pick them. Only the addresses you picked go to ohm: never your mail, its subjects or anyone else's address. Each person you pick gets ohm's one invite and joins Connections as *asked*.

Your agent can also write to a friend for you. It sends from your own address, with your mail tool, and only once you've seen the draft and said yes. ohm never holds your mailbox. Your agent can ask people to be friends, but only you let anyone in.

For this to work, your account must have signed in to ohm at least once, so the people you ask can see who is asking.

## Before this

Friends added earlier, by DID, see every channel, as before.
