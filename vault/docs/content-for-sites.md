# Content for sites

Your website is a view of your vault. This guide explains how a site reads what you made, and who sees what. The exact requests are in [the agent reference](agents/content-for-sites.md) and the [service reference](../service/CAPABILITIES.md#content).

## Why

You write in your vault, with your coding agent. Your site shouldn't have to keep its own copy of that work. It reads your channels as collections and your blocks as entries, so a change in the vault shows on the site, and the site's design stays its own. The `ohm` Astro loader is what does the reading.

## Who sees what

| Who is looking | What your site can show them |
| --- | --- |
| Anyone | What you **published**: the posts on your own PDS. Marking a post public doesn't publish it, so nothing shows here until you approve Publish |
| A friend, signed in to ohm | Also your **Friends** layer, in the channels you approved them for ([friends](friends.md)): friends-only blocks and posts, and the pictures in them |
| Anyone else signed in to ohm | Exactly what anyone sees. They can't tell whether you share anything with friends |
| Anyone at all | Never your private layer. It is sealed on your devices, and these reads never open it |

What a site gets is cut down to what a page needs: titles, bodies, tags, dates, and pictures with their alt text. It never gets where a file came from on your computer, which agent made a block, or your journal.

Removing a friend takes effect on their next page load.

If your PDS can't be reached, your site keeps working: friends still see Friends, and everyone sees the last copy of what you published, marked as not fresh.

## Showing Friends on your site

A site can't see who is signed in to ohm, because that sign-in lives on ohm's own address. So ohm vouches for the viewer:

1. **List your site in ohm** (`content.addSite`, signed in to ohm). Only you can add one; your agent can't. A site you haven't listed never receives anything.
2. Your site sends a viewer who wants to see more to ohm. ohm checks who they are and sends them straight back with a **viewer token**: proof of who they are, for your content only, that lasts ten minutes.
3. Your site's server-rendered pages send that token with their reads. If the viewer is on your friend list, the answer includes Friends.

A static build can never contain Friends content. Public pages can be built ahead of time; Friends pages are rendered when someone asks for them.

## What you need

- An ohm account with your AT Protocol account connected, and your posts published to your PDS for anything public.
- For Friends: the service set up with `VIEWER_TOKEN_SECRET`, your site listed, and a server-rendered route on the site.
