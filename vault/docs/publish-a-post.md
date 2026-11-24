# Publish a post

A post is one thing you publish. It can be a sentence, a photograph, an essay, a project update, or a post you brought over from another site. Each post is one record in your site's post collection and has its own URL. A photograph and a paragraph can share one post when they belong together.

## Give it a body

Write the body in Markdown. You can start with just a sentence, a link, or a photo with alt text. The publishing command sets the publication date and builds the public URL from your site and the slug you choose. Add a title when it helps people recognize the post.

For example, save this as `rain.md`.

```md
The street went quiet after the rain.

![A wet street reflecting the evening light](media:street)

[The walk it came from](https://example.com/walks/after-the-rain)
```

`media:street` places the attachment exactly where it appears in the body. Match it to a file with `--media street=./street.jpg`, or to an image on the web with `--media street=https://example.org/street.jpg`. Leave out the media option for a text or link post.

## Give it a label

A label is the section of your site the post belongs to, in your own words: `Writings`, `photographs`, `Field notes`. Add a sublabel when the post is part of a group inside that section, such as an essay series. A post has exactly one label; if you give none, it is filed under `other`. The sublabel is optional. The post's address comes from them: `/posts/field-notes/after-the-rain`.

You do not say what kind of thing the post is. The publish command identifies its form from the content and saves it: `rain.md` has words and a photo and no title, so it is a note. With a title it would be a writing, and with only the photo it would be an image. There are fourteen forms in all, covering galleries, video, audio, files, links, embeds, quotes, lists, and code, with `other` for anything else. [Forms, labels, and sublabels](labels.md)

## Preview and publish

After [setting up your site](../README.md#run-your-own-pds-and-site), run this command from the repository root.

```sh
npm run publish:post -- \
  --file ./rain.md \
  --slug after-the-rain \
  --label 'Field notes' \
  --media street=./street.jpg
```

This prints a local preview. When ready, set `ATPROTO_APP_PASSWORD` and rerun the command with `--publish` to make the post public.

## What the record needs

A post is kept as a [standard.site](https://standard.site) document. The document carries what every reader understands; its `content` is the post as ohm keeps it. The smallest complete one has a title, a publication date, the publication it belongs to, and content with a body, a canonical URL and a form. This example adds a label. The types are the same on every site.

```json
{
  "$type": "site.standard.document",
  "site": "at://did:web:pds.example.com/site.standard.publication/self",
  "path": "/posts/field-notes/after-the-rain",
  "title": "I want to remember how the city smelled after the rain.",
  "textContent": "I want to remember how the city smelled after the rain.",
  "tags": ["Field notes"],
  "publishedAt": "2026-01-14T09:00:00Z",
  "content": {
    "$type": "com.ohmmmm.post",
    "body": "I want to remember how the city smelled after the rain.",
    "canonicalUrl": "https://example.com/posts/field-notes/after-the-rain",
    "form": "note",
    "label": "Field notes",
    "untitled": true
  }
}
```

The publish command writes all of this from the post: a note has no title of its own, so the document is titled by its first words and `untitled` says so.

The same record can become a full page, a short feed entry, or a gallery card. Your site decides which fields to show and how to lay them out. [Set up with your coding agent](set-up-with-an-agent.md)

Use [Group and connect posts](group-and-connect.md) to build a series, connect related posts, or quote a passage.
