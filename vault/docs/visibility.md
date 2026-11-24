# Who can see a block

Every block is in one of three layers: **only you** (private, sealed on your devices), **friends** (the friends you chose, through ohm), or **everyone** (published on your PDS). Moving a block between them is a *visibility move*. This guide explains how moves work and who may make them. The exact contracts are in [the agent reference](agents/visibility.md).

## The rule

**Only you show a block to more people.** An agent can move a block to fewer people when you've granted it a channel, and it can *ask* you for anything else. It can never decide for you.

| Move | What happens | Who finishes it |
| --- | --- | --- |
| Only you → Friends | Your device opens the sealed copy and shares it. Friends, and apps you let in, can keep copies | You |
| Friends → Only you | Your device seals it. An agent with a write grant on the channel can start this: friends stop seeing it at once, and your device seals it the next time it is unlocked | You, or a granted agent |
| → Everyone | Every block is a post once it is public. A block that isn't one yet becomes one at the address its channel gives (`/posts/<channel>/<sub-channel>/<slug>`), and the old copy is removed. It is marked public, and the Publish page opens with a preview of that one post. It goes public only when it is published: by you on that page, signed in at your PDS, or by your agent with `vault_publish`, which shows the same preview first. A block needs a title first | You mark it; you or your agent publish it |
| Everyone → Friends | The post is marked friends, and Publish takes the public record down. Copies others made aren't recalled | You |

Every move shows its preview first, with what it does and what can't be undone, before anything changes.

## When an agent asks

An agent never makes a new block for friends: a new block starts private, and sharing it is a move like any other. There is no inbox to clear. When your agent wants a block shown to more people, or wants something it has no grant for, it sends you a request. The request appears under **Notifications → Agent → Waiting for you**, with the agent's reason. **Review** shows the same preview you'd see yourself; **Approve** makes the move, and **Decline** leaves everything as it was. If the block changed after the agent asked, ohm won't approve the stale request; look at the block again and make the move yourself if you still want it.

## The journal

Every move is written down: which block (by its ID only, never its title or text), from where to where, who asked, who approved, why, and how it stands (done, hidden and waiting to be sealed, waiting for Publish, or with an old copy still to clean up). The journal never shows what a private block says.

## What you need

- For an agent to move things to private: a write grant on the channel (`ohm vault grant <agent> write <channel>`), and the agent's tools started in your home (`--home`), so they can read your grants.
- For moves into and out of private: this device unlocked.
- For anything public: your PDS sign-in on the Publish page.
